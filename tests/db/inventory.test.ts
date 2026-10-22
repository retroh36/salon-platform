// Products, suppliers, stock levels and movements: who can do what, and
// that on hand only changes through logged movements.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const run = `T${Date.now().toString(36)}`;

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let owner: Client;
let manager: Client;
let frontDesk: Client;
let stylist: Client;
let otherOwner: Client;
let retail: string;
let color: string;

async function product(type: "retail" | "back_bar") {
  const { data } = await admin
    .from("products")
    .insert({
      business_id: B,
      // Not `run`: these last for the whole describe block.
      brand: `${run} stock`,
      name: `${type} test`,
      type,
      unit: type === "retail" ? "unit" : "g",
      size: type === "retail" ? 1 : 60,
      cost_cents: 1000,
      price_cents: type === "retail" ? 2000 : null,
    })
    .select("id")
    .single();
  return data!.id;
}

async function level(productId: string) {
  const { data } = await admin.from("stock_levels").select("on_hand, reorder_point, reorder_quantity").eq("product_id", productId).eq("location_id", L).maybeSingle();
  return data;
}

async function movements(productId: string) {
  const { data } = await admin.from("stock_movements").select("change, on_hand_after, reason, note, created_by").eq("product_id", productId).order("created_at");
  return data!;
}

const adjust = (client: Client, productId: string, change: number, reason: "sale" | "adjustment" | "count" | "service_use" | "order_received", note = "") =>
  client.rpc("adjust_stock", { p_location_id: L, p_product_id: productId, p_change: change, p_reason: reason, p_note: note });

beforeAll(async () => {
  other = await createOtherSalon();
  [owner, manager, frontDesk, stylist, otherOwner] = await Promise.all([
    signIn("owner@mapleandash.test"),
    signIn("manager@mapleandash.test"),
    signIn("frontdesk@mapleandash.test"),
    signIn("priya@mapleandash.test"),
    signIn(other.email),
  ]);
});

afterEach(async () => {
  await admin.from("products").delete().eq("brand", run);
  await admin.from("suppliers").delete().like("name", `${run}%`);
});

afterAll(async () => {
  await other?.cleanup();
});

describe("the seeded stock", () => {
  it("has suppliers, color lines, developers in every volume, lighteners, toners, back bar and retail", async () => {
    const { data: suppliers } = await admin.from("suppliers").select("id").eq("business_id", B);
    expect(suppliers!.length).toBeGreaterThanOrEqual(2);
    const { data: products } = await admin.from("products").select("brand, line, name, type, unit, supplier_id").eq("business_id", B);
    const names = products!.map((p) => `${p.brand} ${p.line ?? ""} ${p.name}`);
    expect(names.filter((n) => n.includes("Topchic") && /^\S+ Topchic \d+[A-Z]+$/.test(n)).length).toBeGreaterThanOrEqual(8);
    for (const vol of ["10 Vol", "20 Vol", "30 Vol", "40 Vol"]) expect(names.some((n) => n.includes(vol))).toBe(true);
    expect(names.some((n) => /Lightener|Blonde Powder/.test(n))).toBe(true);
    expect(names.some((n) => n.includes("Color Charm T18"))).toBe(true);
    expect(products!.some((p) => p.type === "retail" && /Shampoo/.test(p.name))).toBe(true);
    expect(products!.some((p) => p.type === "retail" && /Conditioner/.test(p.name))).toBe(true);
    expect(products!.every((p) => p.supplier_id)).toBe(true);
    // Back bar by weight or volume, retail by unit.
    expect(products!.every((p) => (p.type === "retail") === (p.unit === "unit"))).toBe(true);
  });

  it("keeps every stock level equal to the sum of its movements, with some already low", async () => {
    const { data: levels } = await admin.from("stock_levels").select("product_id, on_hand, reorder_point").eq("location_id", L);
    const { data: moves } = await admin.from("stock_movements").select("product_id, change").eq("location_id", L);
    const sums = new Map<string, number>();
    for (const m of moves!) sums.set(m.product_id, Math.round(((sums.get(m.product_id) ?? 0) + m.change) * 100) / 100);
    for (const l of levels!) expect(sums.get(l.product_id) ?? 0).toBeCloseTo(l.on_hand, 2);
    expect(levels!.filter((l) => l.on_hand < l.reorder_point).length).toBeGreaterThanOrEqual(3);
  });
});

