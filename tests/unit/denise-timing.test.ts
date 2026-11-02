import { afterEach, describe, expect, it, vi } from "vitest";
import { stepTimer } from "@/lib/denise/timing";

afterEach(() => vi.restoreAllMocks());

describe("Denise's step timings", () => {
  it("logs one line with each step's time, and only the first request on a server is cold", () => {
    const lines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => lines.push(line));
    let t = 1000;
    const first = stepTimer("ask", () => t);
    t += 120;
    first.mark("session");
    t += 3000;
    first.mark("tool:day_schedule");
    t += 400;
    first.log("answered");
    stepTimer("ask", () => t).log("answered");
    expect(lines[0]).toBe('[denise] timing {"action":"ask","outcome":"answered","ms":3520,"cold":true,"steps":[["session",120],["tool:day_schedule",3120]]}');
    expect(JSON.parse(lines[1].replace("[denise] timing ", "")).cold).toBe(false);
  });
});
