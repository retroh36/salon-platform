// Services built from steps: highlight, processing, gloss, processing, cut,
// booked as one. Each processing step is free time for the stylist (another
// client can be booked into it), but not for the chair.
//
// A step list is kept alongside the three totals every other part of the
// app reads (`ServiceTiming`): the stylist's time before the first
// processing step (active), all processing, and the stylist's time after it
// (finishing). `stepsTiming` works the totals out from the steps; `fitSteps`
// fits a service's steps to an item's own totals (a stylist's own length, a
// booking made longer), the same way as private.fit_steps in the database.
// Pure, plain Node (relative .ts imports).

export type Step = { name: string; minutes: number; processing: boolean };

export const MAX_STEPS = 12;
export const STEP_NAME_MAX = 40;
const MIN_BUSY_STEP = 5;

type Totals = { activeMinutes: number; processingMinutes: number; finishingMinutes: number };

// The totals of a step list.
export function stepsTiming(steps: readonly Step[]): Totals {
  const first = steps.findIndex((s) => s.processing);
  let activeMinutes = 0;
  let processingMinutes = 0;
  let finishingMinutes = 0;
  steps.forEach((s, i) => {
    if (s.processing) processingMinutes += s.minutes;
    else if (first === -1 || i < first) activeMinutes += s.minutes;
    else finishingMinutes += s.minutes;
  });
  return { activeMinutes, processingMinutes, finishingMinutes };
}

// Why a step list can't be saved, or null. The same rules as
// private.steps_problem.
export type StepsProblem = "count" | "name" | "minutes" | "first_or_last" | "processing_twice";
export function stepsProblem(steps: readonly Step[]): StepsProblem | null {
  if (steps.length < 2 || steps.length > MAX_STEPS) return "count";
  for (const s of steps) {
    const name = s.name.trim();
    if (!name || name.length > STEP_NAME_MAX) return "name";
    if (!Number.isInteger(s.minutes) || s.minutes < 5 || s.minutes > 600 || s.minutes % 5 !== 0) return "minutes";
  }
  if (steps[0].processing || steps.at(-1)!.processing) return "first_or_last";
  if (steps.some((s, i) => s.processing && steps[i + 1]?.processing)) return "processing_twice";
  return null;
}

export const STEPS_PROBLEM_TEXT: Record<StepsProblem, string> = {
  count: `A service built from steps has 2 to ${MAX_STEPS} steps.`,
  name: `Give every step a name, up to ${STEP_NAME_MAX} characters.`,
  minutes: "Each step is 5 minutes to 10 hours, in 5-minute steps.",
  first_or_last: "Start and end with the stylist working, not processing.",
  processing_twice: "Put a step with the stylist between two processing steps.",
};

// A service's steps fitted to an item's own totals: the difference in
// active time goes on the last step before the first processing step, in
// processing on the last processing step, in finishing on the last step.
// A step never goes below 5 minutes (processing below 0: then it's dropped);
// when the totals can't be met that way, null (the item keeps the plain
// three parts).
export function fitSteps(steps: readonly Step[] | null | undefined, totals: Totals): Step[] | null {
  if (!steps?.length) return null;
  const have = stepsTiming(steps);
  const out = steps.map((s) => ({ ...s }));
  const firstProcessing = out.findIndex((s) => s.processing);
  const lastProcessing = out.findLastIndex((s) => s.processing);
  const adjust = (i: number, by: number, min: number) => {
    if (by === 0) return true;
    if (i < 0) return false;
    out[i].minutes += by;
    return out[i].minutes >= min;
  };
  const activeAt = firstProcessing === -1 ? out.length - 1 : firstProcessing - 1;
  const finishingAt = firstProcessing === -1 ? -1 : out.length - 1;
  const ok =
    adjust(activeAt, totals.activeMinutes - have.activeMinutes, MIN_BUSY_STEP) &&
    adjust(lastProcessing, totals.processingMinutes - have.processingMinutes, 0) &&
    adjust(finishingAt, totals.finishingMinutes - have.finishingMinutes, MIN_BUSY_STEP);
  if (!ok) return null;
  const fitted = out.filter((s) => !(s.processing && s.minutes === 0));
  // Dropping a processing step can leave two of the stylist's steps side by
  // side, which is fine; the totals still hold.
  const t = stepsTiming(fitted);
  return t.activeMinutes === totals.activeMinutes && t.processingMinutes === totals.processingMinutes && t.finishingMinutes === totals.finishingMinutes ? fitted : null;
}

// Steps from the database (jsonb), checked field by field.
export function parseSteps(value: unknown): Step[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const steps: Step[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") return null;
    const { name, minutes, processing } = v as Record<string, unknown>;
    if (typeof name !== "string" || typeof minutes !== "number" || typeof processing !== "boolean") return null;
    steps.push({ name, minutes, processing });
  }
  return steps;
}
