// Chairs and stations: home chairs, lending a chair for a shift (never two
// people on one station at once, never while its stylist works), who may do
// it, and services that need a room.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkItem, describeProblem } from "@/lib/scheduling/booking";
import { loadBookingContext } from "@/lib/scheduling/load";
import { pickResource } from "@/lib/scheduling/booking";
import { addDays, fromLocal, todayIn, weekdayOf, type LocalDate } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const L = SEED.location;
const TZ = "America/Chicago";
const CHAIR = (n: number) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROOM = CHAIR(9);
const started = new Date().toISOString();

let manager: Client;
let frontDesk: Client;
let bridget: Client;

// The next date (from a week out) that's this weekday.
function next(weekday: number): LocalDate {
  let d = addDays(todayIn(TZ), 7);
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}
// Sandra (Chair 4) doesn't work Saturdays or Mondays; Shae (Chair 5) works Saturdays.
const saturday = next(6);
const tuesday = next(2);

beforeAll(async () => {
  [manager, frontDesk, bridget] = await Promise.all([signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test")]);
});

afterAll(async () => {
  await admin.from("station_assignments").delete().eq("location_id", L).gte("created_at", started);
});

describe("home chairs", () => {
  it("are seeded, one person each, and only owners and managers set them", async () => {
    const { data } = await admin.from("staff").select("id, home_resource_id").eq("location_id", L).not("home_resource_id", "is", null);
    expect(new Map(data!.map((s) => [s.id, s.home_resource_id])).get(SEED.staff.sandra)).toBe(CHAIR(4));
    expect((await frontDesk.rpc("set_home_station", { p_staff_id: SEED.staff.ari, p_resource_id: CHAIR(6) })).error?.code).toBe("42501");
    // Someone else's chair, or a room, is refused.
    expect((await manager.rpc("set_home_station", { p_staff_id: SEED.staff.ari, p_resource_id: CHAIR(4) })).error?.message).toMatch(/already Sandra's chair/);
    expect((await manager.rpc("set_home_station", { p_staff_id: SEED.staff.ari, p_resource_id: ROOM })).error?.code).toBe("22023");
    expect((await manager.rpc("set_home_station", { p_staff_id: SEED.staff.ari, p_resource_id: CHAIR(6) })).error).toBeNull();
    expect((await manager.rpc("set_home_station", { p_staff_id: SEED.staff.ari })).error).toBeNull();
  });
});

describe("lending a chair", () => {
  it("lends Sandra's chair for Shae's Saturday, once, and only while Sandra's off", async () => {
    // Not by the front desk or a stylist.
    for (const c of [frontDesk, bridget]) {
      expect((await c.rpc("assign_station", { p_resource_id: CHAIR(4), p_staff_id: SEED.staff.shae, p_on_date: saturday })).error?.code).toBe("42501");
    }
    const lent = await manager.rpc("assign_station", { p_resource_id: CHAIR(4), p_staff_id: SEED.staff.shae, p_on_date: saturday });
    expect(lent.error).toBeNull();
    const { data: row } = await admin.from("station_assignments").select("start_minute, end_minute").eq("id", lent.data!).single();
    expect(row).toEqual({ start_minute: 8 * 60, end_minute: 16 * 60 });

    // Two people can't have it at once.
    const again = await manager.rpc("assign_station", { p_resource_id: CHAIR(4), p_staff_id: SEED.staff.gil, p_on_date: saturday, p_start: 600, p_end: 700 });
    expect(again.error?.code).toBe("23P01");
    // Sandra works Tuesdays: her chair is hers then.
    const busy = await manager.rpc("assign_station", { p_resource_id: CHAIR(4), p_staff_id: SEED.staff.shae, p_on_date: tuesday });
    expect(busy.error?.message).toMatch(/Sandra's chair, and Sandra is working then/);
    // Someone not working that day.
    const off = await manager.rpc("assign_station", { p_resource_id: CHAIR(6), p_staff_id: SEED.staff.sandra, p_on_date: saturday });
    expect(off.error?.message).toMatch(/isn't working that day/);

    // Everyone at the salon sees it; nobody writes it directly.
    expect((await bridget.from("station_assignments").select("id").eq("id", lent.data!)).data).toHaveLength(1);
    expect((await manager.from("station_assignments").delete().eq("id", lent.data!).select("id")).data).toEqual([]);

    // Bookings for Shae that day go in Chair 4.
    const ctx = await loadBookingContext(admin, { id: L, timezone: TZ }, saturday, saturday);
    const { data: cut } = await admin.from("services").select("id, active_minutes, processing_minutes, finishing_minutes").eq("business_id", SEED.business).eq("name", "Women's Cut & Style").single();
    const draft = { serviceId: cut!.id, staffId: SEED.staff.shae, start: fromLocal(saturday, 9 * 60, TZ)!, activeMinutes: cut!.active_minutes, processingMinutes: 0, finishingMinutes: 0 };
    expect(pickResource({ ...ctx, booked: [] }, draft)).toBe(CHAIR(4));

    expect((await manager.rpc("unassign_station", { p_assignment_id: lent.data! })).error).toBeNull();
    expect((await admin.from("station_assignments").select("id").eq("id", lent.data!)).data).toEqual([]);
  });
});

describe("rooms", () => {
  it("are reserved for room services, and those can't be booked without one", async () => {
    const ctx = await loadBookingContext(admin, { id: L, timezone: TZ }, tuesday, tuesday);
    const { data: keratin } = await admin.from("services").select("id, needs_room").eq("business_id", SEED.business).eq("name", "Keratin Smoothing").single();
    expect(keratin!.needs_room).toBe(true);
    const sandra = SEED.staff.sandra;
    const start = fromLocal(tuesday, 10 * 60, TZ)!;
    const timing = ctx.services.get(keratin!.id)!;
    const empty = { ...ctx, booked: [] };
    expect(pickResource(empty, { ...timing, serviceId: keratin!.id, staffId: sandra, start })).toBe(ROOM);
    const inChair = checkItem(empty, { serviceId: keratin!.id, staffId: sandra, resourceId: CHAIR(4), start });
    expect(inChair.valid ? [] : inChair.problems.map(describeProblem)).toContain("This service needs a room, and none is free then.");
    // The room taken: none free.
    const taken = { ...empty, booked: [{ ...timing, id: "x", serviceId: keratin!.id, staffId: SEED.staff.gil, resourceId: ROOM, start }] };
    expect(pickResource(taken, { ...timing, serviceId: keratin!.id, staffId: sandra, start })).toBeNull();
  });
});
