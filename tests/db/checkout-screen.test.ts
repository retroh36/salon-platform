// The full-screen checkout in the database: drafts (one open per visit,
// front of house only, completed by complete_sale), services added at
// checkout, stylist credit on products, line discounts, a manager's OK for
// out-of-stock products, and the visit rebooked at checkout.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSale } from "@/lib/checkout";
import { changeStatus, saveBooking } from "@/lib/scheduling/book";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, shae: SHAE } = SEED.staff;
// A Tuesday far from the seeded month (and the other checkout tests).
const DAY = "2031-08-12";
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const PREFIX = `Cd${Date.now().toString(36)}`;

let frontDesk: Client;
let manager: Client;
let stylist: Client;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
let otherOwner: Client;
let clientId: string;
let otherClientId: string;
let cut: string;
let spray: string;
let soldOut: string;

beforeAll(async () => {
  [frontDesk, manager, stylist] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  other = await createOtherSalon();
  otherOwner = await signIn(other.email);
  const { data: c } = await admin
    .from("clients")
    .insert([
      { business_id: B, first_name: `${PREFIX}Ava`, last_name: "Test" },
      { business_id: B, first_name: `${PREFIX}Bea`, last_name: "Test" },
    ])
    .select("id, first_name");
  clientId = c!.find((x) => x.first_name.endsWith("Ava"))!.id;
  otherClientId = c!.find((x) => x.first_name.endsWith("Bea"))!.id;
  cut = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single()).data!.id;
  // A $20 spray (10 in stock) and a $30 serum (none).
  const { data: p } = await admin
    .from("products")
    .insert([
      { business_id: B, brand: PREFIX, name: "Spray", sku: `${PREFIX}-S`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 2000 },
      { business_id: B, brand: PREFIX, name: "Serum", sku: `${PREFIX}-O`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 3000 },
    ])
    .select("id, name");
  spray = p!.find((x) => x.name === "Spray")!.id;
  soldOut = p!.find((x) => x.name === "Serum")!.id;
  await admin.from("stock_levels").insert([
    { business_id: B, location_id: L, product_id: spray, on_hand: 10 },
    { business_id: B, location_id: L, product_id: soldOut, on_hand: 0 },
  ]);
  await admin.from("businesses").update({ tax_rate_services_bp: 0, tax_rate_retail_bp: 1000, discount_max_percent: 10, discount_roles: ["owner", "manager", "front_desk"] }).eq("id", B);
});

afterAll(async () => {
  for (const id of [clientId, otherClientId]) {
    await admin.from("sales").delete().eq("client_id", id);
    await admin.from("appointments").delete().eq("client_id", id);
  }
  await admin.from("sale_drafts").delete().eq("business_id", B).is("appointment_id", null).like("return_to", `/${PREFIX}%`);
  for (const id of [spray, soldOut]) {
    await admin.from("sale_items").delete().eq("product_id", id);
    await admin.from("stock_movements").delete().eq("product_id", id);
    await admin.from("stock_levels").delete().eq("product_id", id);
    await admin.from("products").delete().eq("id", id);
  }
  await admin.from("clients").delete().in("id", [clientId, otherClientId]);
  await admin.from("businesses").update({ tax_rate_retail_bp: 1025, discount_max_percent: 100 }).eq("id", B);
  await other.cleanup();
});

// A cut with Bridget, checked in.
async function visit(hour: number, client = clientId) {
  const result = await saveBooking(frontDesk, { id: L, timezone: TZ }, { clientId: client, notes: null, items: [{ serviceId: cut, staffId: BRIDGET, start: at(hour), resource: { kind: "none" } }] });
  if (!result.ok) throw new Error(JSON.stringify(result));
  expect(await changeStatus(frontDesk, result.appointmentId, "check_in")).toEqual({ ok: true });
  const { data: item } = await admin.from("appointment_items").select("id, price_cents").eq("appointment_id", result.appointmentId).single();
  return { appointmentId: result.appointmentId, item: item! };
}

async function draft(client: Client, appointmentId: string | null, who = clientId) {
  return client
    .from("sale_drafts")
    .insert({ business_id: B, location_id: L, appointment_id: appointmentId, client_id: who, ticket: {}, return_to: `/${PREFIX}`, created_by: SEED.staff.frontDesk })
    .select("id")
    .single();
}

