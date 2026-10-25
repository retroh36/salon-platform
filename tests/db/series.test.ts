// Recurring appointments: booking a series through the booking rules, all
// or nothing, and changing or canceling this / following / all visits.
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
const { bridget: BRIDGET, shae: SHAE } = SEED.staff;
const location = { id: L, timezone: TZ, businessId: B };
// Tuesdays far from the seeded month; Bridget works 9-1 and 2-6.
const FIRST = "2031-08-05";
const DATES = seriesDates(FIRST, 2, { kind: "count", count: 4 }); // Aug 5, 19, Sep 2, 16

let frontDesk: Client;
let bridget: Client;
let cut: string;
let clientId: string;
let otherClient: string;

const lines = (staffId = BRIDGET, startMinute = 10 * 60): VisitLine[] => [{ serviceId: cut, staffId, startMinute, resource: "none" }];
const at = (date: string, hour: number, minute = 0) => fromLocal(date, hour * 60 + minute, TZ)!;

async function clear() {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(FIRST, 0).toISOString()).lt("starts_at", at("2031-10-01", 0).toISOString());
  await admin.from("appointment_series").delete().eq("location_id", L).eq("client_id", clientId);
}

beforeAll(async () => {
  [frontDesk, bridget] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test")]);
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
  it("books every visit through the rules, linked in order, or none, saying which don't fit", async () => {
    const { seriesId, results } = await book();
    expect(results.every((r) => r.ok)).toBe(true);
    const visits = await seriesVisits(admin, seriesId!, TZ);
    expect(visits.map((v) => [v.index, v.date])).toEqual(DATES.map((d, n) => [n + 1, d]));
    const { data: series } = await admin.from("appointment_series").select("interval_weeks, occurrences, client_id").eq("id", seriesId!).single();
    expect(series).toEqual({ interval_weeks: 2, occurrences: 4, client_id: clientId });
    await clear();

    // Someone else has Bridget at 10 on the third date: nothing is booked,
    // and no empty series is left.
    const clash = await saveBooking(frontDesk, location, { clientId: otherClient, notes: null, items: [{ serviceId: cut, staffId: BRIDGET, start: at(DATES[2], 10), resource: { kind: "none" } }] });
    expect(clash.ok).toBe(true);
    const refused = await book();
    expect(refused.seriesId).toBeNull();
    expect(refused.results.map((r) => [r.date, r.ok ? "ok" : r.error])).toEqual([
      [DATES[0], "held_back"],
      [DATES[1], "held_back"],
      [DATES[2], "invalid"],
      [DATES[3], "held_back"],
    ]);
    expect(refused.results[2]).toMatchObject({ problems: [[expect.objectContaining({ code: "staff_double_booked" })]] });
    expect((await admin.from("appointment_series").select("id").eq("client_id", clientId)).data).toEqual([]);
    const { count } = await admin.from("appointments").select("id", { count: "exact", head: true }).eq("client_id", clientId).gte("starts_at", at(FIRST, 0).toISOString()).lt("starts_at", at("2031-10-01", 0).toISOString());
    expect(count).toBe(0);
  });

  it("is front of house only, one client per series", async () => {
    const { results } = await bookSeries(bridget, location, { clientId, notes: null, intervalWeeks: 2, end: { kind: "count", count: 2 }, visits: [{ date: FIRST, lines: lines() }] });
    expect(results).toEqual([{ date: FIRST, ok: false, error: "forbidden" }]);
    const { seriesId } = await book();
    const other = await saveBooking(frontDesk, location, { clientId: otherClient, notes: null, items: [{ serviceId: cut, staffId: SHAE, start: at(FIRST, 15), resource: { kind: "none" } }] });
    const { error } = await frontDesk.rpc("set_appointment_series", { p_appointment_id: other.ok ? other.appointmentId : "", p_series_id: seriesId!, p_index: 9 });
    expect(error?.code).toBe("22023");
  });
});

