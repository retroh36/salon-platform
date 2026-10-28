// Schedule changes reach every calendar: any change to the hours people can
// be booked moves the location's calendar version (so open calendars reload
// and bookings checked against the old hours are checked again), whatever
// made it; drafts don't. Realtime carries the version to signed-in staff.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@/lib/database.types";
import { addDays, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED, signIn, throwawayStylist, type Client } from "./helpers";

const L = SEED.location;
const B = SEED.business;
const week = addDays(startOfWeek(todayIn("America/Chicago")), 35);
const wednesday = addDays(week, 2);
let manager: Client;
let stylist: Awaited<ReturnType<typeof throwawayStylist>>;

const version = async () => (await admin.from("locations").select("calendar_version").eq("id", L).single()).data!.calendar_version;
// How far a change moves the version (0: not at all).
async function moves(change: () => PromiseLike<{ error: unknown }>) {
  const before = await version();
  const { error } = await change();
  expect(error).toBeNull();
  return (await version()) - before;
}

beforeAll(async () => {
  manager = await signIn("manager@mapleandash.test");
  stylist = await throwawayStylist("Live");
});
afterAll(async () => {
  await admin.from("schedule_drafts").delete().eq("staff_id", stylist.id);
  await stylist.remove();
});

describe("the calendar version", () => {
  it("doesn't move for a draft, and moves when it's published", async () => {
    const days = [{ staff_id: stylist.id, on_date: wednesday, shifts: [{ start: 660, end: 1140 }] }];
    expect(await moves(() => manager.rpc("save_schedule_drafts", { p_location_id: L, p_days: days as unknown as Json }))).toBe(0);
    expect(await moves(() => manager.rpc("publish_schedule_week", { p_location_id: L, p_week_start: week }))).toBeGreaterThan(0);
  });

  it("moves for hours changed any other way, too", async () => {
    expect(await moves(() => admin.from("staff_working_hours").insert({ business_id: B, staff_id: stylist.id, weekday: 4, start_minute: 540, end_minute: 1020 }))).toBeGreaterThan(0);
    expect(await moves(() => admin.from("staff_schedule_overrides").insert({ business_id: B, staff_id: stylist.id, on_date: addDays(wednesday, 1), start_minute: 600, end_minute: 900 }))).toBeGreaterThan(0);
    expect(await moves(() => admin.from("staff_days_off").insert({ business_id: B, staff_id: stylist.id, on_date: addDays(wednesday, 2) }))).toBeGreaterThan(0);
    expect(await moves(() => admin.from("staff_days_off").delete().eq("staff_id", stylist.id))).toBeGreaterThan(0);
    // A change that leaves the hours as they were doesn't.
    expect(await moves(() => admin.from("staff").update({ calendar_zoom: "compact" }).eq("id", stylist.id))).toBe(0);
  });

  it("comes on a row only the salon's own staff can read, so Realtime sends it to nobody else", async () => {
    const { data } = await admin.rpc("tables_without_rls");
    expect(data).toEqual([]);
    const other = await signIn("owner@harborvine.test");
    expect((await other.from("locations").select("id").eq("id", L)).data).toEqual([]);
  });
});
