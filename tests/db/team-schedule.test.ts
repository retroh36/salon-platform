// The team schedule: drafts only owners and managers see, publishing (the
// booking rules' hours change, and the person is told), days off, repeating
// patterns over several weeks, and who may do what.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@/lib/database.types";
import { loadStaffSchedules } from "@/lib/scheduling/load";
import { hoursOn } from "@/lib/scheduling/availability";
import { addDays, startOfWeek, todayIn, type LocalDate } from "@/lib/scheduling/time";
import { admin, SEED, signIn, throwawayStylist, type Client } from "./helpers";

const L = SEED.location;
const nineToFive = { start: 9 * 60, end: 17 * 60 };

let manager: Client;
let frontDesk: Client;
let bridget: Client;
let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
const started = new Date().toISOString();
// Two weeks out, so nothing booked or published already touches it.
const week = addDays(startOfWeek(todayIn("America/Chicago")), 14);
const day = (offset: number): LocalDate => addDays(week, offset);

// Tue–Sat 9 to 5, as one week.
const pattern = [2, 3, 4, 5, 6].map((weekday) => ({ cycle_week: 0, weekday, start_minute: nineToFive.start, end_minute: nineToFive.end }));

async function hours(date: LocalDate) {
  const s = (await loadStaffSchedules(admin, [stylist.id], date, date)).get(stylist.id)!;
  return hoursOn(s, date);
}

const saveDrafts = (client: Client, days: { staff_id: string; on_date: string; shifts: { start: number; end: number }[] }[]) =>
  client.rpc("save_schedule_drafts", { p_location_id: L, p_days: days as unknown as Json });

