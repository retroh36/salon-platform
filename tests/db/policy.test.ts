// The cancellation and no-show policy in the database: owners set it; a
// no-show or a late cancellation by the client gets its fee the moment it
// happens (the visit's strictest terms, as lib/policy.ts works them out),
// charged to the card on file after the grace by the charging run, with a
// receipt; failures flagged to the front of house; waivers before and after
// charging (with a reason, by the roles allowed, refunded through the
// provider); deposits kept, given back or taken off the bill; repeat
// offenders; and the secure card link.
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runPolicyCharges } from "@/lib/policy-billing";
import { cancelFee, DEFAULT_POLICY, visitTerms, type PolicySettings } from "@/lib/policy";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const BRIDGET = SEED.staff.bridget;
const GIL = SEED.staff.gil;
const TAG = `Pol${Date.now().toString(36)}`;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let owner: Client;
let manager: Client;
let frontDesk: Client;
let stylist: Client;
let savedPolicy: Record<string, unknown> | null = null;
let savedStaffPolicies: Record<string, unknown>[] = [];
const clients: string[] = [];
let cut: string;

const POLICY = {
  card_required: "all",
  card_service_ids: [],
  card_staff_ids: [],
  cancel_window_hours: 48,
  late_cancel_fee_kind: "fixed",
  late_cancel_fee_amount: 4000,
  no_show_fee_kind: "percent",
  no_show_fee_amount: 50,
  long_hold_days: null,
  repeat_count: 2,
  repeat_months: 6,
  repeat_action: "deposit",
  repeat_deposit_percent: 50,
  waive_roles: ["owner", "manager"],
};

const SETTINGS: PolicySettings = {
  ...DEFAULT_POLICY,
  cardRequired: "all",
  windowHours: 48,
  lateCancel: { kind: "fixed", amount: 4000 },
  noShow: { kind: "percent", amount: 50 },
  repeatAction: "deposit",
};

