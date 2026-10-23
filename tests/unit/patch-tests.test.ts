import { describe, expect, it } from "vitest";
import { DEFAULT_PATCH_SETTINGS, patchStatus, patchTestMessage, patchTestState, type PatchTest } from "@/lib/scheduling/patch-tests";

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

describe("the patch test row in booking details' checklist", () => {
  const day = (at: Date) => at.toISOString().slice(0, 10);
  const passed = (iso: string): PatchTest => ({ testedAt: new Date(iso), result: "no_reaction" });

  it("says none is on file, or when the one on file passed", () => {
    expect(patchStatus("missing", [], DEFAULT_PATCH_SETTINGS, day)).toBe("none on file");
    expect(patchStatus("ok", [passed("2026-09-01T10:00:00Z"), passed("2026-10-01T10:00:00Z")], DEFAULT_PATCH_SETTINGS, day)).toBe("passed 2026-10-01");
  });

  it("says when the last one expired", () => {
    const tests = [passed("2026-01-10T10:00:00Z"), passed("2025-06-01T10:00:00Z")];
    expect(patchStatus("expired", tests, DEFAULT_PATCH_SETTINGS, day)).toBe("expired 2026-07-11 (last one 2026-01-10)");
  });

  it("explains one too close to the visit, and a reaction", () => {
    expect(patchStatus("too_recent", [passed("2026-10-22T10:00:00Z")], DEFAULT_PATCH_SETTINGS, day)).toBe("done 2026-10-22, needs 48 hours before the service");
    expect(patchStatus("reaction", [{ testedAt: new Date("2026-10-01T10:00:00Z"), result: "reaction" }], DEFAULT_PATCH_SETTINGS, day)).toBe("showed a reaction on 2026-10-01");
  });
});