describe("changing a series", () => {
  it("changes this and following visits, leaving earlier ones", async () => {
    const { seriesId, results } = await book();
    const second = results[1].ok ? results[1].appointmentId : "";
    const changed = await changeSeries(frontDesk, location, second, "following", { clientId, notes: "Shorter layers", lines: lines(BRIDGET, 11 * 60) });
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

  it("moves a service on all visits by the same amount, or none if one doesn't fit", async () => {
    const { seriesId } = await book();
    let visits = await seriesVisits(admin, seriesId!, TZ);
    // Bridget has someone at 12:00 on the last date: nothing moves.
    const other = await saveBooking(frontDesk, location, { clientId: otherClient, notes: null, items: [{ serviceId: cut, staffId: BRIDGET, start: at(DATES[3], 12), resource: { kind: "none" } }] });
    const refused = await moveSeriesItem(frontDesk, location, { itemId: visits[0].items[0].id, staffId: BRIDGET, start: at(FIRST, 11, 30) }, "all");
    expect(refused.map((r) => (r.ok ? "ok" : r.error))).toEqual(["held_back", "held_back", "held_back", "invalid"]);
    visits = await seriesVisits(admin, seriesId!, TZ);
    expect(visits.map((v) => v.items[0].startMinute)).toEqual([600, 600, 600, 600]);
    // With the way clear, they all move.
    await admin.from("appointments").delete().eq("id", other.ok ? other.appointmentId : "");
    const results = await moveSeriesItem(frontDesk, location, { itemId: visits[0].items[0].id, staffId: BRIDGET, start: at(FIRST, 11, 30) }, "all");
    expect(results.every((r) => r.ok)).toBe(true);
    visits = await seriesVisits(admin, seriesId!, TZ);
    expect(visits.map((v) => v.items[0].startMinute)).toEqual([690, 690, 690, 690]);

    // To another stylist for this visit only.
    await moveSeriesItem(frontDesk, location, { itemId: visits[1].items[0].id, staffId: SHAE, start: at(DATES[1], 11, 30) }, "this");
    visits = await seriesVisits(admin, seriesId!, TZ);
    expect(visits.map((v) => v.items[0].staffId)).toEqual([BRIDGET, SHAE, BRIDGET, BRIDGET]);
  });

  it("matches each service by its id on the other visits, keeping their own lengths", async () => {
    // A cut then a blowout every visit; the last visit's cut booked longer.
    const blowout = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single()).data!.id;
    const two = (startMinute: number): VisitLine[] => [
      { serviceId: cut, staffId: BRIDGET, startMinute, resource: "none" },
      { serviceId: blowout, staffId: BRIDGET, startMinute: startMinute + 60, resource: "none" },
    ];
    const { seriesId } = await bookSeries(frontDesk, location, { clientId, notes: null, intervalWeeks: 2, end: { kind: "count", count: 4 }, visits: DATES.map((date) => ({ date, lines: two(9 * 60) })) });
    let visits = await seriesVisits(admin, seriesId!, TZ);
    const lastCut = visits[3].items.find((i) => i.serviceId === cut)!.id;
    await admin.from("appointment_items").update({ active_minutes: 75, ends_at: new Date(at(DATES[3], 10, 15)).toISOString() }).eq("id", lastCut);
    await admin.from("appointment_items").update({ starts_at: at(DATES[3], 10, 15).toISOString(), ends_at: at(DATES[3], 11, 0).toISOString() }).eq("appointment_id", visits[3].appointmentId).eq("service_id", blowout);
    visits = await seriesVisits(admin, seriesId!, TZ);
    const before = await admin.from("appointment_items").select("id, service_id, active_minutes").in("appointment_id", visits.map((v) => v.appointmentId));

    // On the second visit: the blowout first now, then the cut.
    const second = visits[1];
    const [cutItem, blowItem] = [second.items.find((i) => i.serviceId === cut)!, second.items.find((i) => i.serviceId === blowout)!];
    const changed = await changeSeries(frontDesk, location, second.appointmentId, "following", {
      clientId,
      notes: null,
      lines: [
        { serviceId: blowout, staffId: BRIDGET, startMinute: 9 * 60, resource: "none", itemId: blowItem.id },
        { serviceId: cut, staffId: BRIDGET, startMinute: 10 * 60, resource: "none", itemId: cutItem.id },
      ],
    });
    expect(changed.every((r) => r.ok)).toBe(true);

    // Every item is still the service it was, with its own length: the
    // last visit's longer cut kept its 75 minutes.
    const { data: after } = await admin.from("appointment_items").select("id, service_id, active_minutes").in("appointment_id", visits.map((v) => v.appointmentId));
    const byId = (rows: { id: string; service_id: string; active_minutes: number }[]) => Object.fromEntries(rows.map((r) => [r.id, [r.service_id, r.active_minutes]]));
    expect(byId(after!)).toEqual(byId(before.data!));
    visits = await seriesVisits(admin, seriesId!, TZ);
    expect(visits.slice(1).map((v) => v.items.map((i) => i.serviceId))).toEqual([[blowout, cut], [blowout, cut], [blowout, cut]]);
    expect(visits[0].items.map((i) => i.serviceId)).toEqual([cut, blowout]);
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
