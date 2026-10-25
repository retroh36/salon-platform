// What a refund takes back: a gift card sold on the sale only for its
// unused balance (then cancelled), a package only for its unused sessions,
// a membership ended; and payroll takes back only what was returned (a
// product return never touches service commission or tips).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ticketsFor, type PayrollSale } from "@/lib/payroll";
import { admin, SEED, signIn, sql, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const BRIDGET = SEED.staff.bridget;
const TAG = `Rf${Date.now().toString(36)}`;

let manager: Client;
let frontDesk: Client;
let clientId: string;
let blowoutId: string;
let product: { id: string; price: number };
let tax: { tax_rate_services_bp: number; tax_rate_retail_bp: number };
const sales: string[] = [];
const cards: string[] = [];
let templateId: string;
let planId: string;

beforeAll(async () => {
  [manager, frontDesk] = await Promise.all([signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Ava`, last_name: "Test" }).select("id").single();
  clientId = c!.id;
  blowoutId = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single()).data!.id;
  const { data: p } = await admin.from("products").insert({ business_id: B, brand: TAG, name: "Shine Spray", type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 2000 }).select("id").single();
  product = { id: p!.id, price: 2000 };
  await admin.from("stock_levels").upsert({ business_id: B, location_id: L, product_id: p!.id, on_hand: 10 });
  tax = (await admin.from("businesses").select("tax_rate_services_bp, tax_rate_retail_bp").eq("id", B).single()).data!;
  await admin.from("businesses").update({ tax_rate_services_bp: 0, tax_rate_retail_bp: 0 }).eq("id", B);
  const owner = await signIn("owner@mapleandash.test");
  templateId = (await owner.rpc("save_package_template", { p_template_id: null!, p_input: { name: `${TAG} 5 blowouts`, price_cents: 20000, levels: null, items: [{ service_id: blowoutId, quantity: 5 }] } as never })).data!;
  const plan = await owner.rpc("save_membership_plan", {
      p_business_id: B,
      p_plan_id: null as never,
      p_input: { name: `${TAG} Club`, price_cents: 9000, interval_unit: "month", interval_count: 1, min_term_periods: 0, cancel_notice_days: 0, allow_pause: false, max_pause_periods: 1, service_discount_pct: 0, retail_discount_pct: 0, services: [{ service_id: blowoutId, quantity: 2, rollover: false }] } as never,
  });
  expect(plan.error).toBeNull();
  planId = plan.data as string;
});

afterAll(async () => {
  await admin.from("businesses").update(tax).eq("id", B);
  for (const id of sales) await admin.from("sales").delete().eq("id", id);
  await admin.from("gift_cards").delete().in("id", cards);
  await admin.from("client_packages").delete().eq("client_id", clientId);
  await admin.from("client_memberships").delete().eq("client_id", clientId);
  await admin.from("membership_plans").delete().eq("id", planId);
  await admin.from("package_templates").delete().eq("id", templateId);
  await admin.from("stock_movements").delete().eq("product_id", product.id);
  await admin.from("stock_levels").delete().eq("product_id", product.id);
  await admin.from("products").delete().eq("id", product.id);
  await admin.from("clients").delete().eq("id", clientId);
});

async function sell(input: Record<string, unknown>) {
  const { data, error } = await frontDesk.rpc("complete_sale", { p_location_id: L, p_input: { client_id: clientId, ...input } as never });
  expect(error).toBeNull();
  sales.push(data!);
  return data!;
}

const lineOf = async (saleId: string, kind: "gift_card" | "package" | "membership") => (await admin.from("sale_items").select("id").eq("sale_id", saleId).eq("kind", kind).single()).data!.id;
const valueOf = async (saleId: string) => (await manager.rpc("refundable_lines", { p_sale_id: saleId })).data!;
const refund = (saleId: string, amount: number, returns: { sale_item_id: string; quantity: number }[]) =>
  manager.rpc("refund_sale", { p_sale_id: saleId, p_input: { reason: "Client asked", payments: amount ? [{ method: "card", amount_cents: amount }] : [], returns, restock: true } as never });

describe("refunding what a sale sold", () => {
  it("a gift card: only what's left on it, and the card is cancelled", async () => {
    const sold = await sell({ lines: [{ kind: "gift_card", amount_cents: 10000, recipient_name: "Ava" }], payments: [{ method: "card", amount_cents: 10000 }] });
    const card = (await admin.from("gift_cards").select("id, code").eq("sale_id", sold).single()).data!;
    cards.push(card.id);
    // $20 of it spent on a spray.
    await sell({ lines: [{ kind: "product", product_id: product.id, quantity: 1 }], payments: [{ method: "gift_card", amount_cents: 2000, code: card.code }] });
    const line = await lineOf(sold, "gift_card");
    expect(await valueOf(sold)).toEqual([expect.objectContaining({ sale_item_id: line, kind: "gift_card", value_cents: 8000 })]);

    // Not as money on its own, and not more than is left on it.
    expect((await refund(sold, 5000, [])).error?.message).toBe("A gift card, package or membership is refunded by returning it, for what's left of it");
    expect((await refund(sold, 10000, [{ sale_item_id: line, quantity: 1 }])).error?.message).toBe("A gift card, package or membership is refunded by returning it, for what's left of it");
    expect((await refund(sold, 8000, [{ sale_item_id: line, quantity: 1 }])).error).toBeNull();
    expect((await admin.from("gift_cards").select("status, balance_cents").eq("id", card.id).single()).data).toEqual({ status: "voided", balance_cents: 0 });
    const { data: event } = await admin.from("sale_events").select("amount_cents, returned").eq("sale_id", sold).eq("kind", "refunded").single();
    expect(event).toEqual({ amount_cents: 8000, returned: [{ sale_item_id: line, kind: "gift_card", quantity: 1, value_cents: 8000, amount_cents: 8000 }] });
    // Once.
    expect(await valueOf(sold)).toEqual([expect.objectContaining({ value_cents: null })]);
    expect((await refund(sold, 1, [{ sale_item_id: line, quantity: 1 }])).error?.message).toBe("That was already cancelled or refunded");
  });

  it("a package: only the sessions not used, and it's cancelled", async () => {
    const sold = await sell({ lines: [{ kind: "package", template_id: templateId }], payments: [{ method: "card", amount_cents: 20000 }] });
    const pkg = (await admin.from("client_packages").select("id").eq("sale_id", sold).single()).data!;
    const item = (await admin.from("client_package_items").select("id, use_value_cents").eq("client_package_id", pkg.id).single()).data!;
    // One blowout used.
    await sell({ lines: [{ kind: "service", service_id: blowoutId, staff_id: BRIDGET, quantity: 1, package_item_id: item.id }], payments: [] });
    const line = await lineOf(sold, "package");
    expect((await valueOf(sold))[0].value_cents).toBe(4 * item.use_value_cents);
    expect((await refund(sold, 4 * item.use_value_cents, [{ sale_item_id: line, quantity: 1 }])).error).toBeNull();
    expect((await admin.from("client_packages").select("status, refunded_cents").eq("id", pkg.id).single()).data).toEqual({ status: "refunded", refunded_cents: 4 * item.use_value_cents });
  });

  it("a membership: it ends today, for the period less the services it already covered", async () => {
    const sold = await sell({ lines: [{ kind: "membership", plan_id: planId, provider: "test", payment_method_ref: "test_visa_4242", card_label: "Visa …4242" }], payments: [{ method: "card", amount_cents: 9000 }] });
    const m = (await admin.from("client_memberships").select("id").eq("sale_id", sold).single()).data!;
    const credit = (await admin.from("membership_credits").select("id").eq("membership_id", m.id).single()).data!;
    const used = await sell({ lines: [{ kind: "service", service_id: blowoutId, staff_id: BRIDGET, quantity: 1, membership_credit_id: credit.id }], payments: [] });
    const usedCents = (await admin.from("sale_items").select("total_cents").eq("sale_id", used).single()).data!.total_cents;
    const line = await lineOf(sold, "membership");
    expect((await valueOf(sold))[0].value_cents).toBe(9000 - usedCents);
    expect((await refund(sold, 9000 - usedCents, [{ sale_item_id: line, quantity: 1 }])).error).toBeNull();
    expect((await admin.from("client_memberships").select("status").eq("id", m.id).single()).data!.status).toBe("canceled");
  });
});

describe("what payroll takes back", () => {
  it("a product returned reverses only that product's line: the service and the tip stay paid", async () => {
    const saleId = await sell({
      lines: [
        { kind: "service", service_id: blowoutId, staff_id: BRIDGET, quantity: 1 },
        { kind: "product", product_id: product.id, quantity: 2, staff_id: BRIDGET },
      ],
      tips: [{ staff_id: BRIDGET, amount_cents: 1000 }],
      payments: [{ method: "card", amount_cents: Number(sql(`select private.stylist_price('${BRIDGET}', '${blowoutId}')`)) + 4000 + 1000 }],
    });
    const spray = (await admin.from("sale_items").select("id").eq("sale_id", saleId).eq("kind", "product").single()).data!.id;
    expect((await refund(saleId, 2000, [{ sale_item_id: spray, quantity: 1 }])).error).toBeNull();

    const from = new Date(Date.now() - 86_400_000);
    const to = new Date(Date.now() + 86_400_000);
    const { data } = await manager.rpc("payroll_sales", { p_business_id: B, p_from: from.toISOString(), p_to: to.toISOString(), p_staff_id: BRIDGET });
    const sale = (data as PayrollSale[]).filter((s) => s.id === saleId);
    const back = ticketsFor(sale, BRIDGET, from, to).find((t) => t.kind === "refund")!;
    expect(back).toMatchObject({ serviceCents: 0, retailCents: -2000, tipCents: 0 });
  });
});
