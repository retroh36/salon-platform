// Payroll in the database: who may see whose pay (payroll_sales), and the
// pay worked out from real sales, a refund and voids in a quiet period of
// our own, checked against the sale rows directly; hours from schedules.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSale } from "@/lib/checkout";
import { loadPayroll } from "@/lib/payroll-load";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, shae: SHAE, frontDesk: SAM } = SEED.staff;
// Two weeks in 2020, long before the demo history.
const PERIOD = { from: "2020-03-02", to: "2020-03-15" };
const RANGE = { p_from: "2020-03-02T06:00:00Z", p_to: "2020-03-16T05:00:00Z" };
const today = "2026-10-23";

let owner: Client;
let manager: Client;
let frontDesk: Client;
let bridget: Client;
let clientId: string;
let productId: string;
const sales: Record<"kept" | "voidedSoon" | "voidedLater", string> = { kept: "", voidedSoon: "", voidedLater: "" };

// A $100 cut with Bridget (a visit of its own), a product she sold and one
// Shae sold, and a $15 tip for Bridget, paid by card.
async function sell(): Promise<string> {
  const [{ data: cut }, { data: product }, { data: b }] = await Promise.all([
    admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single(),
    admin.from("products").select("id, price_cents").eq("id", productId).single(),
    admin.from("businesses").select("tax_rate_services_bp, tax_rate_retail_bp").eq("id", B).single(),
  ]);
  const start = "2020-03-03T16:00:00Z";
  const end = "2020-03-03T17:00:00Z";
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start, ends_at: end, status: "checked_in" }).select("id").single();
  const { data: item } = await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: cut!.id, staff_id: BRIDGET, starts_at: start, ends_at: end, active_minutes: 60, price_cents: 10000 })
    .select("id")
    .single();
  const total = computeSale(
    [
      { grossCents: 10000, taxBp: b!.tax_rate_services_bp, discountable: true },
      { grossCents: product!.price_cents, taxBp: b!.tax_rate_retail_bp, discountable: true },
      { grossCents: product!.price_cents, taxBp: b!.tax_rate_retail_bp, discountable: true },
    ],
    null,
    [1500],
  ).totalCents;
  const { data, error } = await frontDesk.rpc("complete_sale", {
    p_location_id: L,
    p_input: {
      appointment_id: a!.id,
      lines: [
        { kind: "service", appointment_item_id: item!.id },
        { kind: "product", product_id: product!.id, staff_id: BRIDGET, quantity: 1 },
        { kind: "product", product_id: product!.id, staff_id: SHAE, quantity: 1 },
      ],
      tips: [{ staff_id: BRIDGET, amount_cents: 1500 }],
      payments: [{ method: "card", amount_cents: total }],
    } as never,
  });
  if (error) throw error;
  return data as string;
}

beforeAll(async () => {
  [owner, manager, frontDesk, bridget] = await Promise.all(
    ["owner", "manager", "frontdesk", "bridget"].map((u) => signIn(`${u}@mapleandash.test`)),
  );
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: "Payrolla", last_name: "Test" }).select("id").single();
  clientId = c!.id;
  const { data: p } = await admin
    .from("products")
    .insert({ business_id: B, brand: "Payroll", name: "Test Spray", sku: `PAY-${Date.now()}`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 2000 })
    .select("id")
    .single();
  productId = p!.id;
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: productId, on_hand: 50 });
  sales.kept = await sell();
  sales.voidedSoon = await sell();
  sales.voidedLater = await sell();
  const { data: kept } = await admin.from("sales").select("total_cents").eq("id", sales.kept).single();
  // Kept: sold on the 3rd, a quarter refunded on the 10th.
  const quarter = Math.round(kept!.total_cents / 4);
  expect((await manager.rpc("refund_sale", { p_sale_id: sales.kept, p_input: { reason: "Fringe redo", payments: [{ method: "card", amount_cents: quarter }] } as never })).error).toBeNull();
  expect((await manager.rpc("void_sale", { p_sale_id: sales.voidedSoon, p_reason: "Rang up twice" })).error).toBeNull();
  expect((await manager.rpc("void_sale", { p_sale_id: sales.voidedLater, p_reason: "Wrong client" })).error).toBeNull();
  // Back-date them into our quiet period (and the last one before it).
  await admin.from("sales").update({ created_at: "2020-03-03T16:00:00Z" }).eq("id", sales.kept);
  await admin.from("sale_events").update({ created_at: "2020-03-10T16:00:00Z" }).eq("sale_id", sales.kept).eq("kind", "refunded");
  await admin.from("sales").update({ created_at: "2020-03-04T16:00:00Z", voided_at: "2020-03-04T17:00:00Z" }).eq("id", sales.voidedSoon);
  await admin.from("sales").update({ created_at: "2020-02-20T16:00:00Z", voided_at: "2020-03-06T16:00:00Z" }).eq("id", sales.voidedLater);
});

