// Stocktakes: counting, the difference from what was expected, and putting
// stock right. Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const RUN = `St${Date.now().toString(36)}`;

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let manager: Client;
let frontDesk: Client;
let stylist: Client;
let otherOwner: Client;
let color: string;
let shampoo: string;
let untouched: string;

async function product(name: string, type: "retail" | "back_bar", onHand: number) {
  const { data } = await admin
    .from("products")
    .insert({ business_id: B, brand: RUN, name, type, unit: type === "retail" ? "unit" : "g", size: type === "retail" ? 1 : 60, cost_cents: 1000, price_cents: type === "retail" ? 2000 : null })
    .select("id")
    .single();
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: data!.id, on_hand: onHand });
  await admin.from("stock_movements").insert({ business_id: B, location_id: L, product_id: data!.id, change: onHand, on_hand_after: onHand, reason: "count" });
  return data!.id;
}

const level = async (id: string) => (await admin.from("stock_levels").select("on_hand").eq("product_id", id).single()).data!.on_hand;
const count = (client: Client, stocktake: string, productId: string, counted: number) => client.rpc("record_count", { p_stocktake_id: stocktake, p_product_id: productId, p_counted: counted });

beforeAll(async () => {
  other = await createOtherSalon();
  [manager, frontDesk, stylist, otherOwner] = await Promise.all([
    signIn("manager@mapleandash.test"),
    signIn("frontdesk@mapleandash.test"),
    signIn("priya@mapleandash.test"),
    signIn(other.email),
  ]);
});

afterEach(async () => {
  await admin.from("stocktakes").delete().eq("location_id", L);
  await admin.from("products").delete().eq("brand", RUN);
});

afterAll(async () => {
  await other?.cleanup();
});

describe("a stocktake", () => {
  it("counts partly used tubes, shows the difference, and puts stock right when finished", async () => {
    [color, shampoo, untouched] = [await product("7N", "back_bar", 300), await product("Shampoo", "retail", 8), await product("Not counted", "back_bar", 120)];
    const { data: id, error } = await manager.rpc("start_stocktake", { p_location_id: L });
    expect(error).toBeNull();
    // One at a time: starting again returns the same one.
    expect((await manager.rpc("start_stocktake", { p_location_id: L })).data).toBe(id);

    // 2 full tubes and 24 g in an open one.
    expect(await count(manager, id!, color, 144)).toMatchObject({ data: 300, error: null });
    expect(await count(manager, id!, shampoo, 9)).toMatchObject({ data: 8 });
    // A recount replaces the count.
    expect(await count(manager, id!, color, 150)).toMatchObject({ data: 300 });
    // Nothing changes until it's finished.
    expect(await level(color)).toBe(300);

    const { data: changed } = await manager.rpc("finish_stocktake", { p_stocktake_id: id! });
    expect(changed).toBe(2);
    expect(await level(color)).toBe(150);
    expect(await level(shampoo)).toBe(9);
    expect(await level(untouched)).toBe(120);
    const { data: moves } = await admin.from("stock_movements").select("product_id, change, reason, note, stocktake_id, created_by").eq("stocktake_id", id!).order("change");
    expect(moves).toEqual([
      { product_id: color, change: -150, reason: "count", note: "Stocktake", stocktake_id: id, created_by: SEED.staff.manager },
      { product_id: shampoo, change: 1, reason: "count", note: "Stocktake", stocktake_id: id, created_by: SEED.staff.manager },
    ]);
    const { data: done } = await admin.from("stocktakes").select("status, finished_by").eq("id", id!).single();
    expect(done).toEqual({ status: "completed", finished_by: SEED.staff.manager });

    // Finished: no more counts, and it can't be finished twice.
    expect((await count(manager, id!, color, 1)).error?.code).toBe("55000");
    expect((await manager.rpc("finish_stocktake", { p_stocktake_id: id! })).error?.code).toBe("55000");
  });

  it("doesn't count a sale made after the shelf was counted against it", async () => {
    shampoo = await product("Shampoo", "retail", 5);
    const { data: id } = await manager.rpc("start_stocktake", { p_location_id: L });
    // 4 on the shelf when counted (1 missing), then 1 sold.
    await count(manager, id!, shampoo, 4);
    await frontDesk.rpc("adjust_stock", { p_location_id: L, p_product_id: shampoo, p_change: -1, p_reason: "sale", p_note: "" });
    await manager.rpc("finish_stocktake", { p_stocktake_id: id! });
    expect(await level(shampoo)).toBe(3);
  });

  it("can be canceled without changing stock", async () => {
    color = await product("7N", "back_bar", 300);
    const { data: id } = await manager.rpc("start_stocktake", { p_location_id: L });
    await count(manager, id!, color, 60);
    expect((await manager.rpc("cancel_stocktake", { p_stocktake_id: id! })).error).toBeNull();
    expect(await level(color)).toBe(300);
    // A new one can start.
    const { data: next } = await manager.rpc("start_stocktake", { p_location_id: L });
    expect(next).not.toBe(id);
  });

  it("is run by owners and managers only", async () => {
    color = await product("7N", "back_bar", 300);
    expect((await frontDesk.rpc("start_stocktake", { p_location_id: L })).error?.code).toBe("42501");
    expect((await stylist.rpc("start_stocktake", { p_location_id: L })).error?.code).toBe("42501");
    const { data: id } = await manager.rpc("start_stocktake", { p_location_id: L });
    expect((await count(frontDesk, id!, color, 1)).error?.code).toBe("42501");
    expect((await count(otherOwner, id!, color, 1)).error?.code).toBe("42501");
    expect((await frontDesk.rpc("finish_stocktake", { p_stocktake_id: id! })).error?.code).toBe("42501");
    expect((await count(manager, id!, color, -1)).error?.code).toBe("22023");
    const { data: seen } = await frontDesk.from("stocktakes").select("id").eq("id", id!);
    expect(seen).toEqual([]);
    expect((await manager.from("stocktake_counts").insert({ business_id: B, stocktake_id: id!, product_id: color, counted: 1, expected: 1 })).error?.code).toBe("42501");
  });
});
