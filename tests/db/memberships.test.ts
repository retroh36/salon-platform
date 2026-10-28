// Memberships in the database: plans (owners), selling one at checkout,
// member prices and included services applied there, voids, and billing
// through the test provider: renewals, failed payments with retries and a
// notice, pausing and ending by the plan's rules. All with clients and
// plans of our own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addInterval } from "@/lib/memberships";
import { runMembershipBilling } from "@/lib/memberships-billing";
import { loadMembershipRows } from "@/lib/memberships-load";
import { membershipReport } from "@/lib/memberships";
import { addDays, fromLocal, todayIn } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const today = () => todayIn(TZ);
const TAG = `Mb${Date.now().toString(36)}`;

let owner: Client;
let manager: Client;
let frontDesk: Client;
let stylist: Client;
let blowoutId: string;
let productId: string;
let plans: { club: string; color: string };

const clients: string[] = [];
async function client(name: string) {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}${name}`, last_name: "Test" }).select("id").single();
  clients.push(data!.id);
  return data!.id;
}

const sell = (c: Client, input: Record<string, unknown>) => c.rpc("complete_sale", { p_location_id: L, p_input: input as never });

async function join(clientId: string, planId: string, card = "test_visa_4242") {
  const price = (await admin.from("membership_plans").select("price_cents").eq("id", planId).single()).data!.price_cents;
  const { data: saleId, error } = await sell(frontDesk, {
    client_id: clientId,
    lines: [{ kind: "membership", plan_id: planId, provider: "test", payment_method_ref: card, card_label: card === "test_visa_4242" ? "Visa …4242" : "Visa …0002" }],
    payments: [{ method: "card", amount_cents: price }],
  });
  expect(error).toBeNull();
  const { data: m } = await admin.from("client_memberships").select("*").eq("client_id", clientId).eq("plan_id", planId).single();
  return { saleId: saleId as string, membership: m! };
}

// Makes a membership's renewal due today, as if it began a period ago.
async function dueToday(membershipId: string) {
  const { data: m } = await admin.from("client_memberships").select("current_period_start, periods_paid").eq("id", membershipId).single();
  const start = addInterval(today(), "month", -1);
  await admin.from("client_memberships").update({ anchor_on: addInterval(today(), "month", -m!.periods_paid), current_period_start: start, current_period_end: today() }).eq("id", membershipId);
  await admin.from("membership_credits").update({ period_start: start }).eq("membership_id", membershipId).eq("period_start", m!.current_period_start);
}

beforeAll(async () => {
  [owner, manager, frontDesk, stylist] = await Promise.all(["owner", "manager", "frontdesk", "bridget"].map((u) => signIn(`${u}@mapleandash.test`)));
  const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single();
  blowoutId = s!.id;
  const { data: p } = await admin
    .from("products")
    .insert({ business_id: B, brand: TAG, name: "Shine", sku: `${TAG}-S`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 2000 })
    .select("id")
    .single();
  productId = p!.id;
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: productId, on_hand: 50 });
  const save = async (name: string, input: Record<string, unknown>) => {
    const { data, error } = await owner.rpc("save_membership_plan", { p_business_id: B, p_plan_id: null as never, p_input: { name: `${TAG} ${name}`, ...input } as never });
    expect(error).toBeNull();
    return data as string;
  };
  const base = { interval_unit: "month", interval_count: 1, min_term_periods: 0, cancel_notice_days: 0, allow_pause: true, max_pause_periods: 2, service_discount_pct: 0 };
  plans = {
    club: await save("Club", { ...base, price_cents: 8900, retail_discount_pct: 10, services: [{ service_id: blowoutId, quantity: 2, rollover: false }] }),
    color: await save("Color", { ...base, price_cents: 14900, service_discount_pct: 10, retail_discount_pct: 15, min_term_periods: 3, cancel_notice_days: 14, services: [{ service_id: blowoutId, quantity: 1, rollover: true }] }),
  };
});

afterAll(async () => {
  for (const c of clients) {
    await admin.from("sales").delete().eq("client_id", c);
    await admin.from("appointments").delete().eq("client_id", c);
  }
  await admin.from("notifications").delete().eq("template", "membership_payment_failed").like("body", `${TAG}%`);
  await admin.from("clients").delete().in("id", clients);
  await admin.from("membership_plans").delete().like("name", `${TAG}%`);
  await admin.from("sale_items").delete().eq("product_id", productId);
  await admin.from("stock_movements").delete().eq("product_id", productId);
  await admin.from("stock_levels").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
});

describe("plans", () => {
  it("are set up by owners and managers only, and seen by everyone at the salon", async () => {
    expect((await frontDesk.rpc("save_membership_plan", { p_business_id: B, p_plan_id: null as never, p_input: { name: "Nope" } as never })).error?.code).toBe("42501");
    expect((await stylist.rpc("save_membership_plan", { p_business_id: B, p_plan_id: null as never, p_input: { name: "Nope" } as never })).error?.code).toBe("42501");
    expect((await stylist.from("membership_plans").select("id").eq("id", plans.club)).data).toHaveLength(1);
    expect((await manager.from("membership_plans").update({ price_cents: 1 }).eq("id", plans.club).select()).data).toEqual([]);
    const { data: services } = await admin.from("membership_plan_services").select("quantity, rollover").eq("plan_id", plans.color);
    expect(services).toEqual([{ quantity: 1, rollover: true }]);
  });
});

describe("selling one at checkout", () => {
  it("starts the membership with this period's services, its first payment, and its card at the provider", async () => {
    const c = await client("Ava");
    const { saleId, membership: m } = await join(c, plans.club);
    expect(m).toMatchObject({ status: "active", price_cents: 8900, started_on: today(), current_period_end: addInterval(today(), "month", 1), payment_method_ref: "test_visa_4242", sale_id: saleId });
    const { data: credits } = await admin.from("membership_credits").select("service_id, allowance, used").eq("membership_id", m.id);
    expect(credits).toEqual([{ service_id: blowoutId, allowance: 2, used: 0 }]);
    expect((await admin.from("membership_charges").select("status, provider, amount_cents").eq("membership_id", m.id)).data).toEqual([{ status: "succeeded", provider: "checkout", amount_cents: 8900 }]);
    expect((await admin.from("sale_items").select("kind, membership_id").eq("sale_id", saleId).single()).data).toEqual({ kind: "membership", membership_id: m.id });
    // One of each plan per client; a client is needed; a card is needed.
    expect((await sell(frontDesk, { client_id: c, lines: [{ kind: "membership", plan_id: plans.club, payment_method_ref: "test_visa_4242" }], payments: [{ method: "card", amount_cents: 8900 }] })).error?.message).toContain("already a member");
    expect((await sell(frontDesk, { lines: [{ kind: "membership", plan_id: plans.club, payment_method_ref: "test_visa_4242" }], payments: [{ method: "card", amount_cents: 8900 }] })).error?.message).toBe("Choose the client the membership is for");
    expect((await sell(frontDesk, { client_id: c, lines: [{ kind: "membership", plan_id: plans.color }], payments: [{ method: "card", amount_cents: 14900 }] })).error?.message).toBe("Add the card the membership renews on");
  });

  it("applies member prices automatically, never counted against the front desk's discount limit", async () => {
    const c = await client("Bea");
    await join(c, plans.color);
    await admin.from("businesses").update({ discount_roles: ["owner", "manager"] }).eq("id", B);
    try {
      // $20 product: 15% off ($3), then 10.25% tax on $17 = $1.74.
      const { data: b } = await admin.from("businesses").select("tax_rate_retail_bp").eq("id", B).single();
      const tax = Math.round((1700 * b!.tax_rate_retail_bp!) / 10000);
      const { data: saleId, error } = await sell(frontDesk, { client_id: c, lines: [{ kind: "product", product_id: productId, quantity: 1 }], payments: [{ method: "card", amount_cents: 1700 + tax }] });
      expect(error).toBeNull();
      expect((await admin.from("sale_items").select("member_discount_cents, line_discount_cents, line_discount_reason, total_cents").eq("sale_id", saleId!).single()).data).toEqual({
        member_discount_cents: 300,
        line_discount_cents: 300,
        line_discount_reason: "Member price",
        total_cents: 1700 + tax,
      });
      // Not a member: full price.
      const other = await client("Cy");
      expect((await sell(frontDesk, { client_id: other, lines: [{ kind: "product", product_id: productId, quantity: 1 }], payments: [{ method: "card", amount_cents: 1700 + tax }] })).error?.message).toBe("Payments don't add up to the total");
    } finally {
      await admin.from("businesses").update({ discount_roles: ["owner", "manager", "front_desk"] }).eq("id", B);
    }
  });

  it("pays for an included service with a 'membership' payment, untaxed, until this period's run out; a void gives it back", async () => {
    const c = await client("Dee");
    const { membership: m } = await join(c, plans.club);
    const { data: credit } = await admin.from("membership_credits").select("id").eq("membership_id", m.id).single();
    const blowout = { kind: "service", service_id: blowoutId, staff_id: SEED.staff.bridget, quantity: 1, membership_credit_id: credit!.id };
    // Two included this month, the third is refused.
    const { data: first, error } = await sell(frontDesk, { client_id: c, lines: [blowout, blowout], payments: [] });
    expect(error).toBeNull();
    // Bridget's price for it, paid by the membership.
    const { data: lines } = await admin.from("sale_items").select("unit_price_cents").eq("sale_id", first!);
    const { data: pays } = await admin.from("payments").select("method, amount_cents, reference").eq("sale_id", first!);
    expect(pays).toEqual(lines!.map((l) => ({ method: "membership", amount_cents: l.unit_price_cents, reference: `${TAG} Club` })));
    expect((await admin.from("sale_items").select("tax_cents, membership_credit_id").eq("sale_id", first!)).data!.every((i) => i.tax_cents === 0 && i.membership_credit_id === credit!.id)).toBe(true);
    expect((await sell(frontDesk, { client_id: c, lines: [blowout], payments: [] })).error?.message).toMatch(/^No Blowout left on their membership this period/);
    // Not as cash back.
    expect((await manager.rpc("refund_sale", { p_sale_id: first!, p_input: { reason: "No", payments: [{ method: "card", amount_cents: 100 }] } as never })).error?.message).toBe(
      "Promotional credit, package uses and membership services can't be refunded as cash or card",
    );
    // Someone else's membership can't pay.
    const stranger = await client("Eve");
    expect((await sell(frontDesk, { client_id: stranger, lines: [blowout], payments: [] })).error?.message).toBe("Their membership doesn't include this service right now");
    // A void gives both back.
    expect((await manager.rpc("void_sale", { p_sale_id: first!, p_reason: "Wrong client" })).error).toBeNull();
    expect((await admin.from("membership_credits").select("used").eq("id", credit!.id).single()).data!.used).toBe(0);
  });

  it("voids a membership sold on a sale, unless it's been used", async () => {
    const c = await client("Fay");
    const { saleId, membership: m } = await join(c, plans.club);
    expect((await manager.rpc("void_sale", { p_sale_id: saleId, p_reason: "Changed their mind" })).error).toBeNull();
    expect((await admin.from("client_memberships").select("status, cancel_reason").eq("id", m.id).single()).data).toEqual({ status: "canceled", cancel_reason: "Void: Changed their mind" });

    const g = await client("Gus");
    const used = await join(g, plans.club);
    const { data: credit } = await admin.from("membership_credits").select("id").eq("membership_id", used.membership.id).single();
    await sell(frontDesk, { client_id: g, lines: [{ kind: "service", service_id: blowoutId, staff_id: SEED.staff.bridget, membership_credit_id: credit!.id }], payments: [] });
    expect((await manager.rpc("void_sale", { p_sale_id: used.saleId, p_reason: "Oops" })).error?.code).toBe("55000");
  });
});

describe("billing", () => {
  it("renews when it's due: a renewal sale on the card, the next period, rolled-over services; never twice", async () => {
    const c = await client("Hal");
    const { membership: m } = await join(c, plans.color);
    await dueToday(m.id);
    const summary = await runMembershipBilling(admin, { membershipId: m.id });
    expect(summary).toMatchObject({ checked: 1, renewed: 1, failed: 0 });
    const { data: after } = await admin.from("client_memberships").select("status, periods_paid, current_period_start, current_period_end").eq("id", m.id).single();
    expect(after).toEqual({ status: "active", periods_paid: 2, current_period_start: today(), current_period_end: addInterval(today(), "month", 1) });
    // The renewal is a sale like any other: a card payment through the provider.
    const { data: charge } = await admin.from("membership_charges").select("status, provider, provider_reference, sale_id").eq("membership_id", m.id).eq("provider", "test").single();
    expect(charge!.provider_reference).toMatch(/^test_ch_/);
    const { data: pay } = await admin.from("payments").select("method, processor, amount_cents").eq("sale_id", charge!.sale_id!).single();
    expect(pay).toEqual({ method: "card", processor: "test", amount_cents: 14900 });
    // The unused root touch-up rolled over: one this month plus one.
    expect((await admin.from("membership_credits").select("allowance").eq("membership_id", m.id).eq("period_start", today()).single()).data!.allowance).toBe(2);
    // Running again charges nothing.
    expect((await runMembershipBilling(admin, { membershipId: m.id })).checked).toBe(0);
    expect((await admin.rpc("record_membership_charge", { p_membership_id: m.id, p_today: today(), p_result: { ok: true, reference: "x" } })).error?.code).toBe("55000");
    // Only the service role records charges.
    expect((await owner.rpc("record_membership_charge", { p_membership_id: m.id, p_today: today(), p_result: { ok: true } })).error).not.toBeNull();
  });

  it("retries a failed payment after 1, 3 and 4 days with a notice to staff, takes a new card, and ends after the fourth failure", async () => {
    const c = await client("Ida");
    const { membership: m } = await join(c, plans.club, "test_visa_0002");
    await dueToday(m.id);
    expect(await runMembershipBilling(admin, { membershipId: m.id })).toMatchObject({ failed: 1, renewed: 0 });
    let row = (await admin.from("client_memberships").select("status, failed_attempts, next_retry_at").eq("id", m.id).single()).data!;
    expect(row).toMatchObject({ status: "past_due", failed_attempts: 1 });
    expect(Math.round((Date.parse(row.next_retry_at!) - Date.now()) / 3_600_000)).toBe(24);
    const { data: notices } = await admin.from("notifications").select("staff_id, channel, body").eq("template", "membership_payment_failed").like("body", `${TAG}Ida%`);
    expect(notices!.map((n) => n.staff_id).sort()).toEqual([SEED.staff.owner, SEED.staff.manager].sort());
    expect(notices![0].body).toMatch(/^.+Club payment of \$89\.00 didn't go through \(The card was declined\)\. Maestra will try again on/);
    // No benefits while it's owed.
    const { data: credit } = await admin.from("membership_credits").select("id").eq("membership_id", m.id).single();
    expect((await sell(frontDesk, { client_id: c, lines: [{ kind: "service", service_id: blowoutId, staff_id: SEED.staff.bridget, membership_credit_id: credit!.id }], payments: [] })).error?.message).toBe(
      "Their membership doesn't include this service right now",
    );
    // Not due again until tomorrow.
    expect((await runMembershipBilling(admin, { membershipId: m.id })).checked).toBe(0);

    // A new card: tried straight away, and it works.
    expect((await frontDesk.rpc("update_membership_card", { p_membership_id: m.id, p_provider: "test", p_ref: "test_visa_4242", p_label: "Visa …4242" })).error).toBeNull();
    expect(await runMembershipBilling(admin, { membershipId: m.id })).toMatchObject({ renewed: 1 });
    row = (await admin.from("client_memberships").select("status, failed_attempts, next_retry_at").eq("id", m.id).single()).data!;
    expect(row).toEqual({ status: "active", failed_attempts: 0, next_retry_at: null });

    // Four failures in a row end it.
    const j = await client("Jo");
    const declined = await join(j, plans.club, "test_visa_0002");
    await dueToday(declined.membership.id);
    const gaps: number[] = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      await runMembershipBilling(admin, { membershipId: declined.membership.id });
      const r = (await admin.from("client_memberships").select("status, next_retry_at").eq("id", declined.membership.id).single()).data!;
      if (r.next_retry_at) gaps.push(Math.round((Date.parse(r.next_retry_at) - Date.now()) / 86_400_000));
      if (attempt < 4) await admin.from("client_memberships").update({ next_retry_at: new Date(Date.now() - 1000).toISOString() }).eq("id", declined.membership.id);
      else expect(r.status).toBe("canceled");
    }
    expect(gaps).toEqual([1, 3, 4]);
    expect((await admin.from("client_memberships").select("cancel_reason").eq("id", declined.membership.id).single()).data!.cancel_reason).toBe("Payment failed 4 times");
  });

  it("retries on the day it said, whatever time the run is that day", async () => {
    // The nightly run fails a card just after it starts; the next night's
    // run starts a few seconds earlier in the day, and must still retry.
    const c = await client("Rue");
    const { membership: m } = await join(c, plans.club, "test_visa_0002");
    await dueToday(m.id);
    expect(await runMembershipBilling(admin, { membershipId: m.id })).toMatchObject({ failed: 1 });
    // "Tomorrow" has come, but the run is a little earlier than the failure
    // was: later today, never past the salon's midnight.
    const endOfToday = fromLocal(addDays(todayIn(TZ), 1), 0, TZ)!.getTime() - 1000;
    await admin.from("client_memberships").update({ next_retry_at: new Date(Math.min(Date.now() + 30 * 60_000, endOfToday)).toISOString() }).eq("id", m.id);
    expect(await runMembershipBilling(admin, { membershipId: m.id })).toMatchObject({ checked: 1, failed: 1 });
  });

  it("pauses from the end of the period and resumes with a new period, paid then", async () => {
    const c = await client("Kim");
    const { membership: m } = await join(c, plans.club);
    expect((await frontDesk.rpc("pause_membership", { p_membership_id: m.id, p_periods: 3 })).error?.message).toBe("Pause for 1 to 2 periods");
    expect((await frontDesk.rpc("pause_membership", { p_membership_id: m.id, p_periods: 1 })).error).toBeNull();
    let row = (await admin.from("client_memberships").select("status, pause_from, resume_on, current_period_end").eq("id", m.id).single()).data!;
    expect(row.pause_from).toBe(row.current_period_end);
    expect(row.resume_on).toBe(addInterval(row.current_period_end, "month", 1));
    // The day it starts: paused, not charged.
    await dueToday(m.id);
    await admin.from("client_memberships").update({ pause_from: today() }).eq("id", m.id);
    expect(await runMembershipBilling(admin, { membershipId: m.id })).toMatchObject({ paused: 1, renewed: 0 });
    // Resumed early: a new period from today, charged straight away.
    expect((await frontDesk.rpc("resume_membership", { p_membership_id: m.id })).error).toBeNull();
    expect(await runMembershipBilling(admin, { membershipId: m.id })).toMatchObject({ renewed: 1 });
    row = (await admin.from("client_memberships").select("status, pause_from, resume_on, current_period_end").eq("id", m.id).single()).data!;
    expect(row).toEqual({ status: "active", pause_from: null, resume_on: null, current_period_end: addInterval(today(), "month", 1) });
  });

  it("ends by the plan's rules (minimum term and notice), or now for managers; it stops at that date", async () => {
    const c = await client("Lu");
    const { membership: m } = await join(c, plans.color);
    const { data: on, error } = await frontDesk.rpc("cancel_membership", { p_membership_id: m.id, p_reason: "Moving", p_now: false });
    expect(error).toBeNull();
    // Three months' minimum from today.
    expect(on).toBe(addInterval(today(), "month", 3));
    expect((await frontDesk.rpc("cancel_membership", { p_membership_id: m.id, p_reason: "Now please", p_now: true })).error?.code).toBe("42501");
    expect((await frontDesk.rpc("keep_membership", { p_membership_id: m.id })).error).toBeNull();
    expect((await admin.from("client_memberships").select("cancels_on").eq("id", m.id).single()).data!.cancels_on).toBeNull();
    expect((await manager.rpc("cancel_membership", { p_membership_id: m.id, p_reason: "Exception", p_now: true })).error).toBeNull();
    expect((await admin.from("client_memberships").select("status").eq("id", m.id).single()).data!.status).toBe("canceled");

    // The Club has no minimum: it ends at the period's end, then stops.
    const d = await client("Max");
    const club = await join(d, plans.club);
    await frontDesk.rpc("cancel_membership", { p_membership_id: club.membership.id, p_reason: "Budget", p_now: false });
    await dueToday(club.membership.id);
    await admin.from("client_memberships").update({ cancels_on: today() }).eq("id", club.membership.id);
    expect(await runMembershipBilling(admin, { membershipId: club.membership.id })).toMatchObject({ canceled: 1, renewed: 0 });
  });
});

describe("who sees what", () => {
  it("lets stylists see their own clients' memberships but not charges; another salon sees nothing", async () => {
    const other = await createOtherSalon();
    try {
      const otherOwner = await signIn(other.email);
      // Bridget sees the memberships of clients on her book, and no others.
      const { data: all } = await admin.from("client_memberships").select("id, client_id").eq("business_id", B);
      const { data: booked } = await admin.from("appointment_items").select("appointment:appointments!inner(client_id)").eq("staff_id", SEED.staff.bridget).limit(100000);
      const hers = new Set(booked!.map((b) => b.appointment.client_id));
      const { data: seen } = await stylist.from("client_memberships").select("id");
      expect(new Set(seen!.map((m) => m.id))).toEqual(new Set(all!.filter((m) => hers.has(m.client_id)).map((m) => m.id)));
      expect((await stylist.from("membership_charges").select("id").limit(1)).data).toEqual([]);
      expect((await otherOwner.from("client_memberships").select("id").eq("plan_id", plans.club)).data).toEqual([]);
      expect((await otherOwner.from("membership_plans").select("id").eq("id", plans.club)).data).toEqual([]);
      const m = (await admin.from("client_memberships").select("id").eq("plan_id", plans.club).neq("status", "canceled").limit(1).single()).data!;
      expect((await otherOwner.rpc("pause_membership", { p_membership_id: m.id, p_periods: 1 })).error?.code).toBe("42501");
      expect((await stylist.rpc("pause_membership", { p_membership_id: m.id, p_periods: 1 })).error?.code).toBe("42501");
    } finally {
      await other.cleanup();
    }
  });

  it("counts members for the owners' report as the database has them", async () => {
    const rows = await loadMembershipRows(owner, B, TZ);
    const { count } = await admin.from("client_memberships").select("id", { count: "exact", head: true }).eq("business_id", B).neq("status", "canceled");
    expect(membershipReport(rows, today(), today()).members).toBe(count);
  });
});
