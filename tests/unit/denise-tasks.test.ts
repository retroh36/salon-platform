// Safe tasks Denise prepares: exactly what would change, before and after.
import { describe, expect, it } from "vitest";
import { changeLine, copyTimesTask, serviceTimeTask, stretched, taskSummary, taskToJson } from "@/lib/denise/tasks";
import type { TimingRow } from "@/lib/stylist-timings";

const hannah = { id: "t-hannah", firstName: "Hannah" };
const blowout: TimingRow = { serviceId: "s-blowout", name: "Blowout", category: "Styling", menu: { active: 45, processing: 0, finishing: 0 }, own: null };
const color: TimingRow = { serviceId: "s-color", name: "All-over Color", category: "Color", menu: { active: 30, processing: 35, finishing: 25 }, own: null };
const cut: TimingRow = { serviceId: "s-cut", name: "Women's Cut", category: "Cut", menu: { active: 60, processing: 0, finishing: 0 }, own: { active: 75, processing: 0, finishing: 0 } };

describe("changing one service's time", () => {
  it("makes it as long as asked, keeping processing", () => {
    expect(stretched({ active: 30, processing: 35, finishing: 25 }, 75)).toEqual({ active: 30, processing: 35, finishing: 10 });
    expect(stretched({ active: 30, processing: 35, finishing: 25 }, 110)).toEqual({ active: 30, processing: 35, finishing: 45 });
    expect(stretched({ active: 45, processing: 0, finishing: 0 }, 30)).toEqual({ active: 30, processing: 0, finishing: 0 });
  });

  it("prepares the change with the time before and after", () => {
    const r = serviceTimeTask(hannah, blowout, 30);
    expect("task" in r && r.task.changes).toEqual([{ serviceId: "s-blowout", service: "Blowout", menu: blowout.menu, before: null, after: { active: 30, processing: 0, finishing: 0 } }]);
    if (!("task" in r)) throw new Error("expected a task");
    expect(changeLine(r.task.changes[0])).toBe("Blowout: 45 min → 30 min");
    expect(taskSummary(r.task).summary).toBe("Hannah's Blowout: 30 min");
    expect(taskToJson(r.task)).toEqual({ kind: "service_times", staff_id: "t-hannah", changes: [{ service_id: "s-blowout", from: null, to: { active: 30, processing: 0, finishing: 0 } }] });
  });

  it("goes back to the menu's when asked for the menu's length", () => {
    const r = serviceTimeTask(hannah, cut, 60);
    if (!("task" in r)) throw new Error("expected a task");
    expect(r.task.changes[0].after).toBeNull();
    expect(changeLine(r.task.changes[0])).toBe("Women's Cut: 1 hr 15 min → 1 hr (the menu's)");
  });

  it("says why it can't", () => {
    expect(serviceTimeTask(hannah, blowout, 45)).toEqual({ problem: "Hannah's Blowout is already 45 min." });
    expect(serviceTimeTask(hannah, blowout, 32)).toEqual({ problem: "Lengths go in steps of 5 minutes." });
    expect(serviceTimeTask(hannah, blowout, 600)).toEqual({ problem: "Give a length from 5 minutes to 8 hours." });
    expect(serviceTimeTask(hannah, color, 30)).toEqual({ problem: "All-over Color has 35 min of processing, so it can't be shorter than 40 min without changing the menu." });
  });
});

describe("copying another stylist's times", () => {
  it("takes their time for every service both do, and leaves the rest", () => {
    const r = copyTimesTask(hannah, [blowout, color, cut], { firstName: "Bridget", times: { "s-blowout": { active: 35, processing: 0, finishing: 0 }, "s-cut": null } });
    if (!("task" in r)) throw new Error("expected a task");
    expect(r.task.changes.map(changeLine)).toEqual(["Blowout: 45 min → 35 min", "Women's Cut: 1 hr 15 min → 1 hr (the menu's)"]);
    expect(taskSummary(r.task, "Bridget")).toEqual({ summary: "Copy Bridget's service times to Hannah", reason: "2 services change for Hannah. New bookings with them use these; visits already booked keep their own." });
  });

  it("says when there's nothing to copy", () => {
    expect(copyTimesTask(hannah, [blowout], { firstName: "Gil", times: { "s-fade": null } })).toEqual({ problem: "Hannah and Gil don't do any of the same services." });
    expect(copyTimesTask(hannah, [blowout], { firstName: "Gil", times: { "s-blowout": null } })).toEqual({ problem: "Hannah's times already match Gil's." });
  });
});
