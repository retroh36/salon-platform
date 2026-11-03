// The salon's own stylist levels (staff_levels, save_staff_levels): every
// salon starts with three, only its staff read them, owners and managers
// change them, a level someone is on can't be removed, and level prices
// follow whatever levels the salon has.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

type Salon = Awaited<ReturnType<typeof createOtherSalon>>;
let other: Salon;
let otherOwner: Client;
let frontDesk: Client;
let manager: Client;

const levelsOf = async (business: string) => {
  const { data, error } = await admin.from("staff_levels").select("key, name, position, color, symbol").eq("business_id", business).order("position");
  if (error) throw error;
  return data;
};
const asDrafts = (rows: { key: string | null; name: string; color: string; symbol: string }[]) => rows.map(({ key, name, color, symbol }) => ({ key, name, color, symbol }));

beforeAll(async () => {
  other = await createOtherSalon();
  otherOwner = await signIn(other.email);
  [frontDesk, manager] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("manager@mapleandash.test")]);
});

afterAll(async () => {
  await other?.cleanup();
});

describe("stylist levels", () => {
  it("gives every new salon Master, Senior and Artisan", async () => {
    expect(await levelsOf(other.businessId)).toEqual([
      { key: "master", name: "Master", position: 0, color: "gold", symbol: "star" },
      { key: "senior", name: "Senior", position: 1, color: "fuchsia", symbol: "two_dots" },
      { key: "artisan", name: "Artisan", position: 2, color: "green", symbol: "dot" },
    ]);
  });

  it("has Maple & Ash's four, with Hannah a Junior stylist", async () => {
    expect((await levelsOf(SEED.business)).map((l) => [l.key, l.name, l.color, l.symbol])).toEqual([
      ["master", "Master", "gold", "star"],
      ["senior", "Senior", "fuchsia", "two_dots"],
      ["artisan", "Artisan", "green", "dot"],
      ["junior", "Junior stylist", "blue", "triangle"],
    ]);
    const { data } = await admin.from("staff").select("level").eq("id", SEED.staff.hannah).single();
    expect(data!.level).toBe("junior");
  });

  it("shows a salon's levels only to its own staff", async () => {
    const { data: mine } = await frontDesk.from("staff_levels").select("key").eq("business_id", SEED.business);
    expect(mine).toHaveLength(4);
    const { data: theirs } = await otherOwner.from("staff_levels").select("key").eq("business_id", SEED.business);
    expect(theirs).toEqual([]);
    const { error } = await otherOwner.from("staff_levels").insert({ business_id: other.businessId, key: "x", name: "X", position: 9, color: "gold", symbol: "star" });
    expect(error).not.toBeNull();
  });

  it("lets only owners and managers change them", async () => {
    const current = asDrafts(await levelsOf(SEED.business));
    const refused = await frontDesk.rpc("save_staff_levels", { p_business_id: SEED.business, p_levels: current });
    expect(refused.error?.code).toBe("42501");
    const ok = await manager.rpc("save_staff_levels", { p_business_id: SEED.business, p_levels: current });
    expect(ok.error).toBeNull();
    const wrongSalon = await otherOwner.rpc("save_staff_levels", { p_business_id: SEED.business, p_levels: current });
    expect(wrongSalon.error?.code).toBe("42501");
  });

  it("renames, reorders and adds, keeping keys", async () => {
    const { error } = await otherOwner.rpc("save_staff_levels", {
      p_business_id: other.businessId,
      p_levels: [
        { key: "senior", name: "Senior", color: "fuchsia", symbol: "two_dots" },
        { key: "master", name: "Creative Director", color: "gold", symbol: "star" },
        { key: null, name: "New Talent", color: "blue", symbol: "triangle" },
        { key: "artisan", name: "Artisan", color: "violet", symbol: "dot" },
      ],
    });
    expect(error).toBeNull();
    expect((await levelsOf(other.businessId)).map((l) => [l.key, l.name, l.position, l.color])).toEqual([
      ["senior", "Senior", 0, "fuchsia"],
      ["master", "Creative Director", 1, "gold"],
      ["new_talent", "New Talent", 2, "blue"],
      ["artisan", "Artisan", 3, "violet"],
    ]);
  });

  it("refuses a color or badge off the palette, two of the same name, and an empty list", async () => {
    const base = asDrafts(await levelsOf(other.businessId));
    const off = await otherOwner.rpc("save_staff_levels", { p_business_id: other.businessId, p_levels: [{ ...base[0], color: "crimson" }, ...base.slice(1)] });
    expect(off.error).not.toBeNull();
    const twice = await otherOwner.rpc("save_staff_levels", { p_business_id: other.businessId, p_levels: [...base, { key: null, name: "senior", color: "slate", symbol: "diamond" }] });
    expect(twice.error).not.toBeNull();
    const none = await otherOwner.rpc("save_staff_levels", { p_business_id: other.businessId, p_levels: [] });
    expect(none.error?.code).toBe("22023");
    expect(await levelsOf(other.businessId)).toHaveLength(4);
  });

  it("keeps a stylist's level to one the salon has", async () => {
    const { error } = await admin.from("staff").insert({ business_id: other.businessId, location_id: other.locationId, first_name: "Nobody", role: "stylist", level: "junior" });
    expect(error).not.toBeNull();
  });

  it("prices services by any level, and won't remove a level someone is on", async () => {
    const { data: service, error: sErr } = await admin.from("services").insert({ business_id: other.businessId, name: "Cut", category: "Cuts", active_minutes: 45, price_cents: 8000 }).select("id").single();
    if (sErr) throw sErr;
    const prices = await otherOwner.rpc("set_service_level_prices", { p_service_id: service.id, p_prices: { new_talent: 6000, master: 12000 } });
    expect(prices.error).toBeNull();
    const { data: rows } = await admin.from("service_level_prices").select("level, price_cents").eq("service_id", service.id).order("level");
    expect(rows).toEqual([
      { level: "master", price_cents: 12000 },
      { level: "new_talent", price_cents: 6000 },
    ]);

    const { data: stylist, error: stErr } = await admin.from("staff").insert({ business_id: other.businessId, location_id: other.locationId, first_name: "Robin", role: "stylist", level: "new_talent" }).select("id").single();
    if (stErr) throw stErr;
    const without = asDrafts(await levelsOf(other.businessId)).filter((l) => l.key !== "new_talent");
    const inUse = await otherOwner.rpc("save_staff_levels", { p_business_id: other.businessId, p_levels: without });
    expect(inUse.error?.hint).toBe("in_use");
    expect(inUse.error?.message).toContain("New Talent");

    await admin.from("staff").update({ level: "senior" }).eq("id", stylist.id);
    const removed = await otherOwner.rpc("save_staff_levels", { p_business_id: other.businessId, p_levels: without });
    expect(removed.error).toBeNull();
    expect((await levelsOf(other.businessId)).map((l) => l.key)).toEqual(["senior", "master", "artisan"]);
    // Its prices go with it.
    const { data: left } = await admin.from("service_level_prices").select("level").eq("service_id", service.id);
    expect(left).toEqual([{ level: "master" }]);
  });
});