afterAll(async () => {
  await admin.from("sales").delete().eq("client_id", clientId);
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("stock_movements").delete().eq("product_id", productId);
  await admin.from("stock_levels").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
});

describe("who sees pay", () => {
  it("is everyone's for owners and managers, nobody's for the front desk, and only your own otherwise", async () => {
    for (const c of [owner, manager]) expect((await c.rpc("payroll_sales", { p_business_id: B, ...RANGE })).error).toBeNull();
    expect((await frontDesk.rpc("payroll_sales", { p_business_id: B, ...RANGE })).error?.code).toBe("42501");
    expect((await bridget.rpc("payroll_sales", { p_business_id: B, ...RANGE })).error?.code).toBe("42501");
    expect((await bridget.rpc("payroll_sales", { p_business_id: B, ...RANGE, p_staff_id: SHAE })).error?.code).toBe("42501");
    // Her own: only her lines and tips, never Shae's.
    const { data, error } = await bridget.rpc("payroll_sales", { p_business_id: B, ...RANGE, p_staff_id: BRIDGET });
    expect(error).toBeNull();
    const list = data as { lines: { staff_id: string }[]; tips: { staff_id: string }[] }[];
    expect(list.length).toBe(3);
    expect(list.flatMap((s) => [...s.lines, ...s.tips]).every((x) => x.staff_id === BRIDGET)).toBe(true);
    // Another salon's owner sees none of it.
    expect((await owner.rpc("payroll_sales", { p_business_id: "b0000000-0000-4000-8000-000000000099", ...RANGE })).error?.code).toBe("42501");
  });

  it("lets only owners change the pay period", async () => {
    expect((await manager.rpc("set_payroll_settings", { p_business_id: B, p_pay_period: "weekly", p_anchor: "2026-01-05" })).error?.code).toBe("42501");
    expect((await owner.rpc("set_payroll_settings", { p_business_id: B, p_pay_period: "fortnightly", p_anchor: "2026-01-05" })).error?.code).toBe("22023");
    expect((await owner.rpc("set_payroll_settings", { p_business_id: B, p_pay_period: "biweekly", p_anchor: "2026-01-05" })).error).toBeNull();
  });
});

describe("pay for a period", () => {
  it("counts the sale, takes back the refund's share and the later void, and nets out the void in the same period", async () => {
    const rows = async (id: string) => (await admin.from("sale_items").select("kind, staff_id, total_cents, tax_cents").eq("sale_id", id)).data!;
    const net = (items: Awaited<ReturnType<typeof rows>>, kind: string) => items.filter((i) => i.staff_id === BRIDGET && i.kind === kind).reduce((n, i) => n + i.total_cents - i.tax_cents, 0);
    const kept = await rows(sales.kept);
    const later = await rows(sales.voidedLater);
    const { data: k } = await admin.from("sales").select("total_cents, refunded_cents").eq("id", sales.kept).single();
    const share = k!.refunded_cents / k!.total_cents;

    const [pay] = await loadPayroll(owner, B, TZ, PERIOD, today, BRIDGET);
    expect(pay.tickets.map((t) => t.kind)).toEqual(["sale", "sale", "void", "void", "refund"]);
    expect(pay.serviceCents).toBe(net(kept, "service") - Math.round(net(kept, "service") * share) - net(later, "service"));
    expect(pay.retailCents).toBe(net(kept, "product") - Math.round(net(kept, "product") * share) - net(later, "product"));
    expect(pay.tipCents).toBe(1500 - Math.round(1500 * share) - 1500);
    const { data: comp } = await admin.from("staff_compensation").select("service_commission_pct, retail_commission_pct").eq("staff_id", BRIDGET).single();
    expect(pay.serviceCommissionCents).toBe(Math.round((pay.serviceCents * Number(comp!.service_commission_pct)) / 100));
    expect(pay.totalCents).toBe(pay.serviceCommissionCents + pay.retailCommissionCents + pay.tipCents);

    // Bridget sees the same on My day as the owner does.
    expect((await loadPayroll(bridget, B, TZ, PERIOD, today, BRIDGET))[0].totalCents).toBe(pay.totalCents);
  });

  it("pays the front desk by the hour from their schedule", async () => {
    const everyone = await loadPayroll(manager, B, TZ, PERIOD, today);
    const sam = everyone.find((l) => l.staffId === SAM)!;
    // Tue and Wed 9-5, Fri 12-8, Sat 8-5: 33 hours a week, two weeks.
    expect(sam.minutes).toBe(66 * 60);
    expect(sam.hourlyPayCents).toBe(66 * 1800);
    expect(sam.totalCents).toBe(66 * 1800);
    // Stylists on commission alone have no hours.
    expect(everyone.find((l) => l.staffId === SHAE)!.minutes).toBeNull();
  });
});