const sell = (client: Client, input: Record<string, unknown>) => client.rpc("complete_sale", { p_location_id: L, p_input: input as never });

describe("checkout drafts", () => {
  it("one open draft per visit, kept by the front of house, unseen by stylists and other salons", async () => {
    const v = await visit(9);
    const { data: d, error } = await draft(frontDesk, v.appointmentId);
    expect(error).toBeNull();
    expect((await draft(frontDesk, v.appointmentId)).error?.code).toBe("23505");
    expect((await draft(stylist, null)).error).not.toBeNull();
    expect((await stylist.from("sale_drafts").select("id").eq("id", d!.id)).data).toEqual([]);
    expect((await otherOwner.from("sale_drafts").select("id").eq("id", d!.id)).data).toEqual([]);
    const { data: saved } = await frontDesk.from("sale_drafts").update({ ticket: { lines: [] } }).eq("id", d!.id).select("id");
    expect(saved).toHaveLength(1);
  });

  it("completing the sale completes its draft, which can't be completed or changed again", async () => {
    const v = await visit(10);
    const { data: d } = await draft(frontDesk, v.appointmentId);
    const input = {
      draft_id: d!.id,
      appointment_id: v.appointmentId,
      lines: [{ kind: "service", appointment_item_id: v.item.id }],
      payments: [{ method: "card", amount_cents: v.item.price_cents }],
    };
    const { data: saleId, error } = await sell(frontDesk, input);
    expect(error).toBeNull();
    expect((await admin.from("sale_drafts").select("status, sale_id").eq("id", d!.id).single()).data).toEqual({ status: "completed", sale_id: saleId });
    expect((await admin.from("sales").select("draft_id").eq("id", saleId!).single()).data!.draft_id).toBe(d!.id);
    expect((await sell(frontDesk, input)).error).not.toBeNull();
    expect((await frontDesk.from("sale_drafts").update({ ticket: {} }).eq("id", d!.id).select("id")).data).toEqual([]);
    // A new checkout for the visit can be opened once it's done.
    expect((await draft(frontDesk, v.appointmentId)).error).toBeNull();
  });
});

describe("what the ticket can hold", () => {
  it("a service added at checkout (the stylist's price), stylist credit on products, and line discounts", async () => {
    const v = await visit(11);
    const lines = [
      { grossCents: v.item.price_cents, taxBp: 0, discountable: true },
      { grossCents: 2 * v.item.price_cents, taxBp: 0, discountable: true, lineDiscountCents: (2 * v.item.price_cents) / 10 },
      { grossCents: 2 * 2000, taxBp: 1000, discountable: true },
    ];
    const expected = computeSale(lines, null, []);
    const { data: saleId, error } = await sell(frontDesk, {
      appointment_id: v.appointmentId,
      lines: [
        { kind: "service", appointment_item_id: v.item.id },
        // Two more cuts with Bridget (at her price), 10% off them.
        { kind: "service", service_id: cut, staff_id: BRIDGET, quantity: 2, discount: { kind: "percent", value: 10, reason: "Bridal party" } },
        { kind: "product", product_id: spray, staff_id: SHAE, quantity: 2 },
      ],
      payments: [{ method: "card", amount_cents: expected.totalCents }],
    });
    expect(error).toBeNull();
    const { data: items } = await admin.from("sale_items").select("kind, staff_id, quantity, unit_price_cents, appointment_item_id, line_discount_cents, line_discount_reason, total_cents").eq("sale_id", saleId!).order("position");
    expect(items![1]).toMatchObject({ kind: "service", staff_id: BRIDGET, quantity: 2, unit_price_cents: v.item.price_cents, appointment_item_id: null, line_discount_cents: (2 * v.item.price_cents) / 10, line_discount_reason: "Bridal party" });
    expect(items![2]).toMatchObject({ kind: "product", staff_id: SHAE, quantity: 2 });
    expect(items!.map((i) => i.total_cents)).toEqual(expected.lines.map((l) => l.totalCents));
  });

  it("refuses line discounts beyond what the front desk may give, or without a reason", async () => {
    const v = await visit(12);
    const base = { appointment_id: v.appointmentId, payments: [{ method: "card", amount_cents: v.item.price_cents / 2 }] };
    const big = await sell(frontDesk, { ...base, lines: [{ kind: "service", appointment_item_id: v.item.id, discount: { kind: "percent", value: 50, reason: "Friend" } }] });
    expect(big.error?.code).toBe("42501");
    const noReason = await sell(manager, { ...base, lines: [{ kind: "service", appointment_item_id: v.item.id, discount: { kind: "percent", value: 50, reason: "" } }] });
    expect(noReason.error?.code).toBe("22023");
  });
});

