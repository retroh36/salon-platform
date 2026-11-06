// A stylist's own times for the services they do (Team → Service times):
// checking a time, copying another stylist's, and what's changed to save.
// Pure; the database checks the same rules (staff_services' constraints).

export type Timing = { active: number; processing: number; finishing: number };

// own: their own time, or null for the menu's.
export type TimingRow = { serviceId: string; name: string; category: string; menu: Timing; own: Timing | null };

export const totalOf = (t: Timing) => t.active + t.processing + t.finishing;

export const sameTiming = (a: Timing | null, b: Timing | null) =>
  a === b || (a !== null && b !== null && a.active === b.active && a.processing === b.processing && a.finishing === b.finishing);

// What's wrong with a time, in the words the page shows, or null.
export function timingProblem(t: Timing): string | null {
  const parts = [t.active, t.processing, t.finishing];
  if (parts.some((n) => !Number.isInteger(n) || n < 0)) return "Enter whole minutes.";
  if (parts.some((n) => n % 5 !== 0)) return "Use steps of 5 minutes.";
  if (t.active < 5) return "Active time is at least 5 minutes.";
  if (t.finishing > 0 && t.processing === 0) return "Finishing time needs processing time before it.";
  if (totalOf(t) > 480) return "A service is 8 hours at most.";
  return null;
}

// A time the same as the menu's is kept as the menu's (null), so a later
// change to the menu reaches them.
export const ownOrMenu = (row: Pick<TimingRow, "menu">, t: Timing | null) => (t && !sameTiming(t, row.menu) ? t : null);

// Copies another stylist's times onto these rows: for every service both
// do, the source's time (their own, or the menu's). Services only this
// stylist does stay as they are.
export function copyTimings(rows: TimingRow[], source: Record<string, Timing | null>): { rows: TimingRow[]; copied: number; kept: number } {
  let copied = 0;
  const next = rows.map((r) => {
    if (!(r.serviceId in source)) return r;
    copied += 1;
    return { ...r, own: ownOrMenu(r, source[r.serviceId]) };
  });
  return { rows: next, copied, kept: rows.length - copied };
}

// What to save: each row whose time changed, null for back to the menu's.
export function timingChanges(before: TimingRow[], after: TimingRow[]) {
  const was = new Map(before.map((r) => [r.serviceId, r.own]));
  return after
    .filter((r) => !sameTiming(was.get(r.serviceId) ?? null, ownOrMenu(r, r.own)))
    .map((r) => {
      const own = ownOrMenu(r, r.own);
      return {
        service_id: r.serviceId,
        active_minutes: own?.active ?? null,
        processing_minutes: own?.processing ?? null,
        finishing_minutes: own?.finishing ?? null,
      };
    });
}

