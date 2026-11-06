// Products' own prices and codes in the database: a team purchase at
// employee prices (credited to nobody), each product's own tax rate (the
// same as lib/ticket.ts works out), and no barcode on two products.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asTeamPurchase, EMPTY_TICKET, productLine, saleInput, totalsOf, type Ticket } from "@/lib/ticket";
import { admin, type Client, SEED, signIn } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const JORDAN = SEED.staff.jordan;
const PREFIX = `Tp${Date.now().toString(36)}`;
const RATES = { taxServicesBp: 0, taxRetailBp: 1025 };

let frontDesk: Client;
let manager: Client;
let shampoo: { id: string; name: string; priceCents: number; employeePriceCents: number | null; taxBp: number | null };
let gift: typeof shampoo;
let retailBefore: number;
const sales: string[] = [];
const products: string[] = [];

async function product(name: string, more: Record<string, unknown>) {
  const { data, error } = await admin
    .from("products")
    .insert({ business_id: B, brand: PREFIX, name, type: "retail", unit: "unit", size: 1, cost_cents: 1000, ...more })
    .select("id, name, price_cents, employee_price_cents, tax_rate_bp")
    .single();
  if (error) throw error;
  products.push(data.id);
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: data.id, on_hand: 20 });
  return { id: data.id, name: data.name, priceCents: data.price_cents!, employeePriceCents: data.employee_price_cents, taxBp: data.tax_rate_bp };
}

// Pays exactly what the ticket says, by card.
async function sell(client: Client, ticket: Ticket, clientId: string | null = null) {
  const total = totalsOf(ticket, RATES).totalCents;
  const input = { ...saleInput(ticket, { draftId: null as never, appointmentId: null, clientId }), draft_id: null, payments: [{ method: "card", amount_cents: total }] };
  const { data, error } = await client.rpc("complete_sale", { p_location_id: L, p_input: input as never });
  if (data) sales.push(data);
  return { data, error, total };
}

beforeAll(async () => {
  [frontDesk, manager] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("manager@mapleandash.test")]);
  retailBefore = (await admin.from("businesses").select("tax_rate_retail_bp").eq("id", B).single()).data!.tax_rate_retail_bp;
  await admin.from("businesses").update({ tax_rate_retail_bp: 1025 }).eq("id", B);
  shampoo = await product("Shampoo", { price_cents: 3000, employee_price_cents: 1800 });
  gift = await product("Gift box", { price_cents: 4000, tax_rate_bp: 0 });
});

afterAll(async () => {
  for (const id of sales) await admin.from("sales").delete().eq("id", id);
  for (const id of products) {
    await admin.from("sale_items").delete().eq("product_id", id);
    await admin.from("stock_movements").delete().eq("product_id", id);
    await admin.from("stock_levels").delete().eq("product_id", id);
    await admin.from("products").delete().eq("id", id);
  }
  await admin.from("businesses").update({ tax_rate_retail_bp: retailBefore }).eq("id", B);
});

describe("a team purchase", () => {
  it("is at employee prices, credited to nobody, each product taxed at its own rate", async () => {
    const ticket = asTeamPurchase({ ...EMPTY_TICKET, lines: [productLine("a", shampoo, SEED.staff.bridget, false), productLine("b", gift, SEED.staff.bridget, false)] }, JORDAN);
    const { data, error, total } = await sell(frontDesk, ticket);
    expect(error).toBeNull();
    // $18 + 10.25% tax, and $40 untaxed.
    expect(total).toBe(1800 + 185 + 4000);
    const { data: sale } = await admin.from("sales").select("employee_id, client_id, total_cents, tax_cents").eq("id", data!).single();
    expect(sale).toEqual({ employee_id: JORDAN, client_id: null, total_cents: total, tax_cents: 185 });
    const { data: lines } = await admin.from("sale_items").select("product_id, unit_price_cents, staff_id, tax_cents").eq("sale_id", data!).order("position");
    expect(lines).toEqual([
      { product_id: shampoo.id, unit_price_cents: 1800, staff_id: null, tax_cents: 185 },
      { product_id: gift.id, unit_price_cents: 4000, staff_id: null, tax_cents: 0 },
    ]);
  });

  it("charges the price and the product's own tax to anyone else", async () => {
    const own = await product("Oil", { price_cents: 2000, tax_rate_bp: 500 });
    const ticket: Ticket = { ...EMPTY_TICKET, walkIn: true, lines: [productLine("a", shampoo, null, false), productLine("b", own, null, false)] };
    const { data, error, total } = await sell(frontDesk, ticket);
    expect(error).toBeNull();
    // $30 at 10.25%, $20 at 5%.
    expect(total).toBe(3000 + 308 + 2000 + 100);
    expect((await admin.from("sales").select("employee_id, total_cents").eq("id", data!).single()).data).toEqual({ employee_id: null, total_cents: total });
  });

  it("has no client and is someone on the team here", async () => {
    const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Ava`, last_name: "Test" }).select("id").single();
    try {
      const ticket = asTeamPurchase({ ...EMPTY_TICKET, lines: [productLine("a", shampoo, null, false)] }, JORDAN);
      expect((await sell(frontDesk, ticket, c!.id)).error).toMatchObject({ code: "22023", hint: "employee" });
      expect((await sell(frontDesk, asTeamPurchase(ticket, "00000000-0000-4000-8000-000000000000"))).error).toMatchObject({ code: "22023", hint: "employee" });
    } finally {
      await admin.from("clients").delete().eq("id", c!.id);
    }
  });
});

describe("barcodes", () => {
  it("are never on two products, main or other", async () => {
    const code = `9${Date.now().toString().slice(-9)}`;
    const first = await manager
      .from("products")
      .insert({ business_id: B, brand: PREFIX, name: "Spray", type: "retail", unit: "unit", size: 1, cost_cents: 100, price_cents: 200, barcode: code, other_barcodes: [`${code}1`] })
      .select("id")
      .single();
    expect(first.error).toBeNull();
    products.push(first.data!.id);
    const clash = (more: Record<string, unknown>) =>
      manager.from("products").insert({ business_id: B, brand: PREFIX, name: "Other", type: "retail", unit: "unit", size: 1, cost_cents: 100, price_cents: 200, ...more });
    expect((await clash({ other_barcodes: [code] })).error).toMatchObject({ code: "23505", message: `Another product has barcode ${code}` });
    expect((await clash({ barcode: `${code}1` })).error).toMatchObject({ code: "23505", message: `Another product has barcode ${code}1` });
    expect((await clash({ barcode: "777777", other_barcodes: ["777777"] })).error?.code).toBe("23505");
    expect((await clash({ other_barcodes: ["12ab34"] })).error?.code).toBe("23514");
    // Back bar has no employee price or tax of its own.
    expect((await manager.from("products").insert({ business_id: B, brand: PREFIX, name: "Bb", type: "back_bar", unit: "ml", size: 1000, cost_cents: 100, employee_price_cents: 100 })).error?.code).toBe("23514");
    // Its own codes can be saved again unchanged.
    expect((await manager.from("products").update({ other_barcodes: [`${code}1`, "888888"] }).eq("id", first.data!.id)).error).toBeNull();
  });
});