describe("selling what's out of stock", () => {
  it("needs a manager's OK for the front desk, recorded on the checkout", async () => {
    const { data: d } = await draft(frontDesk, null);
    const input = { draft_id: d!.id, client_id: clientId, lines: [{ kind: "product", product_id: soldOut, quantity: 1 }], payments: [{ method: "cash", amount_cents: 3300, tendered_cents: 3300 }] };
    const refused = await sell(frontDesk, input);
    expect(refused.error).toMatchObject({ code: "42501", message: `Only 0 left of ${PREFIX} Serum. A manager needs to OK selling it.` });
    // The front desk can't OK it themselves; a manager can.
    expect((await frontDesk.rpc("approve_stock_override", { p_draft_id: d!.id, p_product_id: soldOut })).error?.code).toBe("42501");
    expect((await manager.rpc("approve_stock_override", { p_draft_id: d!.id, p_product_id: soldOut })).error).toBeNull();
    const { error } = await sell(frontDesk, input);
    expect(error).toBeNull();
    expect((await admin.from("stock_overrides").select("approved_by").eq("draft_id", d!.id).single()).data!.approved_by).toBe(SEED.staff.manager);
    expect(Number((await admin.from("stock_levels").select("on_hand").eq("product_id", soldOut).single()).data!.on_hand)).toBe(-1);
  });
});

describe("rebooking at checkout", () => {
  it("records the client's next visit on the sale, only if it's theirs", async () => {
    const v = await visit(14);
    const next = await saveBooking(frontDesk, { id: L, timezone: TZ }, { clientId, notes: null, items: [{ serviceId: cut, staffId: BRIDGET, start: fromLocal("2031-09-09", 10 * 60, TZ)!, resource: { kind: "none" } }] });
    const theirs = await saveBooking(frontDesk, { id: L, timezone: TZ }, { clientId: otherClientId, notes: null, items: [{ serviceId: cut, staffId: BRIDGET, start: fromLocal("2031-09-09", 15 * 60, TZ)!, resource: { kind: "none" } }] });
    if (!next.ok || !theirs.ok) throw new Error("booking failed");
    const input = { appointment_id: v.appointmentId, lines: [{ kind: "service", appointment_item_id: v.item.id }], payments: [{ method: "card", amount_cents: v.item.price_cents }] };
    expect((await sell(frontDesk, { ...input, rebook_appointment_id: theirs.appointmentId })).error?.code).toBe("22023");
    const { data: saleId, error } = await sell(frontDesk, { ...input, rebook_appointment_id: next.appointmentId });
    expect(error).toBeNull();
    expect((await admin.from("sales").select("rebook_appointment_id").eq("id", saleId!).single()).data!.rebook_appointment_id).toBe(next.appointmentId);
  });
});

describe("best sellers for the quick-add tiles", () => {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();

  it("come from the last 90 days of sales for the front desk, though it can only read today's sales itself", async () => {
    const { data: all } = await admin.from("sale_items").select("product_id, sale:sales!inner(status, created_at, location_id)").eq("kind", "product").eq("sale.location_id", L).neq("sale.status", "voided").gte("sale.created_at", since);
    const expected = new Set(all!.flatMap((r) => (r.product_id ? [r.product_id] : [])));
    expect(expected.size).toBeGreaterThan(3);
    const { data, error } = await frontDesk.rpc("best_sellers", { p_location_id: L, p_since: since });
    expect(error).toBeNull();
    expect(new Set(data!.map((r) => r.product_id))).toEqual(expected);
    // The demo's sales are on earlier days, which the desk can't read.
    const { data: own } = await frontDesk.from("sale_items").select("product_id, sale:sales!inner(created_at)").eq("kind", "product").lt("sale.created_at", new Date(Date.now() - 2 * 86_400_000).toISOString());
    expect(own).toHaveLength(0);
  });

  it("are for the front of house of that salon only", async () => {
    expect((await stylist.rpc("best_sellers", { p_location_id: L, p_since: since })).data).toEqual([]);
    expect((await otherOwner.rpc("best_sellers", { p_location_id: L, p_since: since })).data).toEqual([]);
  });
});
