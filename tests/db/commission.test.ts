// Commission plans in the database (migration …_commission_plans.sql):
// who may change them, lines recording their plan version, tiers on real
// sales in a quiet month of our own (counting the month's earlier sales),
// past pay staying put when a plan changes, and My day agreeing with Payroll.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSale } from "@/lib/checkout";
import { loadLiveEarnings } from "@/lib/earnings-load";
import { loadPayroll } from "@/lib/payroll-load";
import { todayIn } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const GIL = SEED.staff.gil;
const TIERS = "e1000000-0000-4000-8000-000000000001";
const today = todayIn(TZ);
// May 2020, long before the demo history: a $3,900 color on the 3rd, then
// a $200 cut in our period, which crosses Gil's $4,000 tier.
const PERIOD = { from: "2020-05-10", to: "2020-05-20" };

let owner: Client;
let manager: Client;
let frontDesk: Client;
let gil: Client;
let clientId: string;
const made: string[] = [];

async function sell(at: string, cents: number, tip: number): Promise<string> {
  const [{ data: service }, { data: b }] = await Promise.all([
    admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single(),
    admin.from("businesses").select("tax_rate_services_bp").eq("id", B).single(),
  ]);
  const end = new Date(Date.parse(at) + 3_600_000).toISOString();
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: at, ends_at: end, status: "checked_in" }).select("id").single();
  const { data: item } = await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: service!.id, staff_id: GIL, starts_at: at, ends_at: end, active_minutes: 60, price_cents: cents })
    .select("id")
    .single();
  const total = computeSale([{ grossCents: cents, taxBp: b!.tax_rate_services_bp ?? 0, discountable: true }], null, [tip]).totalCents;
  const { data, error } = await frontDesk.rpc("complete_sale", {
    p_location_id: L,
    p_input: { appointment_id: a!.id, lines: [{ kind: "service", appointment_item_id: item!.id }], tips: [{ staff_id: GIL, amount_cents: tip }], payments: [{ method: "card", amount_cents: total }] } as never,
  });
  if (error) throw error;
  await admin.from("sales").update({ created_at: at }).eq("id", data as string);
  made.push(data as string);
  return data as string;
}

const RULES = {
  mode: "commission",
  service: [
    { from_cents: 0, pct: 40 },
    { from_cents: 400000, pct: 45 },
    { from_cents: 800000, pct: 50 },
  ],
  retail: [{ from_cents: 0, pct: 15 }],
  tier_period: "month",
  tier_style: "marginal",
  backbar: { kind: "fixed", value: 300 },
};

beforeAll(async () => {
  [owner, manager, frontDesk, gil] = await Promise.all(["owner", "manager", "frontdesk", "gil"].map((u) => signIn(`${u}@mapleandash.test`)));
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: "Tiera", last_name: "Test" }).select("id").single();
  clientId = c!.id;
  await sell("2020-05-03T16:00:00Z", 390_000, 0);
  await sell("2020-05-12T16:00:00Z", 20_000, 2_000);
});

afterAll(async () => {
  await admin.from("sales").delete().in("id", made);
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
  // Back to the seeded rules, as the current version.
  await owner.rpc("save_commission_plan", { p_business_id: B, p_plan_id: TIERS, p_name: "Senior tiers", p_rules: RULES as never, p_default: false });
});

describe("who changes plans", () => {
  it("is whoever runs payroll; the rules are checked", async () => {
    const save = (c: Client, rules: object) => c.rpc("save_commission_plan", { p_business_id: B, p_plan_id: null as never, p_name: "Test plan", p_rules: rules as never, p_default: false });
    expect((await save(frontDesk, RULES)).error?.code).toBe("42501");
    expect((await save(gil, RULES)).error?.code).toBe("42501");
    expect((await save(owner, { ...RULES, service: [{ from_cents: 100, pct: 40 }] })).error?.code).toBe("22023");
    expect((await save(owner, { ...RULES, service: [{ from_cents: 0, pct: 40 }, { from_cents: 0, pct: 45 }] })).error?.code).toBe("22023");
    // Booth rent is gone, and every plan says how its tiers pay.
    expect((await save(owner, { ...RULES, mode: "booth_rent" })).error?.code).toBe("22023");
    expect((await save(owner, { ...RULES, rent: { cents: 35000, per: "week" } })).error?.code).toBe("22023");
    expect((await save(owner, { ...RULES, tier_style: "cliff" })).error?.code).toBe("22023");
    const { data: id, error } = await save(manager, RULES);
    expect(error).toBeNull();
    // Nobody's on it, so it can go; Senior tiers can't while Gil is on it.
    expect((await manager.rpc("archive_commission_plan", { p_plan_id: TIERS })).error?.code).toBe("55000");
    expect((await manager.rpc("archive_commission_plan", { p_plan_id: id as string })).error).toBeNull();
    await admin.from("commission_plans").delete().eq("id", id as string);
  });

  it("keeps plans from the front desk, and gives stylists only their own rules", async () => {
    expect((await frontDesk.from("commission_plans").select("id")).data).toEqual([]);
    expect((await frontDesk.rpc("commission_rules", { p_business_id: B })).error?.code).toBe("42501");
    expect((await gil.rpc("commission_rules", { p_business_id: B, p_staff_id: SEED.staff.bridget })).error?.code).toBe("42501");
    const { data } = await gil.rpc("commission_rules", { p_business_id: B, p_staff_id: GIL });
    expect(new Set((data as { plan_id: string }[]).map((v) => v.plan_id))).toEqual(new Set([TIERS]));
  });

  it("puts someone on a plan as a pay change, and new people on the default", async () => {
    const shae = SEED.staff.shae;
    expect((await frontDesk.rpc("set_staff_commission_plan", { p_staff_id: shae, p_plan_id: TIERS })).error?.code).toBe("42501");
    expect((await owner.rpc("set_staff_commission_plan", { p_staff_id: shae, p_plan_id: TIERS })).error).toBeNull();
    const { data: h } = await admin.from("staff_compensation_history").select("plan_id").eq("staff_id", shae).order("created_at", { ascending: false }).limit(1).single();
    expect(h!.plan_id).toBe(TIERS);
    expect((await owner.rpc("set_staff_commission_plan", { p_staff_id: shae, p_plan_id: null as never })).error).toBeNull();
    await admin.from("staff_compensation_history").delete().eq("staff_id", shae).gt("effective_from", "2000-01-01");

    await admin.from("commission_plans").update({ is_default: true }).eq("id", TIERS);
    const { data: s } = await admin
      .from("staff")
      .insert({ business_id: B, location_id: L, first_name: "Newt", last_name: "Plan", email: `newt-${Date.now()}@example.com`, role: "stylist", is_active: true })
      .select("id")
      .single();
    const { data: comp } = await admin.from("staff_compensation").select("plan_id").eq("staff_id", s!.id).single();
    expect(comp!.plan_id).toBe(TIERS);
    await admin.from("commission_plans").update({ is_default: false }).eq("id", TIERS);
    await admin.from("staff").delete().eq("id", s!.id);
  });
});

