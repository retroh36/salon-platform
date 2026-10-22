// Recurring appointments: booking a series visit by visit through the
// booking rules, and changing or canceling this / following / all visits.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { saveBooking } from "@/lib/scheduling/book";
import { seriesDates, type VisitLine } from "@/lib/scheduling/series";
import { bookSeries, changeSeries, changeSeriesStatus, moveSeriesItem, seriesVisits } from "@/lib/scheduling/series-book";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { priya: PRIYA, ethan: ETHAN } = SEED.staff;
const location = { id: L, timezone: TZ, businessId: B };
// Tuesdays far from the seeded month; Priya works 9-1 and 2-6.
const FIRST = "2031-08-05";
const DATES = seriesDates(FIRST, 2, { kind: "count", count: 4 }); // Aug 5, 19, Sep 2, 16

let frontDesk: Client;
let priya: Client;
let cut: string;
let clientId: string;
let otherClient: string;

const lines = (staffId = PRIYA, startMinute = 10 * 60): VisitLine[] => [{ serviceId: cut, staffId, startMinute, resource: "none" }];
const at = (date: string, hour: number, minute = 0) => fromLocal(date, hour * 60 + minute, TZ)!;

async function clear() {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(FIRST, 0).toISOString()).lt("starts_at", at("2031-10-01", 0).toISOString());
  await admin.from("appointment_series").delete().eq("location_id", L).eq("client_id", clientId);
}

beforeAll(async () => {
  [frontDesk, priya] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("priya@mapleandash.test")]);
  const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single();
  cut = s!.id;
  const { data: c } = await admin.from("clients").select("id").eq("business_id", B).order("id").limit(2);
  [clientId, otherClient] = [c![0].id, c![1].id];
  await clear();
});
afterEach(clear);
afterAll(clear);

async function book() {
  return bookSeries(frontDesk, location, { clientId, notes: null, intervalWeeks: 2, end: { kind: "count", count: 4 }, visits: DATES.map((date) => ({ date, lines: lines() })) });
}

describe("booking a series", () => {
  it("books each visit through the rules, linked in order, and reports any that don't fit", async () => {
    // Someone else has Priya at 10 on the third date.
    const clash = await saveBooking(frontDesk, location, { clientId: otherClient, notes: null, items: [{ serviceId: cut, staffId: PRIYA, start: at(DATES[2], 10), resource: { kind: "none" } }] });
    expect(clash.ok).toBe(true);

    const { seriesId, results } = await book();
    expect(results.map((r) => [r.date, r.ok])).toEqual([
      [DATES[0], true],
      [DATES[1], true],
      [DATES[2], false],
      [DATES[3], true],
    ]);
    expect(results[2]).toMatchObject({ error: "invalid", problems: [[expect.objectContaining({ code: "staff_double_booked" })]] });

    const visits = await seriesVisits(admin, seriesId!, TZ);
    expect(visits.map((v) => [v.index, v.date])).toEqual([
      [1, DATES[0]],
      [2, DATES[1]],
      [3, DATES[3]],
    ]);
    const { data: series } = await admin.from("appointment_series").select("interval_weeks, occurrences, client_id").eq("id", seriesId!).single();
    expect(series).toEqual({ interval_weeks: 2, occurrences: 4, client_id: clientId });
  });

  it("is front of house only, one client per series", async () => {
    const { results } = await bookSeries(priya, location, { clientId, notes: null, intervalWeeks: 2, end: { kind: "count", count: 2 }, visits: [{ date: FIRST, lines: lines() }] });
    expect(results).toEqual([{ date: FIRST, ok: false, error: "forbidden" }]);
    const { seriesId } = await book();
    const other = await saveBooking(frontDesk, location, { clientId: otherClient, notes: null, items: [{ serviceId: cut, staffId: ETHAN, start: at(FIRST, 15), resource: { kind: "none" } }] });
    const { error } = await frontDesk.rpc("set_appointment_series", { p_appointment_id: other.ok ? other.appointmentId : "", p_series_id: seriesId!, p_index: 9 });
    expect(error?.code).toBe("22023");
  });
});

describe("changing a series", () => {
  it("changes this and following visits, leaving earlier ones", async () => {
    const { seriesId, results } = await book();
    const second = results[1].ok ? results[1].appointmentId : "";
    const changed = await changeSeries(frontDesk, location, second, "following", { clientId, notes: "Shorter layers", lines: lines(PRIYA, 11 * 60) });
    expect(changed.every((r) => r.ok)).toBe(true);
    expect(changed.map((r) => r.date)).toEqual(DATES.slice(1));
    const visits = await seriesVisits(admin, seriesId!, TZ);
    expect(visits.map((v) => [v.index, v.items[0].startMinute, v.notes])).toEqual([
      [1, 600, null],
      [2, 660, "Shorter layers"],
      [3, 660, "Shorter layers"],
      [4, 660, "Shorter layers"],
    ]);
  });

  it("moves a service on all visits by the same amount, reporting ones that don't fit", async () => {
    const { seriesId } = await book();
    let visits = await seriesVisits(admin, seriesId!, TZ);
    // Priya has someone at 12:00 on the last date.
    await saveBooking(frontDesk, location, { clientId: otherClient, notes: null, items: [{ serviceId: cut, staffId: PRIYA, start: at(DATES[3], 12), resource: { kind: "none" } }] });
    const results = await moveSeriesItem(frontDesk, location, { itemId: visits[0].items[0].id, staffId: PRIYA, start: at(FIRST, 11, 30) }, "all");
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    visits = await seriesVisits(admin, seriesId!, TZ);
    expect(visits.map((v) => v.items[0].startMinute)).toEqual([690, 690, 690, 600]);

    // To another stylist for this visit only.
    await moveSeriesItem(frontDesk, location, { itemId: visits[1].items[0].id, staffId: ETHAN, start: at(DATES[1], 11, 30) }, "this");
    visits = await seriesVisits(admin, seriesId!, TZ);
    expect(visits.map((v) => v.items[0].staffId)).toEqual([PRIYA, ETHAN, PRIYA, PRIYA]);
  });

  it("cancels this and following, or all", async () => {
    const { seriesId, results } = await book();
    const third = results[2].ok ? results[2].appointmentId : "";
    const canceled = await changeSeriesStatus(frontDesk, third, "following", "cancel", "Client rescheduled", TZ);
    expect(canceled.map((c) => [c.date, c.result.ok])).toEqual([
      [DATES[2], true],
      [DATES[3], true],
    ]);
    let visits = await seriesVisits(admin, seriesId!, TZ);
    expect(visits.map((v) => v.status)).toEqual(["booked", "booked", "canceled", "canceled"]);
    await changeSeriesStatus(frontDesk, third, "all", "cancel", "Client canceled", TZ);
    visits = await seriesVisits(admin, seriesId!, TZ);
    expect(visits.map((v) => v.status)).toEqual(["canceled", "canceled", "canceled", "canceled"]);
  });
});
