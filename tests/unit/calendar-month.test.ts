import { describe, expect, it } from "vitest";
import { fullnessTone, monthDays, monthLabel, monthWeeks, parseMonth, shiftMonth } from "@/lib/calendar-month";
import { fromLocal, parseTime, type BookingContext } from "@/lib/scheduling";

const TZ = "America/Chicago";
const m = (time: string) => parseTime(time)!;

describe("the month", () => {
  it("reads ?month= or a date in it, else today's month", () => {
    expect(parseMonth("2026-12", "2026-11-05")).toBe("2026-12");
    expect(parseMonth("2026-12-24", "2026-11-05")).toBe("2026-12");
    expect(parseMonth("2026-13", "2026-11-05")).toBe("2026-11");
    expect(parseMonth(undefined, "2026-11-05")).toBe("2026-11");
  });

  it("moves across years and is named in full", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthLabel("2026-11")).toBe("November 2026");
  });

  it("is whole weeks, Monday to Sunday", () => {
    // November 2026 starts on a Sunday and ends on a Monday: six weeks.
    const weeks = monthWeeks("2026-11");
    expect(weeks).toHaveLength(6);
    expect(weeks[0][0]).toBe("2026-10-26");
    expect(weeks[0][6]).toBe("2026-11-01");
    expect(weeks.at(-1)![0]).toBe("2026-11-30");
    // February 2027 starts on a Monday and ends on a Sunday: exactly four.
    expect(monthWeeks("2027-02")).toHaveLength(4);
  });
});

describe("each day at a glance", () => {
  // Open Tuesday to Saturday. Priya works Tuesdays and Wednesdays, Ethan
  // only Tuesdays, and Priya is off on Wednesday the 11th.
  const ctx: BookingContext = {
    location: { timeZone: TZ, weekly: Object.fromEntries([2, 3, 4, 5, 6].map((d) => [d, [{ start: m("9:00"), end: m("17:00") }]])) },
    services: new Map([["cut", { id: "cut", activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0, archived: false }]]),
    staff: new Map([
      ["priya", { id: "priya", isActive: true, schedule: { weekly: { 2: [{ start: m("9:00"), end: m("17:00") }], 3: [{ start: m("9:00"), end: m("17:00") }] }, overrides: {}, timeOff: [{ startsOn: "2026-11-11", endsOn: "2026-11-11", status: "approved" }] }, serviceIds: new Set(["cut"]) }],
      ["ethan", { id: "ethan", isActive: true, schedule: { weekly: { 2: [{ start: m("9:00"), end: m("17:00") }] }, overrides: {}, timeOff: [] }, serviceIds: new Set(["cut"]) }],
    ]),
    resources: new Map(),
    // Four hours of Priya's Tuesday the 10th.
    booked: [0, 1, 2, 3].map((h) => ({ id: `i${h}`, appointmentId: `a${h}`, serviceId: "cut", staffId: "priya", resourceId: null, start: fromLocal("2026-11-10", m("9:00") + h * 60, TZ)!, activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0 })),
  };
  const days = monthDays("2026-11", ctx, ["priya", "ethan"], new Map([["2026-11-10", 4]]), [{ id: "e1", date: "2026-11-14", label: "Mia's wedding" }]).flat();
  const day = (date: string) => days.find((d) => d.date === date)!;

  it("counts visits and how full the stylists are", () => {
    // 4 of 16 working hours.
    expect(day("2026-11-10")).toMatchObject({ visits: 4, percent: 25, off: 0, closed: false, inMonth: true });
    expect(fullnessTone(25)).toBe("quiet");
    expect(fullnessTone(60)).toBe("busy");
    expect(fullnessTone(90)).toBe("full");
  });

  it("counts who's off on open days, and shows closed days as closed", () => {
    // Wednesday the 11th: Priya's time off, and Ethan doesn't work Wednesdays.
    expect(day("2026-11-11")).toMatchObject({ off: 2, percent: null });
    expect(day("2026-11-12")).toMatchObject({ off: 2 });
    expect(day("2026-11-15")).toMatchObject({ closed: true, off: 0, percent: null });
    expect(day("2026-10-27").inMonth).toBe(false);
  });

  it("puts events on their day", () => {
    expect(day("2026-11-14").events.map((e) => e.label)).toEqual(["Mia's wedding"]);
  });
});
