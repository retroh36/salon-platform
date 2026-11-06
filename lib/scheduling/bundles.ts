// Service bundles: menu services booked as one, in order, with a gap before
// each part after the first ("Highlight + Gloss + Cut"). Each part is an
// ordinary item on the visit (its own stylist, price and checkout line);
// the gap is free time for the stylist, like processing inside a service.
// The same rules as save_service_bundle (migration …_service_bundles.sql).
//
// Pure; runs under plain Node.

export const MIN_BUNDLE_PARTS = 2;
export const MAX_BUNDLE_PARTS = 6;
export const MAX_GAP_MINUTES = 240;

export type BundlePart = { serviceId: string; gapMinutes: number };
export type Bundle = { id: string; name: string; parts: BundlePart[] };

export type BundleProblem = "name" | "parts" | "gap" | "service";

// Why a bundle can't be saved, or null.
export function bundleProblem(name: string, parts: readonly BundlePart[], onMenu: (serviceId: string) => boolean): BundleProblem | null {
  if (name.trim().length < 1 || name.trim().length > 60) return "name";
  if (parts.length < MIN_BUNDLE_PARTS || parts.length > MAX_BUNDLE_PARTS) return "parts";
  if (parts.some((p, n) => n > 0 && (!Number.isInteger(p.gapMinutes) || p.gapMinutes < 0 || p.gapMinutes > MAX_GAP_MINUTES || p.gapMinutes % 5 !== 0))) return "gap";
  if (parts.some((p) => !onMenu(p.serviceId))) return "service";
  return null;
}

export const BUNDLE_PROBLEM_TEXT: Record<BundleProblem, string> = {
  name: "Give the bundle a name.",
  parts: `A bundle has ${MIN_BUNDLE_PARTS} to ${MAX_BUNDLE_PARTS} services.`,
  gap: `Gaps are 0 to ${MAX_GAP_MINUTES / 60} hours, in 5 minutes.`,
  service: "Choose services on the menu.",
};

// The bundle's parts as lines from `startMinute`: each starts when the one
// before ends plus its gap, with `minutesOf` the length it's booked for
// (the stylist's own, else the menu's).
export function bundleLines(
  bundle: Pick<Bundle, "id" | "parts">,
  startMinute: number,
  staffOf: (part: number) => string,
  minutesOf: (staffId: string, serviceId: string) => number,
): { serviceId: string; staffId: string; startMinute: number; bundleId: string }[] {
  let at = startMinute;
  return bundle.parts.map((p, n) => {
    if (n > 0) at += p.gapMinutes;
    const staffId = staffOf(n);
    const line = { serviceId: p.serviceId, staffId, startMinute: at, bundleId: bundle.id };
    at += minutesOf(staffId, p.serviceId);
    return line;
  });
}

// A bundle's length with each part at `minutesOf`, gaps included.
export function bundleMinutes(parts: readonly BundlePart[], minutesOf: (serviceId: string) => number): number {
  return parts.reduce((sum, p, n) => sum + (n > 0 ? p.gapMinutes : 0) + minutesOf(p.serviceId), 0);
}

// Moving one part of a bundle moves the rest with it, by the same time;
// parts done by the moved part's stylist follow it to its new stylist, the
// others keep theirs. Items outside the bundle stay.
export function moveWithBundle<T extends { id: string; staffId: string; start: Date; bundleId: string | null }>(
  items: readonly T[],
  move: { itemId: string; staffId: string; start: Date },
): { item: T; staffId: string; start: Date; moved: boolean }[] {
  const target = items.find((i) => i.id === move.itemId);
  if (!target) return items.map((item) => ({ item, staffId: item.staffId, start: item.start, moved: false }));
  const shift = move.start.getTime() - target.start.getTime();
  return items.map((item) => {
    if (item.id === target.id) return { item, staffId: move.staffId, start: move.start, moved: true };
    if (!target.bundleId || item.bundleId !== target.bundleId) return { item, staffId: item.staffId, start: item.start, moved: false };
    const staffId = item.staffId === target.staffId ? move.staffId : item.staffId;
    return { item, staffId, start: new Date(item.start.getTime() + shift), moved: shift !== 0 || staffId !== item.staffId };
  });
}
