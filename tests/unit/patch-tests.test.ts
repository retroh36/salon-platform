import { describe, expect, it } from "vitest";
import { DEFAULT_PATCH_SETTINGS, patchTestMessage, patchTestState, type PatchTest } from "@/lib/scheduling/patch-tests";

const SERVICE = new Date("2026-11-20T15:00:00Z");
const hoursBefore = (h: number, result: PatchTest["result"] = "no_reaction"): PatchTest => ({ testedAt: new Date(SERVICE.getTime() - h * 3_600_000), result });
const S = DEFAULT_PATCH_SETTINGS;

describe("patch tests", () => {
  it("needs a passed test at least 48 hours and at most six months before", () => {
    expect(patchTestState([], SERVICE, S)).toBe("missing");
    expect(patchTestState([hoursBefore(48)], SERVICE, S)).toBe("ok");
    expect(patchTestState([hoursBefore(24 * 182)], SERVICE, S)).toBe("ok");
    expect(patchTestState([hoursBefore(24 * 183)], SERVICE, S)).toBe("expired");
    expect(patchTestState([hoursBefore(47)], SERVICE, S)).toBe("too_recent");
    // A test after the service doesn't count.
    expect(patchTestState([hoursBefore(-24)], SERVICE, S)).toBe("missing");
  });

  it("any valid test will do, unless the latest showed a reaction", () => {
    expect(patchTestState([hoursBefore(24 * 300), hoursBefore(72)], SERVICE, S)).toBe("ok");
    expect(patchTestState([hoursBefore(24 * 300), hoursBefore(10)], SERVICE, S)).toBe("too_recent");
    expect(patchTestState([hoursBefore(72), hoursBefore(60, "reaction")], SERVICE, S)).toBe("reaction");
    expect(patchTestState([hoursBefore(72, "reaction"), hoursBefore(60)], SERVICE, S)).toBe("ok");
  });

  it("follows the salon's settings", () => {
    const strict = { validDays: 30, minHours: 72, enforcement: "block" as const };
    expect(patchTestState([hoursBefore(60)], SERVICE, strict)).toBe("too_recent");
    expect(patchTestState([hoursBefore(24 * 31)], SERVICE, strict)).toBe("expired");
    expect(patchTestMessage("too_recent", strict)).toBe("Their patch test needs to be at least 72 hours before this visit.");
    expect(patchTestMessage("expired", S)).toBe("Their last patch test is more than 6 months before this visit.");
  });
});
