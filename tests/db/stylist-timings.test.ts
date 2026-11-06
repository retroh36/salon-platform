// A stylist's own service times, set by hand or copied (set_staff_timings):
// whoever manages them, only services they do, valid times, all or nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, type Client, SEED, signIn, throwawayStylist } from "./helpers";

const B = SEED.business;
let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
let manager: Client;
let frontDesk: Client;
let cut: string;
let color: string;
let notOffered: string;

const timing = (service_id: string, active: number | null, processing: number | null = active === null ? null : 0, finishing: number | null = active === null ? null : 0) => ({
  service_id,
  active_minutes: active,
  processing_minutes: processing,
  finishing_minutes: finishing,
});
const own = async () =>
  Object.fromEntries(((await admin.from("staff_services").select("service_id, active_minutes, processing_minutes, finishing_minutes").eq("staff_id", stylist.id)).data ?? []).map((r) => [r.service_id, r.active_minutes === null ? null : [r.active_minutes, r.processing_minutes, r.finishing_minutes]]));

beforeAll(async () => {
  stylist = await throwawayStylist("Timings");
  [manager, frontDesk] = await Promise.all([signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  const { data: services } = await admin.from("services").select("id, name").eq("business_id", B).in("name", ["Women's Cut & Style", "All-Over Color", "Blowout"]);
  const id = (name: string) => services!.find((s) => s.name === name)!.id;
  [cut, color, notOffered] = [id("Women's Cut & Style"), id("All-Over Color"), id("Blowout")];
  await admin.from("staff_services").insert([cut, color].map((service_id) => ({ business_id: B, staff_id: stylist.id, service_id })));
});

afterAll(async () => {
  await admin.from("staff_services").delete().eq("staff_id", stylist.id);
  await stylist.remove();
});

describe("a stylist's own service times", () => {
  it("are saved by a manager, and back to the menu's with nulls", async () => {
    const r = await manager.rpc("set_staff_timings", { p_staff_id: stylist.id, p_timings: [timing(cut, 50), timing(color, 45, 30, 10)] });
    expect(r).toMatchObject({ data: 2, error: null });
    expect(await own()).toEqual({ [cut]: [50, 0, 0], [color]: [45, 30, 10] });
    await manager.rpc("set_staff_timings", { p_staff_id: stylist.id, p_timings: [timing(cut, null)] });
    expect((await own())[cut]).toBeNull();
  });

  it("are all or nothing: a service they don't do or a bad time saves none", async () => {
    const before = await own();
    const offered = await manager.rpc("set_staff_timings", { p_staff_id: stylist.id, p_timings: [timing(cut, 55), timing(notOffered, 30)] });
    expect(offered.error?.hint).toBe("not_offered");
    const bad = await manager.rpc("set_staff_timings", { p_staff_id: stylist.id, p_timings: [timing(cut, 55), timing(color, 30, 0, 10)] });
    expect(bad.error?.code).toBe("23514");
    expect(await own()).toEqual(before);
  });

  it("aren't the front desk's to change", async () => {
    const r = await frontDesk.rpc("set_staff_timings", { p_staff_id: stylist.id, p_timings: [timing(cut, 60)] });
    expect(r.error?.code).toBe("42501");
  });
});
