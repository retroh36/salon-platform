import { describe, expect, it } from "vitest";
import { blackoutsFor, isShortNotice, othersOff, outPanelHref, spansOverlap, visitsByDay, visitsDuring, type BookedVisit, type OtherOff } from "@/lib/time-off-requests";

const day = (startsOn: string, endsOn = startsOn, startMinute: number | null = null, endMinute: number | null = null) => ({ startsOn, endsOn, startMinute, endMinute });

describe("notice and blackouts", () => {
  it("is short notice when it starts inside the notice period", () => {
    expect(isShortNotice("2026-11-10", "2026-10-28", 14)).toBe(true);
    expect(isShortNotice("2026-11-11", "2026-10-28", 14)).toBe(false);
    expect(isShortNotice("2026-10-28", "2026-10-28", 0)).toBe(false);
  });

  it("finds the blackouts a request touches", () => {
    const holidays = { startsOn: "2026-12-18", endsOn: "2026-12-31", label: "Holidays" };
    const prom = { startsOn: "2027-04-24", endsOn: "2027-04-24", label: "Prom" };
    expect(blackoutsFor(day("2026-12-14", "2026-12-18"), [holidays, prom])).toEqual([holidays]);
    expect(blackoutsFor(day("2026-12-14", "2026-12-17"), [holidays, prom])).toEqual([]);
  });
});

describe("what a request would leave", () => {
  const visits: BookedVisit[] = [
    { appointmentId: "b", date: "2026-11-04", start: 840, end: 900, client: "Ava" },
    { appointmentId: "a", date: "2026-11-03", start: 600, end: 660, client: "Mia" },
    { appointmentId: "c", date: "2026-11-03", start: 900, end: 960, client: "Zoe" },
    { appointmentId: "d", date: "2026-11-06", start: 600, end: 660, client: "Lin" },
  ];

  it("lists the clients booked then, by day", () => {
    const during = visitsDuring(day("2026-11-03", "2026-11-04"), visits);
    expect(during.map((v) => v.client)).toEqual(["Mia", "Zoe", "Ava"]);
    expect(visitsByDay(during).map((d) => [d.date, d.visits.length])).toEqual([
      ["2026-11-03", 2],
      ["2026-11-04", 1],
    ]);
  });

  it("only counts visits inside part of a day", () => {
    expect(visitsDuring(day("2026-11-03", "2026-11-03", 840, 1080), visits).map((v) => v.client)).toEqual(["Zoe"]);
  });

  it("names who else is off then, each once, not the person asking", () => {
    const others: OtherOff[] = [
      { staffId: "gil", name: "Gil", status: "approved", ...day("2026-11-01", "2026-11-03") },
      { staffId: "gil", name: "Gil", status: "approved", ...day("2026-11-04") },
      { staffId: "nola", name: "Nola", status: "requested", ...day("2026-11-03", "2026-11-03", 600, 720) },
      { staffId: "lois", name: "Lois", status: "approved", ...day("2026-11-05") },
      { staffId: "shae", name: "Shae", status: "approved", ...day("2026-11-03") },
    ];
    expect(othersOff({ staffId: "shae", ...day("2026-11-03", "2026-11-04") }, others).map((o) => o.name)).toEqual(["Gil", "Nola"]);
    // An afternoon off doesn't clash with someone's morning off.
    expect(spansOverlap(day("2026-11-03", "2026-11-03", 780, 1080), day("2026-11-03", "2026-11-03", 600, 720))).toBe(false);
  });

  it("opens the Mark out panel on the day: all day, or leaving early", () => {
    expect(outPanelHref("shae", "2026-11-03", day("2026-11-03"))).toBe("/calendar?date=2026-11-03&out=shae");
    expect(outPanelHref("shae", "2026-11-03", day("2026-11-03", "2026-11-03", 780, 1440))).toBe("/calendar?date=2026-11-03&out=shae&leaves=13:00");
  });
});
