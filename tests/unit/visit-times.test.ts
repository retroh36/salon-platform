import { describe, expect, it } from "vitest";
import { actualMinutes, nextEvents, overrunMinutes, sinceMinutes, timerState, type ItemTimes } from "@/lib/visit-times";

const none: ItemTimes = { startedAt: null, processingStartedAt: null, processingEndedAt: null, finishedAt: null };
const at = (hhmm: string) => `2026-11-03T${hhmm}:00Z`;

describe("one-tap service times", () => {
  it("offers the next tap: start, then processing (if any) or finish", () => {
    expect(nextEvents(none, true)).toEqual(["start"]);
    const started = { ...none, startedAt: at("10:00") };
    expect(timerState(started)).toBe("in_chair");
    expect(nextEvents(started, true)).toEqual(["processing", "finish"]);
    expect(nextEvents(started, false)).toEqual(["finish"]);
    const processing = { ...started, processingStartedAt: at("10:45") };
    expect(nextEvents(processing, true)).toEqual(["rinse"]);
    const back = { ...processing, processingEndedAt: at("11:20") };
    expect(timerState(back)).toBe("finishing");
    expect(nextEvents(back, true)).toEqual(["finish"]);
    const done = { ...back, finishedAt: at("11:47") };
    expect(timerState(done)).toBe("done");
    expect(nextEvents(done, true)).toEqual([]);
  });

  it("measures start to finish against what was booked", () => {
    const done = { ...none, startedAt: at("10:00"), finishedAt: at("11:47") };
    expect(actualMinutes(done)).toBe(107);
    expect(overrunMinutes(done, 105)).toBe(2);
    expect(overrunMinutes(done, 120)).toBe(-13);
    expect(actualMinutes({ ...none, startedAt: at("10:00") })).toBeNull();
    expect(sinceMinutes(at("10:00"), new Date(at("10:12")).getTime() + 30_000)).toBe(12);
  });
});
