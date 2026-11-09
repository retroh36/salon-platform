import { describe, expect, it } from "vitest";
import { automationProblem, renderEventMessage, whenText, type EventAutomation } from "@/lib/events/automations";

const base: EventAutomation = { id: "", name: "Follow up", trigger: "inquiry_received", daysBefore: null, waitDays: 2, action: "task", subject: null, body: null, task: "Call them", stageId: null, enabled: true, approved: false };

describe("event automations", () => {
  it("fill in the salon's message from our facts, leaving unknown fields", () => {
    expect(renderEventMessage("Hi {first_name}, {salon} here about {event} on {event_date}. {x}", { first_name: "Mia", salon: "Maple & Ash", event: "Mia's wedding", event_date: "Saturday, June 6" })).toBe(
      "Hi Mia, Maple & Ash here about Mia's wedding on Saturday, June 6. {x}",
    );
  });
  it("say when they happen", () => {
    expect(whenText(base)).toBe("2 days after an inquiry comes in");
    expect(whenText({ ...base, waitDays: 0, trigger: "deposit_paid" })).toBe("When the deposit is paid");
    expect(whenText({ ...base, trigger: "days_before", daysBefore: 30 })).toBe("30 days before the event");
  });
  it("check what's needed", () => {
    expect(automationProblem(base)).toBeNull();
    expect(automationProblem({ ...base, task: " " })).toMatch(/to-do/);
    expect(automationProblem({ ...base, action: "message", body: "Hi {nickname}" })).toMatch(/nickname/);
    expect(automationProblem({ ...base, action: "move_stage" })).toMatch(/stage/);
    expect(automationProblem({ ...base, trigger: "days_before", daysBefore: 0 })).toMatch(/days before/);
    expect(automationProblem({ ...base, waitDays: 61 })).toMatch(/60/);
  });
});