describe("products and suppliers", () => {
  it("lets owners and managers add and change them, and everyone see them", async () => {
    const add = (client: Client) =>
      client.from("products").insert({ business_id: B, brand: run, name: "7N", type: "back_bar", unit: "g", size: 60, cost_cents: 950 }).select("id").single();
    const { data: made, error } = await manager.from("products").insert({ business_id: B, brand: run, name: "8N", type: "back_bar", unit: "g", size: 60, cost_cents: 950 }).select("id").single();
    expect(error).toBeNull();
    expect((await add(owner)).error).toBeNull();
    expect((await add(frontDesk)).error?.code).toBe("42501");
    expect((await add(stylist)).error?.code).toBe("42501");

    const { data: updated } = await frontDesk.from("products").update({ cost_cents: 1 }).eq("id", made!.id).select("id");
    expect(updated).toEqual([]);
    const { data: seen } = await stylist.from("products").select("id").eq("id", made!.id);
    expect(seen).toHaveLength(1);
    const { data: theirs } = await otherOwner.from("products").select("id").eq("brand", run);
    expect(theirs).toEqual([]);

    expect((await manager.from("suppliers").insert({ business_id: B, name: `${run} Supply` })).error).toBeNull();
    expect((await frontDesk.from("suppliers").insert({ business_id: B, name: `${run} Other` })).error?.code).toBe("42501");
  });

  it("checks retail has a price and back bar doesn't, and SKUs are unique", async () => {
    const base = { business_id: B, brand: run, name: "x", cost_cents: 100 };
    expect((await admin.from("products").insert({ ...base, type: "retail", unit: "unit", size: 1 })).error?.code).toBe("23514");
    expect((await admin.from("products").insert({ ...base, type: "back_bar", unit: "g", size: 60, price_cents: 100 })).error?.code).toBe("23514");
    expect((await admin.from("products").insert({ ...base, type: "back_bar", unit: "unit", size: 2 })).error?.code).toBe("23514");
    await admin.from("products").insert({ ...base, type: "back_bar", unit: "g", size: 60, sku: `${run}-1` });
    expect((await admin.from("products").insert({ ...base, type: "back_bar", unit: "g", size: 60, sku: `${run}-1`.toLowerCase() })).error?.code).toBe("23505");
  });
});

describe("stock changes", () => {
  beforeAll(async () => {
    [retail, color] = [await product("retail"), await product("back_bar")];
  });
  afterAll(async () => {
    await admin.from("products").delete().in("id", [retail, color]);
  });

  it("logs a sale by the front desk and keeps on hand in step", async () => {
    // Stock arrives (a manager's adjustment, as there's no order yet).
    expect((await adjust(manager, retail, 6, "adjustment", "Found a box")).data).toBe(6);
    const { data, error } = await adjust(frontDesk, retail, -2, "sale");
    expect(error).toBeNull();
    expect(data).toBe(4);
    expect(await level(retail)).toMatchObject({ on_hand: 4 });
    expect(await movements(retail)).toEqual([
      { change: 6, on_hand_after: 6, reason: "adjustment", note: "Found a box", created_by: SEED.staff.manager },
      { change: -2, on_hand_after: 4, reason: "sale", note: null, created_by: SEED.staff.frontDesk },
    ]);
  });

  it("only sells whole retail units, and only by the front of house", async () => {
    expect((await adjust(stylist, retail, -1, "sale")).error?.code).toBe("42501");
    expect((await adjust(frontDesk, color, -30, "sale")).error?.code).toBe("22023");
    expect((await adjust(frontDesk, retail, -1.5, "sale")).error?.code).toBe("22023");
    expect((await adjust(frontDesk, retail, 1, "sale")).error?.code).toBe("22023");
  });

  it("lets only managers adjust, with a reason, in grams for color", async () => {
    expect((await adjust(frontDesk, color, -12.5, "adjustment", "Spilled")).error?.code).toBe("42501");
    expect((await adjust(manager, color, -12.5, "adjustment", "")).error?.code).toBe("22023");
    expect((await adjust(manager, color, 60, "adjustment", "Sample tube")).data).toBe(60);
    expect((await adjust(manager, color, -12.5, "adjustment", "Spilled")).data).toBe(47.5);
    // Counts, deliveries and service use have their own flows.
    for (const reason of ["count", "order_received", "service_use"] as const) expect((await adjust(owner, color, 5, reason, "x")).error?.code).toBe("22023");
    expect((await adjust(otherOwner, color, 5, "adjustment", "x")).error?.code).toBe("42501");
  });

  it("sets the reorder point (managers), and refuses direct writes", async () => {
    const settings = (client: Client) => client.rpc("set_stock_settings", { p_location_id: L, p_product_id: color, p_reorder_point: 120, p_reorder_quantity: 4 });
    expect((await settings(frontDesk)).error?.code).toBe("42501");
    expect((await settings(manager)).error).toBeNull();
    expect(await level(color)).toMatchObject({ reorder_point: 120, reorder_quantity: 4 });

    const { data: updated } = await manager.from("stock_levels").update({ on_hand: 9999 }).eq("product_id", color).select("id");
    expect(updated ?? []).toEqual([]);
    const insert = await manager.from("stock_movements").insert({ business_id: B, location_id: L, product_id: color, change: 1, on_hand_after: 1, reason: "count" });
    expect(insert.error?.code).toBe("42501");
  });
});
