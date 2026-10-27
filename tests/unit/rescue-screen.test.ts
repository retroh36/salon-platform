// The sick-day rescue screen's rows, wording and clash check, and Denise
// reading "Nola called out" (our code, no Claude).
import { describe, expect, it } from "vitest";
import { minuteOf, readCallOut } from "@/lib/denise/call-out";
import { clashingRows, coverNotice, messageFor, movesOf, rescueRows, type RescueFacts } from "@/lib/rescue";
import { fromLocal, parseTime, timingFor, type BookingContext } from "@/lib/scheduling";
import { planRescue, type RescueVisit } from "@/lib/scheduling/rescue";

const TZ = "America/Chicago";
const TUE = "2026-10-27";
const at = (time: string, day = TUE) => fromLocal(day, parseTime(time)!, TZ)!;
const CUT = { id: "cut", activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0, archived: false };
const week = { 2: [{ start: 540, end: 1020 }], 3: [{ start: 540, end: 1020 }] };
const person = (id: string, off = false) => ({
  id,
  isActive: true,
  schedule: { weekly: week, overrides: {}, timeOff: off ? [{ startsOn: TUE, endsOn: TUE, status: "approved" as const }] : [] },
  serviceIds: new Set(["cut"]),
});
const item = (staffId: string, time: string, appointmentId: string, resourceId: string) => ({
  id: `i-${appointmentId}`,
  appointmentId,
  serviceId: "cut",
  staffId,
  resourceId,
  start: at(time),
  activeMinutes: 60,
  processingMinutes: 0,
  finishingMinutes: 0,
});
const visit = (id: string, time: string, chair: string): RescueVisit => ({ appointmentId: id, clientId: `c-${id}`, movable: true, items: [item("nola", time, id, chair)], preferredStaffId: null, onlySees: false });

function setup(visits: RescueVisit[]) {
  const ctx: BookingContext = {
    location: { timeZone: TZ, weekly: week },
    services: new Map([["cut", CUT]]),
    staff: new Map([
      ["nola", person("nola", true)],
      ["lois", person("lois")],
      ["gil", person("gil")],
    ]),
    resources: new Map(["c1", "c2", "c3"].map((id, i) => [id, { id, isActive: true, kind: "chair" as const, sortOrder: i }])),
    booked: visits.flatMap((v) => v.items),
    blocks: [],
  };
  const lines = planRescue(ctx, {
    staffId: "nola",
    date: TUE,
    from: at("0:00"),
    visits,
    stylists: [
      { id: "nola", firstName: "Nola", level: "senior" },
      { id: "lois", firstName: "Lois", level: "senior" },
      { id: "gil", firstName: "Gil", level: "master" },
    ],
    timingOf: (s, v) => timingFor(ctx, s, v),
    now: at("7:00"),
    days: 3,
  });
  const facts: RescueFacts = {
    tz: TZ,
    date: TUE,
    absentName: "Nola",
    names: new Map([
      ["nola", "Nola"],
      ["lois", "Lois"],
      ["gil", "Gil"],
    ]),
    levels: new Map([
      ["nola", "senior"],
      ["lois", "senior"],
      ["gil", "master"],
    ]),
    services: new Map([["cut", "Women's Cut"]]),
    priceOf: (s) => (s === "gil" ? 9000 : 7000),
  };
  const clients = new Map(visits.map((v) => [v.clientId!, { name: `Client ${v.appointmentId}`, firstName: `Client` }]));
  return rescueRows(lines, facts, "nola", clients);
}

