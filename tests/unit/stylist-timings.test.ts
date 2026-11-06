import { describe, expect, it } from "vitest";
import { copyTimings, ownOrMenu, timingChanges, timingProblem, type TimingRow } from "@/lib/stylist-timings";

const row = (id: string, own: TimingRow["own"] = null): TimingRow => ({ serviceId: id, name: id, category: "Color", menu: { active: 45, processing: 30, finishing: 15 }, own });

describe("a stylist's own times", () => {
  it("follow the same rules as the database", () => {
    expect(timingProblem({ active: 45, processing: 30, finishing: 15 })).toBeNull();
    expect(timingProblem({ active: 0, processing: 0, finishing: 0 })).toBe("Active time is at least 5 minutes.");
    expect(timingProblem({ active: 42, processing: 0, finishing: 0 })).toBe("Use steps of 5 minutes.");
    expect(timingProblem({ active: 30, processing: 0, finishing: 10 })).toBe("Finishing time needs processing time before it.");
    expect(timingProblem({ active: 300, processing: 150, finishing: 35 })).toBe("A service is 8 hours at most.");
  });

  it("keep the menu's time as the menu's", () => {
    expect(ownOrMenu(row("a"), { active: 45, processing: 30, finishing: 15 })).toBeNull();
    expect(ownOrMenu(row("a"), { active: 60, processing: 30, finishing: 15 })).toEqual({ active: 60, processing: 30, finishing: 15 });
  });

  it("copy from another stylist for the services both do, menu times included", () => {
    const rows = [row("cut", { active: 50, processing: 0, finishing: 0 }), row("color"), row("only-mine", { active: 20, processing: 0, finishing: 0 })];
    const { rows: copied, copied: count, kept } = copyTimings(rows, { cut: null, color: { active: 60, processing: 30, finishing: 15 }, perm: { active: 90, processing: 0, finishing: 0 } });
    expect([count, kept]).toEqual([2, 1]);
    expect(copied.map((r) => r.own)).toEqual([null, { active: 60, processing: 30, finishing: 15 }, { active: 20, processing: 0, finishing: 0 }]);
    expect(timingChanges(rows, copied)).toEqual([
      { service_id: "cut", active_minutes: null, processing_minutes: null, finishing_minutes: null },
      { service_id: "color", active_minutes: 60, processing_minutes: 30, finishing_minutes: 15 },
    ]);
  });
});
