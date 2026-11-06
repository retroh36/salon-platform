// product_usage: what each product went out as at a location over local
// dates, summed, read under stock history's RLS (the front of house).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, type Client, SEED, signIn } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const PREFIX = `Pu${Date.now().toString(36)}`;
let productId: string;
let manager: Client;
let stylist: Client;

const at = (day: string, minute: number) => fromLocal(day, minute, TZ)!.toISOString();

beforeAll(async () => {
  [manager, stylist] = await Promise.all([signIn("manager@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  const { data } = await admin.from("products").insert({ business_id: B, brand: PREFIX, name: "7N", type: "color", unit: "g", size: 60, cost_cents: 950 }).select("id").single();
  productId = data!.id;
  const move = (change: number, reason: "service_use" | "sale" | "count", created_at: string) => ({ business_id: B, location_id: L, product_id: productId, change, on_hand_after: 0, reason, created_at });
  await admin.from("stock_movements").insert([
    // Just before midnight on the 1st, and through the 2nd, in Chicago.
    move(-10, "service_use", at("2031-03-01", 23 * 60 + 59)),
    move(-30, "service_use", at("2031-03-02", 0)),
    move(-25, "service_use", at("2031-03-02", 23 * 60 + 59)),
    move(-2, "sale", at("2031-03-02", 12 * 60)),
    move(1, "sale", at("2031-03-02", 13 * 60)),
    // Counts aren't usage.
    move(-40, "count", at("2031-03-02", 14 * 60)),
    move(-7, "service_use", at("2031-03-03", 0)),
  ]);
});

afterAll(async () => {
  await admin.from("stock_movements").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
});

describe("product usage", () => {
  it("sums service use and sales by the salon's local days", async () => {
    const { data, error } = await manager.rpc("product_usage", { p_location_id: L, p_from: "2031-03-02", p_to: "2031-03-02" });
    expect(error).toBeNull();
    const mine = data!.filter((r) => r.product_id === productId).map((r) => [r.reason, Number(r.change)]).sort();
    expect(mine).toEqual([
      ["sale", -1],
      ["service_use", -55],
    ]);
  });

  it("is front of house only", async () => {
    const { data } = await stylist.rpc("product_usage", { p_location_id: L, p_from: "2031-03-01", p_to: "2031-03-03" });
    expect((data ?? []).filter((r) => r.product_id === productId)).toEqual([]);
  });
});
