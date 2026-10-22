// Patch tests: whether a client's tests cover a service that needs one.
// Pure, used by the booking rules (./book.ts, when the salon makes it a hard
// block) and the screens that warn.
//
// A test counts when it showed no reaction, was done at least `minHours`
// before the service, and no more than `validDays` before it. The most
// recent test before the service showing a reaction means no.

export type PatchTestResult = "no_reaction" | "reaction";
export type PatchTest = { testedAt: Date; result: PatchTestResult };
export type PatchSettings = { validDays: number; minHours: number; enforcement: "warn" | "block" };
export type PatchState = "ok" | "missing" | "expired" | "too_recent" | "reaction";

export const DEFAULT_PATCH_SETTINGS: PatchSettings = { validDays: 182, minHours: 48, enforcement: "warn" };

const HOUR = 3_600_000;

export function patchTestState(tests: readonly PatchTest[], serviceStart: Date, settings: PatchSettings): PatchState {
  const before = tests.filter((t) => t.testedAt <= serviceStart).sort((a, b) => b.testedAt.getTime() - a.testedAt.getTime());
  if (before[0]?.result === "reaction") return "reaction";
  const passes = before.filter((t) => t.result === "no_reaction");
  const age = (t: PatchTest) => (serviceStart.getTime() - t.testedAt.getTime()) / HOUR;
  if (passes.some((t) => age(t) >= settings.minHours && age(t) <= settings.validDays * 24)) return "ok";
  if (passes.some((t) => age(t) < settings.minHours)) return "too_recent";
  if (passes.length) return "expired";
  return "missing";
}

export function patchTestMessage(state: Exclude<PatchState, "ok">, settings: PatchSettings): string {
  switch (state) {
    case "missing":
      return "No patch test on record for this client.";
    case "expired":
      return `Their last patch test is more than ${Math.round(settings.validDays / 30.4)} months before this visit.`;
    case "too_recent":
      return `Their patch test needs to be at least ${settings.minHours} hours before this visit.`;
    case "reaction":
      return "Their last patch test showed a reaction.";
  }
}
