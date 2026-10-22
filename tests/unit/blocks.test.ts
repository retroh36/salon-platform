import { describe, expect, it } from "vitest";
import { blockClashes, occurrences, occurrenceSpan, parseBlockInput, type TimeBlock } from "@/lib/scheduling/blocks";
import { fromLocal, parseTime, type BookedItem, type BookingContext } from "@/lib/scheduling";

const TZ = "America/Chicago";
const at = (date: string, time: string) => fromLocal(date, parseTime(time)!, TZ)!;

const block = (o: Partial<TimeBlock> = {}): TimeBlock => ({
  id: "b",
  staffId: "priya",
  kind: "lunch",
  note: null,
  startMinute: 720,
  endMinute: 750,
  onDate: null,
  weekdays: [1, 2, 3, 4, 5],
  startsOn: "2026-10-19",
  endsOn: null,
  skips: [],
  ...o,
});

describe("block occurrences", () => {
  it("repeats on its weekdays from its first day, skipping days taken out", () => {
    const days = occurrences(block({ skips: ["2026-10-21"] }), "2026-10-17", "2026-10-27").map((o) => o.date);
    expect(days).toEqual(["2026-10-19", "2026-10-20", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27"]);
  });

  it("stops at its last day, and a one-off is just its day", () => {
    expect(occurrences(block({ endsOn: "2026-10-20" }), "2026-10-01", "2026-12-01").map((o) => o.date)).toEqual(["2026-10-19", "2026-10-20"]);
    const once = block({ onDate: "2026-10-22", weekdays: null, startsOn: null });
    expect(occurrences(once, "2026-10-20", "2026-10-25")).toEqual([
      { blockId: "b", staffId: "priya", kind: "lunch", note: null, date: "2026-10-22", start: 720, end: 750, repeating: false },
    ]);
    expect(occurrences(once, "2026-10-23", "2026-10-25")).toEqual([]);
  });

  it("is wall-clock time, across a daylight saving change", () => {
    const [before, after] = ["2026-10-30", "2026-11-02"].map((d) => occurrenceSpan({ ...occurrences(block(), d, d)[0] }, TZ)!);
    expect(before.start).toEqual(at("2026-10-30", "12:00"));
    expect(after.start).toEqual(at("2026-11-02", "12:00"));
    expect(after.start.getTime() - before.start.getTime()).toBe((3 * 24 + 1) * 3600_000);
  });
});

describe("blocking time", () => {
  const raw = { staffId: "priya", kind: "lunch", note: " ", start: "12:00", end: "12:30", date: "2026-10-21", repeat: true, weekdays: [5, 1, 3, 1], until: "" };

  it("reads the form", () => {
    expect(parseBlockInput(raw)).toEqual({
      ok: true,
      value: { staffId: "priya", kind: "lunch", note: null, startMinute: 720, endMinute: 750, date: "2026-10-21", weekdays: [1, 3, 5], until: null },
    });
    expect(parseBlockInput({ ...raw, repeat: false }).ok && parseBlockInput({ ...raw, repeat: false })).toMatchObject({ value: { weekdays: null } });
  });

  it("checks the times, days and type", () => {
    expect(parseBlockInput({ ...raw, end: "11:00" })).toEqual({ ok: false, errors: { times: "The end is after the start." } });
    expect(parseBlockInput({ ...raw, start: "12:02" })).toMatchObject({ ok: false, errors: { times: expect.any(String) } });
    expect(parseBlockInput({ ...raw, weekdays: [] })).toEqual({ ok: false, errors: { weekdays: "Choose the days it repeats." } });
    expect(parseBlockInput({ ...raw, until: "2026-10-01" })).toEqual({ ok: false, errors: { until: "The last day is on or after the first." } });
    expect(parseBlockInput({ ...raw, kind: "nap" })).toMatchObject({ ok: false, errors: { kind: expect.any(String) } });
  });

  it("finds days it would land on a client's busy time or another block, not processing", () => {
    const cut: BookedItem = { id: "c", serviceId: "cut", staffId: "priya", start: at("2026-10-20", "11:30"), activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0 };
    const color: BookedItem = { id: "k", serviceId: "color", staffId: "priya", start: at("2026-10-22", "11:15"), activeMinutes: 45, processingMinutes: 35, finishingMinutes: 25 };
    const ctx = {
      location: { timeZone: TZ, weekly: {} },
      services: new Map(),
      staff: new Map(),
      resources: new Map(),
      booked: [cut, color],
      blocks: [{ blockId: "m", date: "2026-10-23", staffId: "priya", kind: "meeting" as const, start: at("2026-10-23", "12:15"), end: at("2026-10-23", "13:00") }],
    } as BookingContext;
    expect(blockClashes(occurrences(block(), "2026-10-19", "2026-10-23"), ctx)).toEqual([
      { date: "2026-10-20", with: "client" },
      { date: "2026-10-23", with: "meeting" },
    ]);
  });
});
