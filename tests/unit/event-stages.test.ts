import { describe, expect, it } from "vitest";
import { boardStage, stagesProblem, type EventStage } from "@/lib/events/stages";

const stages: EventStage[] = [
  { id: "1", name: "New", kind: "inquiry" },
  { id: "c", name: "Waiting on venue", kind: null },
  { id: "2", name: "Proposal sent", kind: "proposal_sent" },
  { id: "3", name: "Booked", kind: "booked" },
  { id: "4", name: "Trial done", kind: "trial_done" },
  { id: "5", name: "Event day", kind: "event_day" },
  { id: "6", name: "Completed", kind: "completed" },
];

describe("event stages", () => {
  it("puts an event where its status says, under the salon's name", () => {
    expect(boardStage({ status: "inquiry", date: "2026-12-01", stageId: null }, stages, "2026-11-01")?.name).toBe("New");
  });
  it("keeps an event in the salon's own stage until its day", () => {
    expect(boardStage({ status: "booked", date: "2026-12-01", stageId: "c" }, stages, "2026-11-01")?.id).toBe("c");
    expect(boardStage({ status: "booked", date: "2026-11-01", stageId: "c" }, stages, "2026-11-01")?.kind).toBe("event_day");
  });
  it("leaves lost events off the board, and ignores a removed or built-in stage", () => {
    expect(boardStage({ status: "lost", date: "2026-12-01", stageId: null }, stages, "2026-11-01")).toBeNull();
    expect(boardStage({ status: "booked", date: "2026-12-01", stageId: "gone" }, stages, "2026-11-01")?.kind).toBe("booked");
    expect(boardStage({ status: "booked", date: "2026-12-01", stageId: "1" }, stages, "2026-11-01")?.kind).toBe("booked");
  });
  it("checks the list", () => {
    expect(stagesProblem(stages)).toBeNull();
    expect(stagesProblem(stages.filter((s) => s.kind !== "booked"))).toMatch(/built-in/);
    expect(stagesProblem([...stages, { id: "d", name: " new ", kind: null }])).toMatch(/same name/);
    expect(stagesProblem([...stages, { id: "d", name: " ", kind: null }])).toMatch(/name/);
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, name: `Own ${i}`, kind: null }));
    expect(stagesProblem([...stages, ...many])).toMatch(/Up to 12/);
  });
});