describe("the rows staff review", () => {
  it("say where each client goes, what changes, and always offer to leave it", () => {
    const rows = setup([visit("a", "10:00", "c1")]);
    expect(rows[0]).toMatchObject({ clientName: "Client a", services: "Women's Cut", when: "10am–11am", start: "10am", length: "1 hr" });
    expect(rows[0].choices[0]).toMatchObject({ kind: "cover", label: "Moves to Lois, same time", detail: "Same level · Lois is free" });
    expect(rows[0].choices[1]).toMatchObject({ kind: "cover", label: "Moves to Gil, same time", detail: "Master · $20 more" });
    // Her own next opening first, then the same level's.
    const later = rows[0].choices.filter((c) => c.kind === "reschedule");
    expect(later[0]).toMatchObject({ label: "Reschedule with Nola", detail: "Next opening Wed, Oct 28 at 10am" });
    expect(rows[0].choices.at(-1)).toMatchObject({ kind: "leave", label: "Leave it and call the client", moves: [] });
  });

  it("catch two lines given the same stylist at the same time", () => {
    const rows = setup([visit("a", "10:00", "c1"), visit("b", "10:00", "c2")]);
    // Planned: a with Lois, b with Gil.
    expect(rows.map((r) => r.choices[r.choice].label)).toEqual(["Moves to Lois, same time", "Moves to Gil, same time"]);
    expect(clashingRows(rows, rows.map((r) => r.choice))).toEqual([]);
    // Staff put a on Gil too.
    const gil = rows[0].choices.findIndex((c) => c.label === "Moves to Gil, same time");
    expect(clashingRows(rows, [gil, rows[1].choice])).toEqual([1]);
    // Leaving a frees Lois for b.
    const leave = rows[0].choices.length - 1;
    const lois = rows[1].choices.findIndex((c) => c.label.startsWith("Moves to Lois"));
    expect(clashingRows(rows, [leave, lois])).toEqual([]);
    expect(movesOf(rows, [leave, lois]).map((m) => [m.appointmentId, m.staffId])).toEqual([["b", "lois"]]);
  });

  it("pick each client's message from what happened to their visit", () => {
    expect(messageFor("cover")).toBe("stylist_out_covered");
    expect(messageFor("shift")).toBe("stylist_out_moved");
    expect(messageFor("reschedule")).toBe("stylist_out_moved");
    expect(messageFor("leave")).toBe("need_to_move");
  });

  it("tell the covering stylist, and say so again on undo", () => {
    const facts = { tz: TZ, date: TUE, absentName: "Nola", names: new Map(), levels: new Map(), services: new Map(), priceOf: () => null };
    expect(coverNotice(facts, { staffId: "lois", start: at("10:00") }, "Ava", "Women's Cut", TUE)).toEqual({
      body: "Nola is out. You have Ava's Women's Cut today at 10am.",
      undo: "Ava's Women's Cut today at 10am is back with Nola.",
    });
  });
});

const TEAM = [
  { id: "nola", firstName: "Nola" },
  { id: "gil", firstName: "Gil" },
  { id: "lois", firstName: "Lois" },
];

describe("Denise reading that someone's out", () => {
  it.each([
    ["Nola called out", { staffId: "nola", from: null }],
    ["nola called in sick today", { staffId: "nola", from: null }],
    ["Lois is out sick", { staffId: "lois", from: null }],
    ["Gil has to leave at 1", { staffId: "gil", from: 13 * 60 }],
    ["gil needs to go home at 2:30pm", { staffId: "gil", from: 14 * 60 + 30 }],
    ["Lois is leaving at noon", { staffId: "lois", from: 12 * 60 }],
  ])("%s", (text, expected) => {
    expect(readCallOut(text, TEAM)).toMatchObject(expected);
  });

  it("leaves everything else to her", () => {
    expect(readCallOut("Who's free for a cut with Nola at 3?", TEAM)).toBeNull();
    expect(readCallOut("Gil and Nola called out", TEAM)).toBeNull();
    expect(readCallOut("Is anyone out today?", TEAM)).toBeNull();
  });

  it("reads times the salon's way", () => {
    expect(minuteOf("1")).toBe(13 * 60);
    expect(minuteOf("11")).toBe(11 * 60);
    expect(minuteOf("10am")).toBe(10 * 60);
    expect(minuteOf("13:15")).toBe(13 * 60 + 15);
    expect(minuteOf("noon")).toBe(12 * 60);
    expect(minuteOf("25")).toBeNull();
  });
});