describe("booth rent", () => {
  it("is gone: no booth rent plans, and nobody on one", async () => {
    const { data } = await admin.from("commission_plan_versions").select("id, rules");
    expect(data!.filter((v) => (v.rules as { mode: string }).mode === "booth_rent")).toEqual([]);
    expect(data!.every((v) => !("rent" in (v.rules as object)))).toBe(true);
    const { data: plans } = await admin.from("commission_plans").select("name");
    expect(plans!.map((p) => p.name)).not.toContain("Booth rent");
  });
});

describe("tiers on real sales", () => {
  it("records the plan version on each line", async () => {
    const { data } = await admin.from("sale_items").select("commission_version_id, commission_pct").in("sale_id", made);
    expect(data!.every((l) => l.commission_version_id && Number(l.commission_pct) === 40)).toBe(true);
  });

  it("pays the cut at both rates, counting the month's earlier color, less the back-bar fee", async () => {
    const [pay] = await loadPayroll(owner, B, TZ, PERIOD, today, GIL);
    expect(pay.serviceCents).toBe(20_000);
    // $100 at 40% and $100 at 45%, on what's left after the $3 fee.
    expect(pay.feeCents).toBe(300);
    expect(pay.serviceCommissionCents).toBe(Math.round(8_500 * (19_700 / 20_000)));
    expect(pay.totalCents).toBe(pay.serviceCommissionCents + 2_000);
    expect(pay.rates.plans).toEqual(["Senior tiers"]);
    // Gil sees the same, on his own.
    const [own] = await loadPayroll(gil, B, TZ, PERIOD, today, GIL);
    expect(own.totalCents).toBe(pay.totalCents);
  });

  it("never changes past pay when the plan changes, rates or tier style", async () => {
    const before = (await loadPayroll(owner, B, TZ, PERIOD, today, GIL))[0].totalCents;
    for (const rules of [{ ...RULES, service: [{ from_cents: 0, pct: 60 }] }, { ...RULES, tier_style: "retroactive" }]) {
      expect((await owner.rpc("save_commission_plan", { p_business_id: B, p_plan_id: TIERS, p_name: "Senior tiers", p_rules: rules as never, p_default: false })).error).toBeNull();
      expect((await loadPayroll(owner, B, TZ, PERIOD, today, GIL))[0].totalCents).toBe(before);
    }
  });

  it("retroactive: the cut that crosses $4,000 also lifts the month's color to 45%", async () => {
    // The plan is retroactive now (above); June 2020 is sold under it.
    await sell("2020-06-03T16:00:00Z", 390_000, 0);
    await sell("2020-06-12T16:00:00Z", 20_000, 0);
    const [pay] = await loadPayroll(owner, B, TZ, { from: "2020-06-10", to: "2020-06-20" }, today, GIL);
    // $200 at 45% plus 5 points on the $3,900, on what's left after the $3 fee.
    expect(pay.serviceCommissionCents).toBe(Math.round((9_000 + 19_500) * (19_700 / 20_000)));
    // May, sold under the marginal version, still pays as it did.
    expect((await loadPayroll(owner, B, TZ, PERIOD, today, GIL))[0].serviceCommissionCents).toBe(Math.round(8_500 * (19_700 / 20_000)));
  });
});

describe("My day", () => {
  it("adds up to what Payroll pays for the period so far", async () => {
    const live = await loadLiveEarnings(gil, { id: GIL, business_id: B, location: { id: L, timezone: TZ } });
    const [pay] = await loadPayroll(owner, B, TZ, live.period.range, today, GIL);
    expect(Math.abs(live.period.commissionCents - (pay.serviceCommissionCents + pay.retailCommissionCents))).toBeLessThanOrEqual(1);
    expect(live.period.tipCents).toBe(pay.tipCents);
    expect(live.period.feeCents).toBe(pay.feeCents);
    expect(live.planName).toBe("Senior tiers");
  });
});
