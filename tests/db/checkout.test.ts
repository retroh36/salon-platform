// Checkout in the database: complete_sale, void_sale and refund_sale, the
// totals they work out (the same as lib/checkout.ts), stock, the visit's
// status, and who may do what.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSale } from "@/lib/checkout";
import { changeStatus, saveBooking } from "@/lib/scheduling/book";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, shae: SHAE } = SEED.staff;
// A Tuesday far from the seeded month.
const DAY = "2031-08-05";
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const PREFIX = `Co${Date.now().toString(36)}`;

let frontDesk: Client;
let manager: Client;
let stylist: Client;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
let otherOwner: Client;
let clientId: string;
let cut: { id: string; price: number };
let product: { id: string; price: number };
const sales: string[] = [];

beforeAll(async () => {
  [frontDesk, manager, stylist] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  other = await createOtherSalon();
  otherOwner = await signIn(other.email);
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Ava`, last_name: "Test" }).select("id").single();
  clientId = c!.id;
  const { data: s } = await admin.from("services").select("id, price_cents").eq("business_id", B).eq("name", "Women's Cut & Style").single();
  cut = { id: s!.id, price: s!.price_cents };
  const { data: p } = await admin.from("products").select("id, price_cents").eq("business_id", B).eq("type", "retail").eq("is_active", true).order("sku").limit(1).single();
  product = { id: p!.id, price: p!.price_cents! };
  // Tax: services untaxed, retail 10.25%; discounts for the front desk up to 10%.
  await admin.from("businesses").update({ tax_rate_services_bp: 0, tax_rate_retail_bp: 1025, discount_max_percent: 10, discount_roles: ["owner", "manager", "front_desk"] }).eq("id", B);
});

afterAll(async () => {
  for (const id of sales) await admin.from("sales").delete().eq("id", id);
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("businesses").update({ discount_max_percent: 100 }).eq("id", B);
  await other.cleanup();
});

// A visit with Bridget (a cut) and Shae (a cut), checked in.
async function visit(hour: number) {
  const result = await saveBooking(frontDesk, { id: L, timezone: TZ }, {
    clientId,
    notes: null,
    items: [
      { serviceId: cut.id, staffId: BRIDGET, start: at(hour), resource: { kind: "none" } },
      { serviceId: cut.id, staffId: SHAE, start: at(hour), resource: { kind: "none" } },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  expect(await changeStatus(frontDesk, result.appointmentId, "check_in")).toEqual({ ok: true });
  const { data: items } = await admin.from("appointment_items").select("id, price_cents, staff_id").eq("appointment_id", result.appointmentId).order("staff_id");
  return { appointmentId: result.appointmentId, items: items! };
}

const onHand = async () => Number((await admin.from("stock_levels").select("on_hand").eq("location_id", L).eq("product_id", product.id).single()).data!.on_hand);

async function sell(client: Client, input: Record<string, unknown>) {
  const { data, error } = await client.rpc("complete_sale", { p_location_id: L, p_input: input as never });
  if (data) sales.push(data);
  return { data, error };
}

describe("checking out a visit", () => {
  it("records services, products, a discount, tax, tips and split payments, matching the app's arithmetic", async () => {
    const v = await visit(10);
    const before = await onHand();
    // Bridget's cut at $5 less (with a reason), Shae's at the booked price.
    const [first, second] = v.items;
    const lines = [
      { gross: first.price_cents - 500, tax: 0 },
      { gross: second.price_cents, tax: 0 },
      { gross: product.price * 2, tax: 1025 },
    ];
    const expected = computeSale(lines.map((l) => ({ grossCents: l.gross, taxBp: l.tax, discountable: true })), { kind: "percent", value: 10 }, [1500, 1000]);

    const { data: saleId, error } = await sell(frontDesk, {
      appointment_id: v.appointmentId,
      lines: [
        { kind: "service", appointment_item_id: first.id, unit_price_cents: first.price_cents - 500, price_reason: "Fringe only" },
        { kind: "service", appointment_item_id: second.id, unit_price_cents: second.price_cents },
        { kind: "product", product_id: product.id, quantity: 2 },
      ],
      discount: { kind: "percent", value: 10, reason: "Loyalty" },
      tips: [
        { staff_id: first.staff_id, amount_cents: 1500 },
        { staff_id: second.staff_id, amount_cents: 1000 },
      ],
      payments: [
        { method: "card", amount_cents: 10000, reference: "4242" },
        { method: "cash", amount_cents: expected.totalCents - 10000, tendered_cents: Math.ceil((expected.totalCents - 10000) / 1000) * 1000 },
      ],
    });
    expect(error).toBeNull();

    const { data: sale } = await admin.from("sales").select("*, sale_items(*), sale_tips(*), payments(*), sale_events(*)").eq("id", saleId!).single();
    expect(sale).toMatchObject({
      status: "completed",
      client_id: clientId,
      subtotal_cents: expected.subtotalCents,
      discount_cents: expected.discountCents,
      discount_reason: "Loyalty",
      tax_cents: expected.taxCents,
      tip_cents: 2500,
      total_cents: expected.totalCents,
    });
    const items = [...sale!.sale_items].sort((a, b) => a.position - b.position);
    expect(items.map((i) => [i.discount_cents, i.tax_cents, i.total_cents])).toEqual(expected.lines.map((l) => [l.discountCents, l.taxCents, l.totalCents]));
    expect(items[0]).toMatchObject({ booked_price_cents: first.price_cents, price_reason: "Fringe only" });
    expect(sale!.payments.reduce((n, p) => n + p.amount_cents, 0)).toBe(expected.totalCents);
    const cash = sale!.payments.find((p) => p.method === "cash")!;
    expect(cash.change_cents).toBe(cash.tendered_cents! - cash.amount_cents);
    expect(sale!.sale_events.map((e) => e.kind)).toEqual(["completed"]);

    // Stock out, and the visit checked out.
    expect(await onHand()).toBe(before - 2);
    const { data: appt } = await admin.from("appointments").select("status, checked_out_at").eq("id", v.appointmentId).single();
    expect(appt!.status).toBe("completed");
    expect(appt!.checked_out_at).not.toBeNull();

    // Not twice.
    const again = await sell(frontDesk, { appointment_id: v.appointmentId, lines: [], payments: [] });
    expect(again.error?.code).toBe("55000");
  });

  it("refuses what doesn't add up: missing services, unexplained prices, short payments, discounts over the limit", async () => {
    const v = await visit(14);
    const [first, second] = v.items;
    const both = [
      { kind: "service", appointment_item_id: first.id },
      { kind: "service", appointment_item_id: second.id },
    ];
    const total = first.price_cents + second.price_cents;
    const card = (cents: number) => [{ method: "card", amount_cents: cents }];
    expect((await sell(frontDesk, { appointment_id: v.appointmentId, lines: [both[0]], payments: card(first.price_cents) })).error?.message).toBe("Every service on the visit needs to be on the sale");
    expect((await sell(frontDesk, { appointment_id: v.appointmentId, lines: [{ ...both[0], unit_price_cents: 1 }, both[1]], payments: card(1 + second.price_cents) })).error?.message).toBe("Say why the price changed");
    expect((await sell(frontDesk, { appointment_id: v.appointmentId, lines: both, payments: card(total - 1) })).error?.message).toBe("Payments don't add up to the total");
    // 20% is over the front desk's 10%; a manager can.
    const twenty = { kind: "percent", value: 20, reason: "Birthday" };
    const discounted = total - Math.round(total * 0.2);
    expect((await sell(frontDesk, { appointment_id: v.appointmentId, lines: both, discount: twenty, payments: card(discounted) })).error?.code).toBe("42501");
    expect((await sell(frontDesk, { appointment_id: v.appointmentId, lines: both, discount: { ...twenty, reason: "" }, payments: card(discounted) })).error?.code).toBe("22023");
    const ok = await sell(manager, { appointment_id: v.appointmentId, lines: both, discount: twenty, payments: card(discounted) });
    expect(ok.error).toBeNull();
  });

  it("sells retail without a visit", async () => {
    const before = await onHand();
    const total = product.price + Math.round((product.price * 1025) / 10000);
    const { data, error } = await sell(frontDesk, { client_id: clientId, lines: [{ kind: "product", product_id: product.id, quantity: 1 }], payments: [{ method: "cash", amount_cents: total, tendered_cents: total }] });
    expect(error).toBeNull();
    expect((await admin.from("sales").select("appointment_id, total_cents").eq("id", data!).single()).data).toEqual({ appointment_id: null, total_cents: total });
    expect(await onHand()).toBe(before - 1);
  });
});

describe("voids and refunds", () => {
  it("lets managers refund part, then the rest, never more than was paid, with products back in stock", async () => {
    const before = await onHand();
    const total = product.price * 2 + Math.round((product.price * 2 * 1025) / 10000);
    const { data: saleId } = await sell(frontDesk, { lines: [{ kind: "product", product_id: product.id, quantity: 2 }], payments: [{ method: "card", amount_cents: total }] });
    const { data: line } = await admin.from("sale_items").select("id").eq("sale_id", saleId!).single();

    const refund = (client: Client, input: Record<string, unknown>) => client.rpc("refund_sale", { p_sale_id: saleId!, p_input: input as never });
    expect((await refund(frontDesk, { reason: "Changed mind", payments: [{ method: "card", amount_cents: 500 }] })).error?.code).toBe("42501");
    expect((await refund(manager, { reason: "", payments: [{ method: "card", amount_cents: 500 }] })).error?.code).toBe("22023");
    expect((await refund(manager, { reason: "Too much", payments: [{ method: "card", amount_cents: total + 1 }] })).error?.message).toBe("That's more than was paid");

    // One returned, refunded with its tax.
    const one = total - Math.floor(total / 2);
    expect((await refund(manager, { reason: "Didn't suit", payments: [{ method: "card", amount_cents: one }], returns: [{ sale_item_id: line!.id, quantity: 1 }], restock: true })).error).toBeNull();
    let sale = (await admin.from("sales").select("status, refunded_cents").eq("id", saleId!).single()).data!;
    expect(sale).toEqual({ status: "partly_refunded", refunded_cents: one });
    expect(await onHand()).toBe(before - 1);

    expect((await refund(manager, { reason: "The other too", payments: [{ method: "cash", amount_cents: total - one }], returns: [{ sale_item_id: line!.id, quantity: 1 }], restock: false })).error).toBeNull();
    sale = (await admin.from("sales").select("status, refunded_cents").eq("id", saleId!).single()).data!;
    expect(sale).toEqual({ status: "refunded", refunded_cents: total });
    expect(await onHand()).toBe(before - 1); // the second one wasn't restocked
    const { data: payments } = await admin.from("payments").select("amount_cents, method, reason").eq("sale_id", saleId!).order("created_at");
    expect(payments!.reduce((n, p) => n + p.amount_cents, 0)).toBe(0);
    const { data: events } = await admin.from("sale_events").select("kind, amount_cents, detail").eq("sale_id", saleId!).order("created_at");
    expect(events!.map((e) => e.kind)).toEqual(["completed", "refunded", "refunded"]);
  });

  it("lets managers void a checkout: payments reversed, stock back, the visit open again", async () => {
    const v = await visit(16);
    const before = await onHand();
    const lines = v.items.map((i) => ({ kind: "service", appointment_item_id: i.id }));
    const total = v.items.reduce((n, i) => n + i.price_cents, 0) + product.price + Math.round((product.price * 1025) / 10000);
    const { data: saleId } = await sell(frontDesk, { appointment_id: v.appointmentId, lines: [...lines, { kind: "product", product_id: product.id, quantity: 1 }], payments: [{ method: "card", amount_cents: total }] });

    expect((await frontDesk.rpc("void_sale", { p_sale_id: saleId!, p_reason: "Wrong client" })).error?.code).toBe("42501");
    expect((await manager.rpc("void_sale", { p_sale_id: saleId!, p_reason: "Wrong client" })).error).toBeNull();
    const { data: sale } = await admin.from("sales").select("status, void_reason, payments(amount_cents)").eq("id", saleId!).single();
    expect(sale!.status).toBe("voided");
    expect(sale!.void_reason).toBe("Wrong client");
    expect(sale!.payments.reduce((n, p) => n + p.amount_cents, 0)).toBe(0);
    expect(await onHand()).toBe(before);
    expect((await admin.from("appointments").select("status").eq("id", v.appointmentId).single()).data!.status).toBe("checked_in");
    // It can be checked out again.
    expect((await sell(frontDesk, { appointment_id: v.appointmentId, lines, payments: [{ method: "card", amount_cents: total - product.price - Math.round((product.price * 1025) / 10000) }] })).error).toBeNull();
    expect((await manager.rpc("void_sale", { p_sale_id: saleId!, p_reason: "Again" })).error?.code).toBe("55000");
  });
});

describe("who sees sales", () => {
  it("the front of house sees them; stylists and other salons don't, and nobody writes them directly", async () => {
    expect((await frontDesk.from("sales").select("id").in("id", sales)).data!.length).toBe(sales.length);
    expect((await stylist.from("sales").select("id").in("id", sales)).data).toEqual([]);
    expect((await stylist.from("payments").select("id").in("sale_id", sales)).data).toEqual([]);
    expect((await otherOwner.from("sales").select("id").in("id", sales)).data).toEqual([]);
    const { error } = await frontDesk.from("sales").insert({ business_id: B, location_id: L, number: 1, subtotal_cents: 0, total_cents: 0 });
    expect(error?.code).toBe("42501");
    expect((await stylist.rpc("complete_sale", { p_location_id: L, p_input: {} })).error?.code).toBe("42501");
    expect((await otherOwner.rpc("complete_sale", { p_location_id: L, p_input: {} })).error?.code).toBe("42501");
  });
});
