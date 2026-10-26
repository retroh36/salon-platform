// How long something takes, the one way the app says it: under an hour
// "45 min", whole hours "2 hr", the rest "3 hr 20 min". Rounded to the
// minute. Used everywhere a duration is shown, Denise's words included
// (worked out here, before her text is written). Plain TypeScript, so it
// runs under plain Node too (lib/insights, lib/scheduling).
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
