import { describe, expect, it } from "vitest";
import { STATUS_LABELS } from "@/lib/appointments";
import { actualMinutes, EVENT_LABELS, nextEvents, nextStep, overrunMinutes, sinceMinutes, timerState, timerStatus, visitStatusText, type ItemTimes } from "@/lib/visit-times";

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

describe("a visit's one main action and status", () => {
  const TZ = "UTC";
  it("goes Check in, then Check out, for the front of house", () => {
    expect(nextStep("booked", true)).toEqual({ kind: "check_in" });
    expect(nextStep("confirmed", true)).toEqual({ kind: "check_in" });
    // Whatever's been tapped on My day, checked in means Check out next.
    expect(nextStep("checked_in", true)).toEqual({ kind: "check_out" });
    expect(nextStep("completed", true)).toBeNull();
    expect(nextStep("no_show", true)).toBeNull();
    // Stylists' taps are on My day, not here.
    expect(nextStep("booked", false)).toBeNull();
    expect(nextStep("checked_in", false)).toBeNull();
    expect([EVENT_LABELS.start, EVENT_LABELS.finish]).toEqual(["Start service", "Finish service"]);
  });

  it("says where the visit's at in words", () => {
    const text = (status: Parameters<typeof visitStatusText>[0], items: { start: number; times: ItemTimes }[], checkedInAt: string | null = null, checkedOutAt: string | null = null) =>
      visitStatusText(status, STATUS_LABELS, { checkedInAt, checkedOutAt, items }, TZ);
    expect(text("booked", [])).toBe("Booked");
    expect(text("checked_in", [{ start: 600, times: none }], at("09:55"))).toBe("Checked in at 9:55am");
    expect(text("checked_in", [{ start: 600, times: { ...none, startedAt: at("10:52") } }])).toBe("In service since 10:52am");
    expect(text("checked_in", [{ start: 600, times: { ...none, startedAt: at("10:00"), processingStartedAt: at("10:30") } }])).toBe("Processing since 10:30am");
    expect(text("checked_in", [{ start: 600, times: { ...none, startedAt: at("10:00"), finishedAt: at("12:05") } }])).toBe("Finished at 12:05pm");
    expect(text("completed", [], null, at("12:20"))).toBe("Checked out at 12:20pm");
    expect(timerStatus({ ...none, startedAt: at("10:00"), finishedAt: at("11:47") }, 100, TZ)).toBe("Finished at 11:47am · 1 hr 47 min, 7 min over");
  });
});