async function client(card?: string) {
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Ria`, last_name: "Test", email: `${TAG.toLowerCase()}${clients.length}@example.com` }).select("id").single();
  clients.push(c!.id);
  if (card) await saveCard(c!.id, card);
  return c!.id;
}

async function saveCard(clientId: string, ref: string) {
  // A card is saved only with what the client agreed to (here, on a visit
  // of theirs).
  const appointmentId = await visit(clientId, { hoursAhead: 24 * 30 });
  const { error } = await admin.rpc("record_online_card", {
    p_appointment_id: appointmentId,
    p_card: { provider: "test", ref, label: ref === "test_visa_0002" ? "Visa …0002" : "Visa …4242" },
    p_consent: { policy_text: "Please give us 48 hours' notice.", terms: { window_hours: 48 } },
    p_deposit: null as never,
  });
  expect(error).toBeNull();
}

// A $100 cut with Bridget (or someone else), hoursAhead from now, booked
// bookedDaysAgo days ago.
async function visit(clientId: string, opts: { hoursAhead: number; bookedDaysAgo?: number; staffId?: string; depositCents?: number }) {
  const start = new Date(Date.now() + opts.hoursAhead * HOUR);
  start.setUTCSeconds(0, 0);
  const end = new Date(start.getTime() + HOUR);
  const { data: a, error } = await admin
    .from("appointments")
    .insert({
      business_id: B,
      location_id: L,
      client_id: clientId,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      created_at: new Date(Date.now() - (opts.bookedDaysAgo ?? 0) * DAY).toISOString(),
      deposit_paid_cents: opts.depositCents ?? 0,
      deposit_provider: opts.depositCents ? "test" : null,
      deposit_reference: opts.depositCents ? `test_ch_dep${randomBytes(6).toString("hex")}` : null,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: cut, staff_id: opts.staffId ?? BRIDGET, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: 10000 });
  return a!.id;
}

const status = (c: Client, id: string, s: "no_show" | "canceled", reason = "") => c.rpc("set_appointment_status", { p_appointment_id: id, p_status: s, p_reason: reason });
const feeOf = async (appointmentId: string) => (await admin.from("policy_fees").select("*").eq("appointment_id", appointmentId).maybeSingle()).data;
// The grace is over: the run charges it now.
const dueNow = (feeId: string) => admin.from("policy_fees").update({ charge_after: new Date(Date.now() - 60_000).toISOString() }).eq("id", feeId);

beforeAll(async () => {
  [owner, manager, frontDesk, stylist] = await Promise.all([
    signIn("owner@mapleandash.test"),
    signIn("manager@mapleandash.test"),
    signIn("frontdesk@mapleandash.test"),
    signIn("bridget@mapleandash.test"),
  ]);
  savedPolicy = (await admin.from("policy_settings").select("*").eq("business_id", B).maybeSingle()).data;
  savedStaffPolicies = (await admin.from("staff_policies").select("*").eq("business_id", B)).data ?? [];
  await admin.from("staff_policies").delete().eq("business_id", B);
  cut = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single()).data!.id;
  expect((await owner.rpc("save_policy_settings", { p_business_id: B, p: POLICY })).error).toBeNull();
});

afterAll(async () => {
  for (const c of clients) await admin.from("appointments").delete().eq("client_id", c);
  await admin.from("clients").delete().in("id", clients);
  await admin.from("policy_settings").delete().eq("business_id", B);
  if (savedPolicy) await admin.from("policy_settings").insert(savedPolicy as never);
  await admin.from("staff_policies").delete().eq("business_id", B);
  if (savedStaffPolicies.length) await admin.from("staff_policies").insert(savedStaffPolicies as never);
});

describe("policy settings", () => {
  it("are set by owners and managers only, and everyone at the salon can read them", async () => {
    expect((await frontDesk.rpc("save_policy_settings", { p_business_id: B, p: POLICY })).error?.code).toBe("42501");
    expect((await frontDesk.rpc("save_staff_policy", { p_staff_id: BRIDGET, p: { cancel_window_hours: 72 } })).error?.code).toBe("42501");
    const { data } = await stylist.from("policy_settings").select("cancel_window_hours, no_show_fee_kind").eq("business_id", B).single();
    expect(data).toEqual({ cancel_window_hours: 48, no_show_fee_kind: "percent" });
    // Nobody writes the table directly.
    expect((await owner.from("policy_settings").update({ cancel_window_hours: 1 }).eq("business_id", B).select()).data).toEqual([]);
  });
});

describe("a no-show", () => {
  it("gets its fee at once, is charged to the card after the grace, and sends a receipt", async () => {
    const c = await client("test_visa_4242");
    const a = await visit(c, { hoursAhead: -1 });
    expect((await status(frontDesk, a, "no_show")).error).toBeNull();
    const fee = (await feeOf(a))!;
    // 50% of the $100 visit, as the app works it out.
    expect(fee.fee_cents).toBe(visitTerms(SETTINGS, [], 10000).noShowCents);
    expect(fee).toMatchObject({ kind: "no_show", fee_cents: 5000, status: "pending", card_label: "Visa …4242" });
    expect(Date.parse(fee.charge_after!) - Date.now()).toBeGreaterThan(9 * 60_000);

    // Not before the grace is over.
    await runPolicyCharges(admin, { feeId: fee.id });
    expect((await feeOf(a))!.status).toBe("pending");

    await dueNow(fee.id);
    const summary = await runPolicyCharges(admin, { feeId: fee.id });
    expect(summary).toMatchObject({ charged: 1, receipts: 1 });
    const charged = (await feeOf(a))!;
    expect(charged).toMatchObject({ status: "charged", provider: "test", attempts: 1 });
    expect(charged.provider_reference).toMatch(/^test_ch_/);
    expect(charged.receipt_sent_at).not.toBeNull();
    const { data: receipt } = await admin.from("outbox_messages").select("body").eq("to_address", `${TAG.toLowerCase()}${clients.indexOf(c)}@example.com`).order("created_at", { ascending: false }).limit(1).single();
    expect(receipt!.body).toContain("$50 fee");
    expect(receipt!.body).toContain("Visa …4242");
    const { data: events } = await admin.from("policy_fee_events").select("kind").eq("fee_id", fee.id).order("created_at");
    expect(events!.map((e) => e.kind)).toEqual(["assessed", "charged", "receipt"]);

    // Running again charges nothing more.
    expect((await runPolicyCharges(admin, { feeId: fee.id })).charged).toBe(0);
  });

  it("taken back before it's charged, takes its fee with it", async () => {
    const c = await client("test_visa_4242");
    const a = await visit(c, { hoursAhead: -1 });
    await status(frontDesk, a, "no_show");
    const { data: loc } = await admin.from("locations").select("calendar_version").eq("id", L).single();
    expect((await frontDesk.rpc("undo_no_show", { p_appointment_id: a, p_expected_version: loc!.calendar_version })).error).toBeNull();
    expect((await feeOf(a))!.status).toBe("voided");
  });

  it("with no card on file is recorded, and charged once a card is added", async () => {
    const c = await client();
    const a = await visit(c, { hoursAhead: -1 });
    await status(frontDesk, a, "no_show");
    expect((await feeOf(a))!.status).toBe("no_card");
    await saveCard(c, "test_visa_4242");
    expect((await feeOf(a))!.status).toBe("pending");
  });
});

describe("a cancellation", () => {
  it("by the client inside the window costs the late fee; in good time, or by the salon, nothing", async () => {
    const c = await client("test_visa_4242");
    const late = await visit(c, { hoursAhead: 20, bookedDaysAgo: 10 });
    const early = await visit(c, { hoursAhead: 72, bookedDaysAgo: 10 });
    const salon = await visit(c, { hoursAhead: 20, bookedDaysAgo: 10 });
    expect((await status(frontDesk, late, "canceled", "Client canceled: car trouble")).error).toBeNull();
    await status(frontDesk, early, "canceled", "Client canceled");
    await status(frontDesk, salon, "canceled", "Stylist unavailable");
    expect(await feeOf(late)).toMatchObject({ kind: "late_cancel", fee_cents: 4000, status: "pending" });
    expect(await feeOf(early)).toBeNull();
    expect(await feeOf(salon)).toBeNull();
    // As the app works it out.
    const start = new Date(Date.now() + 20 * HOUR);
    expect(cancelFee(visitTerms(SETTINGS, [], 10000), { startsAt: start, bookedAt: new Date(Date.now() - 10 * DAY), depositPaidCents: 0 }, new Date(), "Client canceled: car trouble")).toEqual({ late: true, feeCents: 4000 });
  });

  it("follows the long-held rule: the late fee only for visits booked far enough ahead", async () => {
    expect((await owner.rpc("save_policy_settings", { p_business_id: B, p: { ...POLICY, long_hold_days: 21 } })).error).toBeNull();
    const c = await client("test_visa_4242");
    const recent = await visit(c, { hoursAhead: 20, bookedDaysAgo: 3 });
    const held = await visit(c, { hoursAhead: 20, bookedDaysAgo: 30 });
    await status(frontDesk, recent, "canceled", "Client canceled");
    await status(frontDesk, held, "canceled", "Client canceled");
    expect(await feeOf(recent)).toMatchObject({ kind: "late_cancel", fee_cents: 0, status: "none" });
    expect(await feeOf(held)).toMatchObject({ fee_cents: 4000, status: "pending" });
    await owner.rpc("save_policy_settings", { p_business_id: B, p: POLICY });
  });

  it("takes a stylist's stricter rules: a longer window and a higher fee", async () => {
    expect((await owner.rpc("save_staff_policy", { p_staff_id: GIL, p: { cancel_window_hours: 72, no_show_fee_kind: "fixed", no_show_fee_amount: 8000, late_cancel_fee_kind: "fixed", late_cancel_fee_amount: 1000 } })).error).toBeNull();
    const c = await client("test_visa_4242");
    const cancel = await visit(c, { hoursAhead: 60, bookedDaysAgo: 10, staffId: GIL });
    const noShow = await visit(c, { hoursAhead: -1, staffId: GIL });
    await status(frontDesk, cancel, "canceled", "Client canceled");
    await status(frontDesk, noShow, "no_show");
    // Inside Gil's 72 hours; his $10 is lower than the salon's $40, so $40.
    expect(await feeOf(cancel)).toMatchObject({ fee_cents: 4000 });
    // His $80 beats the salon's 50%.
    expect(await feeOf(noShow)).toMatchObject({ fee_cents: 8000 });
    const gil = { staffId: GIL, windowHours: 72, lateCancel: { kind: "fixed" as const, amount: 1000 }, noShow: { kind: "fixed" as const, amount: 8000 } };
    expect(visitTerms(SETTINGS, [gil], 10000)).toMatchObject({ windowHours: 72, lateCancelCents: 4000, noShowCents: 8000 });
    await owner.rpc("save_staff_policy", { p_staff_id: GIL, p: {} });
    expect((await admin.from("staff_policies").select("staff_id").eq("staff_id", GIL)).data).toEqual([]);
  });
});

describe("failed charges", () => {
  it("are flagged to the owners, managers and front desk, and can be tried again with another card", async () => {
    const c = await client("test_visa_0002");
    const a = await visit(c, { hoursAhead: -1 });
    await status(frontDesk, a, "no_show");
    const fee = (await feeOf(a))!;
    await dueNow(fee.id);
    expect((await runPolicyCharges(admin, { feeId: fee.id })).failed).toBe(1);
    expect(await feeOf(a)).toMatchObject({ status: "failed", failure_reason: "The card was declined" });
    const { data: notices } = await admin.from("notifications").select("staff_id, body").eq("appointment_id", a).eq("template", "policy_fee_failed");
    expect(new Set(notices!.map((n) => n.staff_id))).toEqual(new Set([SEED.staff.owner, SEED.staff.manager, SEED.staff.frontDesk]));
    expect(notices![0].body).toContain("didn't go through");

    // Stylists can't retry; the front desk can, once there's a good card.
    expect((await stylist.rpc("retry_policy_fee", { p_fee_id: fee.id })).error?.code).toBe("42501");
    await saveCard(c, "test_visa_4242");
    // (A new card puts only fees with no card back in line, not failed ones.)
    expect((await feeOf(a))!.status).toBe("failed");
    expect((await frontDesk.rpc("retry_policy_fee", { p_fee_id: fee.id })).error).toBeNull();
    expect((await runPolicyCharges(admin, { feeId: fee.id })).charged).toBe(1);
    expect(await feeOf(a)).toMatchObject({ status: "charged", attempts: 2, card_label: "Visa …4242" });
  });
});

describe("waivers", () => {
  it("need a reason and a role the salon allows, before or after charging; a charged fee is refunded", async () => {
    const c = await client("test_visa_4242");
    const before = await visit(c, { hoursAhead: -1 });
    const after = await visit(c, { hoursAhead: -2 });
    await status(frontDesk, before, "no_show");
    await status(frontDesk, after, "no_show");
    const f1 = (await feeOf(before))!;
    const f2 = (await feeOf(after))!;

    // The front desk can't by default; a reason is needed.
    expect((await frontDesk.rpc("waive_policy_fee", { p_fee_id: f1.id, p_reason: "Family emergency" })).error?.code).toBe("42501");
    expect((await manager.rpc("waive_policy_fee", { p_fee_id: f1.id, p_reason: "  " })).error?.code).toBe("22023");
    const { data: w1 } = await manager.rpc("waive_policy_fee", { p_fee_id: f1.id, p_reason: "Family emergency" });
    expect(w1).toEqual({ refund_due: false });
    expect(await feeOf(before)).toMatchObject({ status: "waived", waive_reason: "Family emergency", waived_by: SEED.staff.manager, charge_after: null });
    // Never charged now.
    await dueNow(f1.id);
    expect((await runPolicyCharges(admin, { feeId: f1.id })).charged).toBe(0);

    await dueNow(f2.id);
    await runPolicyCharges(admin, { feeId: f2.id });
    const { data: w2 } = await owner.rpc("waive_policy_fee", { p_fee_id: f2.id, p_reason: "Our booking mistake" });
    expect(w2).toEqual({ refund_due: true });
    expect((await runPolicyCharges(admin, { feeId: f2.id })).refunded).toBe(1);
    expect(await feeOf(after)).toMatchObject({ status: "waived", refund_due: false });
    const { data: events } = await admin.from("policy_fee_events").select("kind, staff_id, detail").eq("fee_id", f2.id).order("created_at");
    expect(events!.map((e) => e.kind)).toEqual(["assessed", "charged", "receipt", "waived", "refunded"]);
    expect(events![3]).toMatchObject({ staff_id: SEED.staff.owner, detail: "Our booking mistake" });

    // The salon can let the front desk waive too.
    await owner.rpc("save_policy_settings", { p_business_id: B, p: { ...POLICY, waive_roles: ["manager", "front_desk"] } });
    const third = await visit(c, { hoursAhead: -3 });
    await status(frontDesk, third, "no_show");
    expect((await frontDesk.rpc("waive_policy_fee", { p_fee_id: (await feeOf(third))!.id, p_reason: "First time" })).error).toBeNull();
    await owner.rpc("save_policy_settings", { p_business_id: B, p: POLICY });
  });
});

describe("repeat offenders", () => {
  it("need a deposit after two strikes in six months; waived ones don't count", async () => {
    const c = await client("test_visa_4242");
    const standing = async () => (await frontDesk.rpc("client_policy_standing", { p_client_id: c })).data as { strikes: number; action: string };
    const first = await visit(c, { hoursAhead: -1 });
    await status(frontDesk, first, "no_show");
    expect(await standing()).toMatchObject({ strikes: 1, action: "off" });
    const second = await visit(c, { hoursAhead: 10, bookedDaysAgo: 10 });
    await status(frontDesk, second, "canceled", "Client canceled");
    expect(await standing()).toMatchObject({ strikes: 2, action: "deposit" });
    await manager.rpc("waive_policy_fee", { p_fee_id: (await feeOf(second))!.id, p_reason: "Hospital" });
    expect(await standing()).toMatchObject({ strikes: 1, action: "off" });
    // Stylists don't see it.
    expect((await stylist.rpc("client_policy_standing", { p_client_id: c })).error?.code).toBe("42501");
  });
});

describe("deposits", () => {
  it("are kept on a late cancellation (covering the fee) and given back when the salon cancels", async () => {
    const c = await client("test_visa_4242");
    const kept = await visit(c, { hoursAhead: 20, bookedDaysAgo: 10, depositCents: 5000 });
    const back = await visit(c, { hoursAhead: 20, bookedDaysAgo: 10, depositCents: 5000 });
    await status(frontDesk, kept, "canceled", "Client canceled");
    await status(frontDesk, back, "canceled", "Salon closed");
    // The $50 deposit beats the $40 fee and pays it all: nothing to charge.
    expect(await feeOf(kept)).toMatchObject({ fee_cents: 5000, from_deposit_cents: 5000, status: "charged" });
    expect((await admin.from("appointments").select("deposit_outcome").eq("id", kept).single()).data!.deposit_outcome).toBe("kept");
    expect((await admin.from("appointments").select("deposit_outcome").eq("id", back).single()).data!.deposit_outcome).toBe("refund_due");
    const summary = await runPolicyCharges(admin, { businessId: B });
    expect(summary.depositsRefunded).toBeGreaterThanOrEqual(1);
    expect((await admin.from("appointments").select("deposit_outcome").eq("id", back).single()).data!.deposit_outcome).toBe("refunded");
  });

  it("come off the bill at checkout, once, as a card payment taken online", async () => {
    const c = await client("test_visa_4242");
    const a = await visit(c, { hoursAhead: 0, depositCents: 3000 });
    const { data: item } = await admin.from("appointment_items").select("id").eq("appointment_id", a).single();
    const { data: biz } = await admin.from("businesses").select("tax_rate_services_bp").eq("id", B).single();
    const total = 10000 + Math.round((10000 * (biz!.tax_rate_services_bp ?? 0)) / 10000);
    const sale = (deposit: number) =>
      frontDesk.rpc("complete_sale", {
        p_location_id: L,
        p_input: {
          appointment_id: a,
          lines: [{ kind: "service", appointment_item_id: item!.id, unit_price_cents: 10000 }],
          payments: [
            { method: "card", amount_cents: deposit, reference: "Deposit paid online" },
            { method: "cash", amount_cents: total - deposit, tendered_cents: total - deposit },
          ],
        } as never,
      });
    expect((await sale(2000)).error?.code).toBe("22023");
    const { data: saleId, error } = await sale(3000);
    expect(error).toBeNull();
    const { data: pay } = await admin.from("payments").select("processor, processor_reference").eq("sale_id", saleId!).eq("method", "card").single();
    expect(pay!.processor).toBe("test");
    expect(pay!.processor_reference).toMatch(/^test_ch_dep/);
    expect((await admin.from("appointments").select("deposit_outcome").eq("id", a).single()).data!.deposit_outcome).toBe("applied");
    await admin.from("sales").delete().eq("id", saleId!);
  });

  it("a void refunds it to the card through the provider, and it isn't taken again at the next checkout", async () => {
    const c = await client("test_visa_4242");
    const a = await visit(c, { hoursAhead: 0, depositCents: 3000 });
    const { data: item } = await admin.from("appointment_items").select("id").eq("appointment_id", a).single();
    const { data: biz } = await admin.from("businesses").select("tax_rate_services_bp").eq("id", B).single();
    const total = 10000 + Math.round((10000 * (biz!.tax_rate_services_bp ?? 0)) / 10000);
    const sale = () =>
      frontDesk.rpc("complete_sale", {
        p_location_id: L,
        p_input: {
          appointment_id: a,
          lines: [{ kind: "service", appointment_item_id: item!.id, unit_price_cents: 10000 }],
          payments: [
            { method: "card", amount_cents: 3000, reference: "Deposit paid online" },
            { method: "cash", amount_cents: total - 3000, tendered_cents: total - 3000 },
          ],
        } as never,
      });
    const { data: saleId } = await sale();
    expect((await manager.rpc("void_sale", { p_sale_id: saleId!, p_reason: "Wrong client" })).error).toBeNull();
    // The card part is due back through the provider; the cash isn't.
    const { data: back } = await admin.from("payments").select("id, method, amount_cents, processor, provider_refund").eq("sale_id", saleId!).lt("amount_cents", 0).order("method");
    expect(back!.map((p) => ({ method: p.method, amount_cents: p.amount_cents, processor: p.processor, provider_refund: p.provider_refund }))).toEqual([
      { method: "cash", amount_cents: -(total - 3000), processor: null, provider_refund: null },
      { method: "card", amount_cents: -3000, processor: "test", provider_refund: "due" },
    ]);
    expect((await admin.from("appointments").select("deposit_outcome").eq("id", a).single()).data!.deposit_outcome).toBe("refund_due");
    expect((await sale()).error?.message).toBe("There's no deposit to apply on this visit");

    const card = back!.find((p) => p.method === "card")!.id;
    expect((await stylist.rpc("record_provider_refund", { p_payment_id: card, p_ok: true })).error?.code).toBe("42501");
    expect((await frontDesk.rpc("record_provider_refund", { p_payment_id: card, p_ok: true })).error?.code).toBe("42501");
    expect((await manager.rpc("record_provider_refund", { p_payment_id: card, p_ok: false })).error).toBeNull();
    expect((await admin.from("payments").select("provider_refund").eq("id", card).single()).data!.provider_refund).toBe("failed");
    expect((await manager.rpc("record_provider_refund", { p_payment_id: card, p_ok: true })).error).toBeNull();
    expect((await admin.from("appointments").select("deposit_outcome").eq("id", a).single()).data!.deposit_outcome).toBe("refunded");
    expect((await manager.rpc("record_provider_refund", { p_payment_id: card, p_ok: true })).error?.code).toBe("55000");
    const { data: events } = await admin.from("sale_events").select("kind, amount_cents").eq("sale_id", saleId!).like("kind", "card_%").order("created_at");
    expect(events).toEqual([{ kind: "card_refund_failed", amount_cents: 3000 }, { kind: "card_refunded", amount_cents: 3000 }]);
    await admin.from("sales").delete().eq("id", saleId!);
  });
});

describe("card links", () => {
  it("are sent by the front of house and completed once by the client, with what they agreed to", async () => {
    const c = await client();
    const a = await visit(c, { hoursAhead: 72 });
    const token = randomBytes(24).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    const send = (who: Client) => who.rpc("create_card_request", { p_client_id: c, p_appointment_id: a, p_token_hash: hash, p_deposit_cents: 2500, p_channel: "email", p_to: "ria@example.com", p_hours: 72 });
    expect((await send(stylist)).error?.code).toBe("42501");
    // A deposit can't be more than the visit costs, or asked for without a visit.
    const ask = (deposit: number, appointment: string | null) =>
      frontDesk.rpc("create_card_request", { p_client_id: c, p_appointment_id: appointment as never, p_token_hash: createHash("sha256").update(randomBytes(8)).digest("hex"), p_deposit_cents: deposit, p_channel: "email", p_to: "ria@example.com", p_hours: 72 });
    expect((await ask(500_000, a)).error?.code).toBe("22023");
    expect((await ask(2500, null)).error?.code).toBe("22023");
    const { data: requestId, error } = await send(frontDesk);
    expect(error).toBeNull();
    const consent = { policy_text: "Please give us 48 hours' notice.", terms: { window_hours: 48 }, ip_hash: "a".repeat(64) };
    const card = { provider: "test", ref: "test_visa_4242", label: "Visa …4242" };
    // Nobody but the service role completes one, and the deposit must match.
    expect((await frontDesk.rpc("complete_card_request", { p_request_id: requestId!, p_card: card, p_consent: consent, p_deposit: { amount_cents: 2500 } })).error).not.toBeNull();
    expect((await admin.rpc("complete_card_request", { p_request_id: requestId!, p_card: card, p_consent: consent, p_deposit: { amount_cents: 100 } })).error?.code).toBe("22023");
    expect((await admin.rpc("complete_card_request", { p_request_id: requestId!, p_card: card, p_consent: consent, p_deposit: { amount_cents: 2500, provider: "test", reference: "test_ch_x" } })).error).toBeNull();
    expect((await admin.rpc("complete_card_request", { p_request_id: requestId!, p_card: card, p_consent: consent, p_deposit: { amount_cents: 2500 } })).error?.hint).toBe("used");

    const { data: saved } = await frontDesk.from("client_cards").select("label, consent:policy_consents(policy_text, channel, agreed_at)").eq("client_id", c).is("removed_at", null).single();
    expect(saved).toMatchObject({ label: "Visa …4242", consent: { policy_text: "Please give us 48 hours' notice.", channel: "link" } });
    expect((await admin.from("appointments").select("deposit_paid_cents").eq("id", a).single()).data!.deposit_paid_cents).toBe(2500);
    // Stylists don't see cards.
    expect((await stylist.from("client_cards").select("id").eq("client_id", c)).data).toEqual([]);
  });

  it("can't be used after they expire", async () => {
    const c = await client();
    const token = randomBytes(24).toString("base64url");
    const { data: id } = await frontDesk.rpc("create_card_request", { p_client_id: c, p_appointment_id: null as never, p_token_hash: createHash("sha256").update(token).digest("hex"), p_deposit_cents: 0, p_channel: "sms", p_to: "(312) 555-0100", p_hours: 1 });
    await admin.from("card_requests").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id!);
    const r = await admin.rpc("complete_card_request", { p_request_id: id!, p_card: { provider: "test", ref: "test_visa_4242", label: "Visa …4242" }, p_consent: { policy_text: "x", terms: {} }, p_deposit: null as never });
    expect(r.error?.hint).toBe("expired");
  });
});