beforeAll(async () => {
  [manager, frontDesk, bridget] = await Promise.all([signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  stylist = await throwawayStylist("Rota");
  const { error } = await manager.rpc("set_staff_pattern", { p_staff_id: stylist.id, p_weeks: 1, p_starts_on: week, p_hours: pattern as unknown as Json });
  if (error) throw error;
});

afterAll(async () => {
  await admin.from("schedule_publishes").delete().eq("location_id", L).gte("published_at", started);
  await stylist.remove();
});

describe("who can change the schedule", () => {
  it("lets only owners and managers save, publish and see drafts", async () => {
    const days = [{ staff_id: stylist.id, on_date: day(1), shifts: [{ start: 600, end: 840 }] }];
    expect((await saveDrafts(frontDesk, days)).error?.code).toBe("42501");
    expect((await saveDrafts(bridget, days)).error?.code).toBe("42501");
    expect((await frontDesk.rpc("publish_schedule_week", { p_location_id: L, p_week_start: week })).error?.code).toBe("42501");
    expect((await bridget.rpc("set_staff_pattern", { p_staff_id: stylist.id, p_weeks: 1, p_starts_on: week, p_hours: [] })).error?.code).toBe("42501");

    expect((await saveDrafts(manager, days)).error).toBeNull();
    const seen = async (c: Client) => (await c.from("schedule_drafts").select("id").eq("staff_id", stylist.id)).data!.length;
    expect(await seen(manager)).toBe(1);
    expect(await seen(frontDesk)).toBe(0);
    expect(await seen(bridget)).toBe(0);
    expect((await admin.from("schedule_drafts").insert({ business_id: SEED.business, location_id: L, staff_id: stylist.id, on_date: day(2), shifts: [], updated_by: SEED.staff.manager })).error).toBeNull();
    // Nobody signed in writes drafts directly.
    expect((await manager.from("schedule_drafts").delete().eq("staff_id", stylist.id).select("id")).data).toEqual([]);
    await manager.rpc("discard_schedule_drafts", { p_location_id: L, p_week_start: week });
    expect(await seen(manager)).toBe(0);
  });

  it("refuses shifts that overlap, touch or aren't on 5-minute steps", async () => {
    for (const shifts of [
      [{ start: 540, end: 780 }, { start: 720, end: 1020 }],
      [{ start: 540, end: 780 }, { start: 780, end: 1020 }],
      [{ start: 541, end: 780 }],
      [{ start: 780, end: 540 }],
    ]) {
      expect((await saveDrafts(manager, [{ staff_id: stylist.id, on_date: day(1), shifts }])).error?.code).toBe("22023");
    }
  });
});

describe("drafts and publishing", () => {
  it("changes nothing until the week is published, then the new hours are live and the person is told", async () => {
    // Tuesday shorter, Wednesday off, Thursday a split shift.
    const { error } = await saveDrafts(manager, [
      { staff_id: stylist.id, on_date: day(1), shifts: [{ start: 600, end: 840 }] },
      { staff_id: stylist.id, on_date: day(2), shifts: [] },
      { staff_id: stylist.id, on_date: day(3), shifts: [{ start: 840, end: 1080 }, { start: 540, end: 780 }] },
      // The same as published: no draft.
      { staff_id: stylist.id, on_date: day(4), shifts: [nineToFive] },
    ]);
    expect(error).toBeNull();
    expect((await manager.from("schedule_drafts").select("on_date").eq("staff_id", stylist.id).order("on_date")).data!.map((d) => d.on_date)).toEqual([day(1), day(2), day(3)]);
    expect(await hours(day(1))).toEqual([nineToFive]);

    const published = await manager.rpc("publish_schedule_week", { p_location_id: L, p_week_start: week });
    expect(published.error).toBeNull();
    expect(published.data).toEqual({ days_changed: 3, people_notified: 1 });

    expect(await hours(day(1))).toEqual([{ start: 600, end: 840 }]);
    expect(await hours(day(2))).toEqual([]);
    expect(await hours(day(3))).toEqual([{ start: 540, end: 780 }, { start: 840, end: 1080 }]);
    // The pattern goes on in the weeks after.
    expect(await hours(day(8))).toEqual([nineToFive]);
    expect(await hours(day(9))).toEqual([nineToFive]);
    expect((await admin.from("schedule_drafts").select("id").eq("staff_id", stylist.id)).data).toEqual([]);

    const { data: notices } = await admin.from("notifications").select("body, channel, template").eq("staff_id", stylist.id).eq("template", "schedule_changed");
    expect(notices).toHaveLength(1);
    expect(notices![0].channel).toBe("app");
    expect(notices![0].body).toContain("10am–2pm (was 9am–5pm)");
    expect(notices![0].body).toContain("off (was 9am–5pm)");
    expect(notices![0].body).toContain("9am–1pm, 2pm–6pm");

    const { data: log } = await frontDesk.from("schedule_publishes").select("days_changed, people_notified").eq("week_start", week).gte("published_at", started);
    expect(log).toEqual([{ days_changed: 3, people_notified: 1 }]);
  });

  it("puts a day back to its pattern, and publishing with nothing changed tells nobody", async () => {
    await saveDrafts(manager, [{ staff_id: stylist.id, on_date: day(2), shifts: [nineToFive] }]);
    const back = await manager.rpc("publish_schedule_week", { p_location_id: L, p_week_start: week });
    expect(back.data).toEqual({ days_changed: 1, people_notified: 1 });
    expect(await hours(day(2))).toEqual([nineToFive]);
    expect((await admin.from("staff_days_off").select("id").eq("staff_id", stylist.id)).data).toEqual([]);
    expect((await admin.from("staff_schedule_overrides").select("on_date").eq("staff_id", stylist.id).eq("on_date", day(2))).data).toEqual([]);

    const nothing = await manager.rpc("publish_schedule_week", { p_location_id: L, p_week_start: week });
    expect(nothing.data).toEqual({ days_changed: 0, people_notified: 0 });
  });
});

describe("repeating patterns", () => {
  it("repeats over two weeks (every other Saturday off), and a week changed on its own leaves the pattern alone", async () => {
    // Week 1: Tue–Sat; week 2: Tue–Fri. Counted from `week`.
    const twoWeeks = [...pattern, ...pattern.filter((p) => p.weekday !== 6).map((p) => ({ ...p, cycle_week: 1 }))];
    const { error } = await manager.rpc("set_staff_pattern", { p_staff_id: stylist.id, p_weeks: 2, p_starts_on: day(3), p_hours: twoWeeks as unknown as Json });
    expect(error).toBeNull();
    const saturday = (n: number) => day(5 + n * 7);
    expect(await hours(saturday(0))).toEqual([nineToFive]);
    expect(await hours(saturday(1))).toEqual([]);
    expect(await hours(saturday(2))).toEqual([nineToFive]);
    // Weeks before the start follow the cycle too.
    expect(await hours(saturday(-1))).toEqual([]);

    // Working the second week's Saturday this once.
    await saveDrafts(manager, [{ staff_id: stylist.id, on_date: saturday(1), shifts: [{ start: 600, end: 960 }] }]);
    await manager.rpc("publish_schedule_week", { p_location_id: L, p_week_start: addDays(week, 7) });
    expect(await hours(saturday(1))).toEqual([{ start: 600, end: 960 }]);
    expect(await hours(saturday(3))).toEqual([]);
    expect(await hours(saturday(4))).toEqual([nineToFive]);

    const { data: staff } = await admin.from("staff").select("hours_cycle_weeks").eq("id", stylist.id).single();
    expect(staff!.hours_cycle_weeks).toBe(2);
    expect((await admin.from("notifications").select("id").eq("staff_id", stylist.id).eq("template", "schedule_pattern_changed")).data!.length).toBeGreaterThan(0);
  });

  it("is checked: weeks in range, a start for several weeks", async () => {
    expect((await manager.rpc("set_staff_pattern", { p_staff_id: stylist.id, p_weeks: 5, p_starts_on: week, p_hours: [] })).error?.code).toBe("22023");
    expect((await manager.rpc("set_staff_pattern", { p_staff_id: stylist.id, p_weeks: 2, p_starts_on: week, p_hours: [{ cycle_week: 2, weekday: 1, start_minute: 540, end_minute: 600 }] })).error?.code).toBe("22023");
  });
});
