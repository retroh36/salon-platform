// The rewards program in the database (migration …_rewards.sql): points
// earned when a sale completes (services and retail at their own rates,
// never tips, tax or gift cards), tiers from the last 12 months' spend,
// bonuses (first visit, referral after the new client's first visit,
// rebooking), rewards taken at checkout exactly as the screen prices them,
// refunds and voids taking points back and giving rewards back, birthdays
// and expiry, and who can do what. With a program, tiers, rewards and
// clients of our own; the salon's own program is put back after.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rewardRatesFor } from "@/lib/rewards-load";
import { pointsBack } from "@/lib/rewards";
import { promoRatesFor } from "@/lib/promotions-load";
import { todayIn } from "@/lib/scheduling/time";
import { EMPTY_TICKET, saleInput, ticketProblems, totalsOf, type Rates, type Ticket, type TicketLine } from "@/lib/ticket";
import { admin, SEED, signIn, throwawayStylist, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const TAG = `Rw${Date.now().toString(36)}`;
const HANNAH = SEED.staff.hannah;

let owner: Client;
let manager: Client;
let frontDesk: Client;
let stylist: Client;
let cutId: string;
let glossId: string;
let productId: string;
let goldId: string;
let tenOff: string;
let freeGloss: string;
const clients: string[] = [];
const stylists: Awaited<ReturnType<typeof throwawayStylist>>[] = [];
let before: { program: unknown; tiers: unknown[]; rewards: unknown[] };
// Points the test program gave anyone (birthdays, other tests' sales) are taken out after.
const started = new Date().toISOString();

async function client(name: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}${name}`, last_name: "Test", ...extra }).select("id").single();
  if (error) throw error;
  clients.push(data.id);
  return data.id;
}

const balance = async (clientId: string) => ((await admin.from("reward_points").select("delta").eq("client_id", clientId)).data ?? []).reduce((n, r) => n + r.delta, 0);
const ledger = async (clientId: string) => (await admin.from("reward_points").select("delta, kind, bonus").eq("client_id", clientId).order("created_at")).data!;

let n = 0;
const service = (cents = 10_000, serviceId = cutId, appointmentItemId: string | null = null): TicketLine => ({
  key: `s${++n}`,
  kind: "service",
  appointmentItemId,
  serviceId,
  name: "Service",
  staffId: HANNAH,
  unitPriceCents: cents,
  basePriceCents: cents,
  priceReason: appointmentItemId ? "" : "Test price",
  quantity: 1,
  discount: null,
  packageItemId: null,
});
const product = (quantity = 1): TicketLine => ({ key: `p${++n}`, kind: "product", productId, name: "Shine", staffId: null, unitPriceCents: 2000, quantity, discount: null });

// Sells a ticket, paying what lib/ticket.ts says it comes to; the database
// must agree to the cent.
async function sell(c: Client, clientId: string | null, lines: TicketLine[], over: Partial<Ticket> = {}, appointmentId: string | null = null) {
  const today = todayIn(TZ);
  const [promo, rewards] = await Promise.all([promoRatesFor(admin, { businessId: B, timezone: TZ, today, clientId, appointmentId }), rewardRatesFor(frontDesk, B, clientId)]);
  const ticket: Ticket = { ...EMPTY_TICKET, lines, ...over };
  const rates: Rates = { taxServicesBp: 0, taxRetailBp: 1025, promo, rewards };
  const totals = totalsOf(ticket, rates);
  const tips = Object.values(ticket.tips).reduce((a, b) => a + b, 0);
  const input = { ...saleInput(ticket, { draftId: "", appointmentId, clientId }), payments: totals.totalCents ? [{ method: "card", amount_cents: totals.totalCents }] : [] };
  const { data, error } = await c.rpc("complete_sale", { p_location_id: L, p_input: input as never });
  return { saleId: data as string | null, error, totals, tips, problems: ticketProblems({ ...ticket, payments: totals.totalCents ? [{ key: "card", method: "card" as const, amountCents: totals.totalCents, reference: "" }] : [] }, rates, Boolean(clientId)) };
}

// A visit checked in today with a stylist of its own, ready for checkout.
async function visit(clientId: string, status: "booked" | "checked_in" = "checked_in", hoursFromNow = 0) {
  const own = await throwawayStylist("Rw");
  stylists.push(own);
  const start = new Date(Date.now() + hoursFromNow * 3_600_000);
  const end = new Date(start.getTime() + 3_600_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString(), status }).select("id").single();
  const { data: item } = await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: cutId, staff_id: own.id, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: 10_000 })
    .select("id")
    .single();
  return { appointmentId: a!.id, itemId: item!.id };
}

async function checkout(clientId: string, v: { appointmentId: string; itemId: string }, over: Partial<Ticket> = {}) {
  return sell(frontDesk, clientId, [service(10_000, cutId, v.itemId)], over, v.appointmentId);
}

beforeAll(async () => {
  [owner, manager, frontDesk, stylist] = await Promise.all(["owner", "manager", "frontdesk", "bridget"].map((u) => signIn(`${u}@mapleandash.test`)));
  cutId = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single()).data!.id;
  glossId = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Gloss / Toner").single()).data!.id;
  const { data: p } = await admin.from("products").insert({ business_id: B, brand: TAG, name: "Shine", sku: `${TAG}-S`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 2000 }).select("id").single();
  productId = p!.id;
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: productId, on_hand: 100 });

  // The salon's own program, put back after.
  before = {
    program: (await admin.from("reward_programs").select("*").eq("business_id", B).maybeSingle()).data,
    tiers: (await admin.from("reward_tiers").select("*").eq("business_id", B)).data ?? [],
    rewards: (await admin.from("rewards").select("*").eq("business_id", B)).data ?? [],
  };
  await admin.from("rewards").delete().eq("business_id", B);
  await admin.from("reward_tiers").delete().eq("business_id", B);
  expect(
    (
      await owner.rpc("save_reward_program", {
        p_business_id: B,
        p_program: {
          enabled: true,
          service_points_per_dollar: 2,
          retail_points_per_dollar: 1,
          first_visit_points: 50,
          referral_points: 100,
          rebook_points: 25,
          birthday_points: 75,
          min_redeem_points: 100,
          expiry_months: 12,
          tier_basis: "spend",
        } as never,
      })
    ).error,
  ).toBeNull();
  // Gold from $100 in 12 months: half as many points again.
  expect((await owner.rpc("save_reward_tiers", { p_business_id: B, p_tiers: [{ name: `${TAG} Gold`, threshold: 10_000, bonus_pct: 50 }] as never })).error).toBeNull();
  goldId = (await admin.from("reward_tiers").select("id").eq("business_id", B).single()).data!.id;
  tenOff = (await owner.rpc("save_reward", { p_business_id: B, p_reward: { name: "$10 off", points: 100, kind: "amount", amount_cents: 1000 } as never })).data as string;
  freeGloss = (await owner.rpc("save_reward", { p_business_id: B, p_reward: { name: "Free gloss", points: 150, kind: "free_service", service_ids: [glossId], max_per_year: 1 } as never })).data as string;
});

afterAll(async () => {
  await admin.from("reward_points").delete().in("client_id", clients);
  await admin.from("reward_points").delete().eq("business_id", B).gte("created_at", started);
  await admin.from("appointments").delete().in("client_id", clients);
  await admin.from("sales").delete().in("client_id", clients);
  await admin.from("clients").delete().in("id", clients);
  await admin.from("stock_levels").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
  for (const st of stylists) await st.remove();
  await admin.from("rewards").delete().eq("business_id", B);
  await admin.from("reward_tiers").delete().eq("business_id", B);
  if (before.tiers.length) await admin.from("reward_tiers").insert(before.tiers as never);
  if (before.rewards.length) await admin.from("rewards").insert(before.rewards as never);
  if (before.program) await admin.from("reward_programs").upsert(before.program as never);
  else await admin.from("reward_programs").delete().eq("business_id", B);
});

describe("earning", () => {
  it("earns on services and retail at their own rates, never on tax, tips or gift cards", async () => {
    const c = await client("Earn");
    const giftCard: TicketLine = { key: "g1", kind: "gift_card", amountCents: 5000, physical: false, code: "", recipientName: "", recipientEmail: "someone@example.test" } as TicketLine;
    const { error } = await sell(frontDesk, c, [service(10_000), product(1), giftCard], { tips: { [HANNAH]: 1500 } });
    expect(error).toBeNull();
    // $100 of services at 2 a dollar, $20 of retail at 1 (not its tax), nothing for the tip or gift card.
    expect(await ledger(c)).toEqual([{ delta: 220, kind: "earn", bonus: null }]);
  });

  it("adds the tier's bonus once a client has reached it, counting what they spent before this sale", async () => {
    const c = await client("Tier");
    await sell(frontDesk, c, [service(10_000)]);
    expect(await balance(c)).toBe(200);
    // Now Gold ($100 spent): 200 and half again.
    const { data: summary } = await frontDesk.rpc("client_rewards", { p_client_id: c });
    expect((summary as { tier_id: string }).tier_id).toBe(goldId);
    await sell(frontDesk, c, [service(10_000)]);
    expect(await balance(c)).toBe(200 + 300);
  });

  it("gives a first-visit bonus and a rebooking bonus", async () => {
    const c = await client("First");
    const next = await visit(c, "booked", 24 * 42);
    const { error } = await checkout(c, await visit(c), { rebook: { appointmentId: next.appointmentId, startsAt: "", label: "" } as never });
    expect(error).toBeNull();
    expect((await ledger(c)).map((r) => [r.kind, r.bonus, r.delta])).toEqual(
      expect.arrayContaining([
        ["earn", null, 200],
        ["bonus", "first_visit", 50],
        ["bonus", "rebook", 25],
      ]),
    );
    // Not their first visit any more.
    const again = await checkout(c, await visit(c, "checked_in", 1));
    expect(again.error).toBeNull();
    expect((await ledger(c)).filter((r) => r.bonus === "first_visit")).toHaveLength(1);
  });
});

describe("referrals", () => {
  it("rewards both clients only once the new client's first visit is checked out", async () => {
    const friend = await client("Friend");
    const { data: s } = await frontDesk.rpc("client_rewards", { p_client_id: friend });
    const code = (s as { referral_code: string }).referral_code;
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);

    const fresh = await client("Fresh");
    expect((await admin.rpc("set_referred_by", { p_client_id: fresh, p_code: code })).data).toBe(true);
    // Only once, never themselves, never someone who's already visited.
    expect((await admin.rpc("set_referred_by", { p_client_id: fresh, p_code: code })).data).toBe(false);
    expect((await admin.rpc("set_referred_by", { p_client_id: friend, p_code: code })).data).toBe(false);
    expect((await frontDesk.rpc("set_referred_by" as never, { p_client_id: fresh, p_code: code } as never)).error).not.toBeNull();

    // A retail sale isn't a visit: nothing yet.
    await sell(frontDesk, fresh, [product(1)]);
    expect((await ledger(friend)).filter((r) => r.bonus === "referral")).toHaveLength(0);
    await checkout(fresh, await visit(fresh));
    expect((await ledger(friend)).filter((r) => r.bonus === "referral").map((r) => r.delta)).toEqual([100]);
    expect((await ledger(fresh)).filter((r) => r.bonus === "referral").map((r) => r.delta)).toEqual([100]);
    // Their next visit adds nothing more.
    await checkout(fresh, await visit(fresh, "checked_in", 1));
    expect((await ledger(friend)).filter((r) => r.bonus === "referral")).toHaveLength(1);
  });
});

describe("redeeming at checkout", () => {
  it("takes rewards off as the screen does, uses the points, and limits each to its yearly uses", async () => {
    const c = await client("Redeem");
    await admin.from("reward_points").insert({ business_id: B, client_id: c, delta: 400, kind: "adjust", reason: "Test" });
    const lines = [service(10_000), service(4500, glossId)];
    const sale = await sell(frontDesk, c, lines, { rewards: [freeGloss, tenOff] });
    expect(sale.problems).toEqual([]);
    expect(sale.error).toBeNull();
    expect(sale.totals.rewardDiscountCents).toBe(4500 + 1000);
    const { data: row } = await admin.from("sales").select("total_cents").eq("id", sale.saleId!).single();
    expect(row!.total_cents).toBe(sale.totals.totalCents);
    const used = (await admin.from("reward_points").select("delta, discount_cents").eq("sale_id", sale.saleId!).eq("kind", "redeem").order("delta")).data!;
    expect(used).toEqual([
      { delta: -150, discount_cents: 4500 },
      { delta: -100, discount_cents: 1000 },
    ]);
    // Earned on what was paid: $90 of services at 2 a dollar.
    expect(await balance(c)).toBe(400 - 250 + 180);
    // A free gloss once a year.
    const again = await sell(frontDesk, c, [service(4500, glossId)], { rewards: [freeGloss] });
    expect(again.problems).toEqual(["Free gloss: Already used this year."]);
    expect(again.error?.message).toBe("Free gloss: already used this year");
    // Not a promotion: no use recorded there.
    expect((await admin.from("promotion_redemptions").select("id").eq("sale_id", sale.saleId!)).data).toEqual([]);
  });

  it("needs the points, the minimum and something it covers", async () => {
    const c = await client("Short");
    await admin.from("reward_points").insert({ business_id: B, client_id: c, delta: 90, kind: "adjust", reason: "Test" });
    const low = await sell(frontDesk, c, [service(10_000)], { rewards: [tenOff] });
    expect(low.problems).toEqual(["$10 off: Rewards start at 100 points."]);
    expect(low.error?.message).toBe("Rewards start at 100 points");
    await admin.from("reward_points").insert({ business_id: B, client_id: c, delta: 10, kind: "adjust", reason: "Test" });
    const gloss = await sell(frontDesk, c, [service(4500, glossId)], { rewards: [freeGloss] });
    expect(gloss.problems).toEqual(["Free gloss: 50 more points needed."]);
    expect(gloss.error?.message).toBe("Free gloss: 50 more points needed");
    await admin.from("reward_points").insert({ business_id: B, client_id: c, delta: 100, kind: "adjust", reason: "Test" });
    const nothing = await sell(frontDesk, c, [product(1)], { rewards: [freeGloss] });
    expect(nothing.problems).toEqual(["Free gloss doesn't cover anything on this sale."]);
    expect(nothing.error?.message).toBe("Free gloss doesn't cover anything on this sale");
    expect((await sell(frontDesk, null, [service(10_000)], { rewards: [tenOff] })).error?.message).toBe("Choose the client taking the reward");
  });

  it("doesn't go with a promotion unless the salon allows it", async () => {
    const c = await client("Stack");
    await admin.from("reward_points").insert({ business_id: B, client_id: c, delta: 500, kind: "adjust", reason: "Test" });
    const { data: promo } = await owner.rpc("save_promotion", {
      p_business_id: B,
      p_promotion_id: null as never,
      p_input: { name: `${TAG} Promo`, kind: "automatic", discount_kind: "percent", percent: 10, applies_services: true, applies_retail: false, stackable: true } as never,
    });
    try {
      const both = await sell(frontDesk, c, [service(10_000)], { promotions: [promo as string], rewards: [tenOff] });
      expect(both.problems).toContain("Rewards can't be used with a promotion.");
      expect(both.error?.message).toBe("Rewards can't be used with a promotion");
      await admin.from("reward_programs").update({ stack_with_promotions: true }).eq("business_id", B);
      const ok = await sell(frontDesk, c, [service(10_000)], { promotions: [promo as string], rewards: [tenOff] });
      expect(ok.error).toBeNull();
      // 10% off first, then $10.
      expect(ok.totals.totalCents).toBe(8000);
    } finally {
      await admin.from("reward_programs").update({ stack_with_promotions: false }).eq("business_id", B);
      await admin.from("promotion_redemptions").delete().eq("promotion_id", promo as string);
      await admin.from("promotions").delete().eq("id", promo as string);
    }
  });
});

describe("tier perks", () => {
  it("gives Gold clients their free add-on once a sale, and no one else", async () => {
    await admin.from("reward_tiers").update({ free_addon_service_id: glossId }).eq("id", goldId);
    try {
      const silver = await client("NoTier");
      const none = await sell(frontDesk, silver, [service(10_000), service(4500, glossId)], { tierPerk: true });
      expect(none.problems).toEqual(["This client's tier has no free add-on."]);
      expect(none.error?.message).toBe("This client's tier has no free add-on");
      const gold = await client("Gold");
      await sell(frontDesk, gold, [service(12_000)]);
      const perk = await sell(frontDesk, gold, [service(10_000), service(4500, glossId), service(4500, glossId)], { tierPerk: true });
      expect(perk.problems).toEqual([]);
      expect(perk.error).toBeNull();
      // One gloss free, the other paid; no points spent.
      expect(perk.totals.rewardDiscountCents).toBe(4500);
      expect((await admin.from("sales").select("total_cents").eq("id", perk.saleId!).single()).data!.total_cents).toBe(14_500);
      expect((await admin.from("reward_points").select("kind").eq("sale_id", perk.saleId!)).data!.map((r) => r.kind)).toEqual(["earn"]);
    } finally {
      await admin.from("reward_tiers").update({ free_addon_service_id: null }).eq("id", goldId);
    }
  });
});

describe("refunds and voids", () => {
  it("takes back a refund's share of the points, then all of them, and gives the reward back", async () => {
    const c = await client("Refund");
    await admin.from("reward_points").insert({ business_id: B, client_id: c, delta: 100, kind: "adjust", reason: "Test" });
    const sale = await sell(frontDesk, c, [service(10_000), service(10_000)], { rewards: [tenOff] });
    expect(sale.error).toBeNull();
    const earned = 380; // $190 at 2 a dollar
    expect(await balance(c)).toBe(earned);
    const refund = (cents: number) => manager.rpc("refund_sale", { p_sale_id: sale.saleId!, p_input: { reason: "Not happy", payments: [{ method: "card", amount_cents: cents }] } as never });
    expect((await refund(4750)).error).toBeNull();
    const back = pointsBack(earned, 4750, 19_000);
    expect(back).toBe(95);
    expect(await balance(c)).toBe(earned - back);
    expect((await refund(19_000 - 4750)).error).toBeNull();
    // Everything it earned taken back, and the $10 off's 100 points given back.
    expect(await balance(c)).toBe(100);
  });

  it("takes back bonuses and gives rewards back when a sale is voided", async () => {
    const c = await client("Void");
    await admin.from("reward_points").insert({ business_id: B, client_id: c, delta: 150, kind: "adjust", reason: "Test" });
    const sale = await sell(frontDesk, c, [service(10_000, cutId), service(4500, glossId)], { rewards: [freeGloss] });
    expect(sale.error).toBeNull();
    expect((await manager.rpc("void_sale", { p_sale_id: sale.saleId!, p_reason: "Wrong client" })).error).toBeNull();
    expect(await balance(c)).toBe(150);
    // The gloss can be taken again this year.
    const again = await sell(frontDesk, c, [service(4500, glossId)], { rewards: [freeGloss] });
    expect(again.problems).toEqual([]);
    expect(again.error).toBeNull();
  });
});

describe("the nightly jobs", () => {
  it("gives a birthday bonus once a year", async () => {
    const today = todayIn(TZ);
    const [, m, d] = today.split("-").map(Number);
    const c = await client("Bday", { birth_month: m, birth_day: d });
    await admin.rpc("run_reward_jobs", { p_business_id: B, p_today: today });
    await admin.rpc("run_reward_jobs", { p_business_id: B, p_today: today });
    expect((await ledger(c)).filter((r) => r.bonus === "birthday").map((r) => r.delta)).toEqual([75]);
  });

  it("expires points after the set months without earning, and only then", async () => {
    const old = await client("Old");
    const recent = await client("Recent");
    const longAgo = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const { error: setup } = await admin.from("reward_points").insert([
      { business_id: B, client_id: old, delta: 300, kind: "earn", created_at: longAgo },
      { business_id: B, client_id: old, delta: -100, kind: "adjust", reason: "Test", created_at: longAgo },
      { business_id: B, client_id: recent, delta: 300, kind: "earn", created_at: longAgo },
      { business_id: B, client_id: recent, delta: 10, kind: "earn", created_at: new Date().toISOString() },
    ]);
    expect(setup).toBeNull();
    const { error } = await admin.rpc("run_reward_jobs", { p_business_id: B, p_today: todayIn(TZ) });
    expect(error).toBeNull();
    expect(await balance(old)).toBe(0);
    expect((await ledger(old)).at(-1)).toEqual({ delta: -200, kind: "expire", bonus: null });
    expect(await balance(recent)).toBe(310);
  });
});

describe("who can do what", () => {
  it("lets those with adjust_points add or take off points, always with a reason", async () => {
    const c = await client("Adjust");
    expect((await frontDesk.rpc("adjust_reward_points", { p_client_id: c, p_delta: 50, p_reason: "Goodwill" })).error?.code).toBe("42501");
    expect((await stylist.rpc("adjust_reward_points", { p_client_id: c, p_delta: 50, p_reason: "Goodwill" })).error?.code).toBe("42501");
    expect((await manager.rpc("adjust_reward_points", { p_client_id: c, p_delta: 50, p_reason: " " })).error?.message).toBe("Say why");
    const { data, error } = await manager.rpc("adjust_reward_points", { p_client_id: c, p_delta: 50, p_reason: "Goodwill" });
    expect(error).toBeNull();
    expect(data).toBe(50);
    const { data: row } = await admin.from("reward_points").select("kind, reason, staff_id").eq("client_id", c).single();
    expect(row).toEqual({ kind: "adjust", reason: "Goodwill", staff_id: SEED.staff.manager });
  });

  it("keeps the program to settings, points to the front of house, and the report to reports", async () => {
    const c = await client("Who");
    await admin.from("reward_points").insert({ business_id: B, client_id: c, delta: 10, kind: "adjust", reason: "Test" });
    expect((await frontDesk.rpc("save_reward_program", { p_business_id: B, p_program: { enabled: false } as never })).error?.code).toBe("42501");
    expect((await frontDesk.rpc("save_reward", { p_business_id: B, p_reward: { name: "Nope", points: 1, kind: "amount", amount_cents: 100 } as never })).error?.code).toBe("42501");
    expect((await stylist.from("reward_points").select("id").eq("client_id", c)).data).toEqual([]);
    expect((await frontDesk.from("reward_points").select("id").eq("client_id", c)).data).toHaveLength(1);
    expect((await stylist.rpc("client_rewards", { p_client_id: c })).error?.code).toBe("42501");
    expect((await frontDesk.rpc("rewards_report", { p_business_id: B, p_from: new Date(0).toISOString(), p_to: new Date().toISOString() })).error?.code).toBe("42501");
    const { data: report, error } = await owner.rpc("rewards_report", { p_business_id: B, p_from: new Date(Date.now() - 86_400_000).toISOString(), p_to: new Date(Date.now() + 60_000).toISOString() });
    expect(error).toBeNull();
    expect((report as { outstanding: number }).outstanding).toBeGreaterThan(0);
    expect((await admin.rpc("account_rewards", { p_client_id: c })).data).toMatchObject({ balance: 10 });
    expect((await frontDesk.rpc("account_rewards" as never, { p_client_id: c } as never)).error).not.toBeNull();
  });
});
