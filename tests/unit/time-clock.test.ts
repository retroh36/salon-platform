import { describe, expect, it } from "vitest";
import { fromLocal } from "@/lib/scheduling/time";
import { clockDays, clockReminders, clockStatus, differenceText, entryMinutes, reminderText, type ClockEntry } from "@/lib/time-clock";

const TZ = "America/Chicago";
const DAY = "2026-11-03";
const at = (minute: number, date = DAY) => fromLocal(date, minute, TZ)!;
const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const entry = (id: string, staffId: string, from: Date, to: Date | null, more: Partial<ClockEntry> = {}): ClockEntry => ({ id, staffId, clockIn: from, clockOut: to, edited: false, ...more });

describe("where someone stands", () => {
  it("is clocked in from the open punch, with today's minutes counted to now", () => {
    const entries = [entry("a", "gil", at(h(9)), at(h(12))), entry("b", "gil", at(h(13)), null)];
    expect(clockStatus(entries, TZ, at(h(14)))).toEqual({ clockedIn: true, since: at(h(13)), todayMinutes: 240 });
  });

  it("isn't clocked in on a missed clock-out, which counts no minutes", () => {
    const missed = entry("a", "gil", at(h(9), "2026-11-02"), null, { missedOut: true });
    expect(clockStatus([missed], TZ, at(h(10))).clockedIn).toBe(false);
    expect(entryMinutes(missed, at(h(10)))).toBe(0);
  });
});

describe("reminders", () => {
  const people = [
    { staffId: "gil", shifts: [{ start: h(9), end: h(17) }] },
    { staffId: "nola", shifts: [{ start: h(9), end: h(13) }, { start: h(14), end: h(18) }] },
  ];

  it("reminds to clock in 10 minutes into a shift, not before, and not once they have", () => {
    expect(clockReminders(people, [], TZ, at(h(9, 9)))).toEqual([]);
    expect(clockReminders(people, [], TZ, at(h(9, 10))).map((r) => [r.staffId, r.kind])).toEqual([
      ["gil", "in"],
      ["nola", "in"],
    ]);
    // A clock-in up to an hour early counts for the shift.
    expect(clockReminders(people, [entry("a", "gil", at(h(8, 15)), null)], TZ, at(h(9, 30))).map((r) => r.staffId)).toEqual(["nola"]);
  });

  it("reminds to clock out 10 minutes after a shift ends, and not while the next shift is on", () => {
    const morning = [entry("a", "nola", at(h(8, 58)), null)];
    expect(clockReminders(people.slice(1), morning, TZ, at(h(13, 5)))).toEqual([]);
    expect(clockReminders(people.slice(1), morning, TZ, at(h(13, 10)))).toEqual([{ staffId: "nola", kind: "out", shiftStart: h(9), shiftEnd: h(13) }]);
    // Still in at 2:30 from the morning: that's the afternoon shift now.
    expect(clockReminders(people.slice(1), morning, TZ, at(h(14, 30)))).toEqual([]);
    // Three hours after the day's end, no more reminders.
    expect(clockReminders(people.slice(1), [entry("a", "nola", at(h(14)), null)], TZ, at(h(21, 1)))).toEqual([]);
  });

  it("says so in fixed words", () => {
    expect(reminderText({ kind: "in", shiftStart: h(9), shiftEnd: h(17) }, (m) => `${m / 60}h`)).toBe("Your shift started at 9h and you haven't clocked in. Clock in on My day or at the front desk.");
  });
});

describe("scheduled against clocked", () => {
  it("adds up each day and flags a missed clock-out and a day with no punch", () => {
    const entries = [entry("a", "gil", at(h(9), "2026-11-02"), at(h(17, 30), "2026-11-02")), entry("b", "gil", at(h(9), DAY), null, { missedOut: true }), entry("c", "nola", at(h(9), DAY), at(h(10), DAY))];
    const days = clockDays(
      "gil",
      [
        { date: "2026-11-02", minutes: 480 },
        { date: DAY, minutes: 480 },
        { date: "2026-11-04", minutes: 480 },
        { date: "2026-11-05", minutes: 480 },
      ],
      entries,
      TZ,
      at(h(12), "2026-11-05"),
    );
    expect(days.map((d) => [d.date, d.worked, d.missedOut, d.noPunch])).toEqual([
      ["2026-11-02", 510, false, false],
      [DAY, 0, true, false],
      ["2026-11-04", 0, false, true],
      // Today isn't over: no flag yet.
      ["2026-11-05", 0, false, false],
    ]);
  });

  it("words the difference", () => {
    expect(differenceText(483, 480)).toBe("On schedule");
    expect(differenceText(555, 480)).toBe("+1 hr 15 min");
    expect(differenceText(450, 480)).toBe("−30 min");
  });
});
