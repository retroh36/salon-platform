// Which stylists the day calendar shows, and in what order: everyone
// working (or the department or saved view chosen), with those off that
// day hidden behind the "10 off today" chip. Pure, so it's unit-tested;
// the board and the calendar page use it.

import type { ServiceFamily } from "@/lib/calendar";
import { firstLetter } from "@/lib/initial";

// A column's stylist, as far as choosing columns goes.
export type ShownColumn = { staffId: string; working: boolean };

// A saved view: shared with everyone at the location (made by owners) or
// someone's own. `editable`: the viewer may change or delete it.
export type CalendarView = { id: string; name: string; staffIds: string[]; shared: boolean; editable: boolean };

// What the department dropdown holds: everyone, a service department, or
// a saved view.
export type ViewKey = "all" | ServiceFamily | `view:${string}`;

export const viewKey = (id: string): ViewKey => `view:${id}`;

// The last view someone used on this device, kept in a cookie per person.
export const viewCookie = (staffId: string) => `calendar_view_${staffId.replaceAll("-", "")}`;
// Whether Fit all is on (Compact zoom only), the same way.
export const fitCookie = (staffId: string) => `calendar_fit_${staffId.replaceAll("-", "")}`;

export const VIEW_NAME_MAX = 40;

// The columns a view shows, in its order. Everyone and the departments keep
// the salon's order (the columns come sorted); a saved view has its own,
// and skips anyone no longer here.
export function viewColumns<T extends { staffId: string }>(columns: readonly T[], key: ViewKey, views: readonly CalendarView[], inFamily: (c: T, f: ServiceFamily) => boolean): T[] {
  if (key === "all") return [...columns];
  if (key.startsWith("view:")) {
    const view = views.find((v) => viewKey(v.id) === key);
    if (!view) return [...columns];
    const byId = new Map(columns.map((c) => [c.staffId, c]));
    return view.staffIds.flatMap((id) => byId.get(id) ?? []);
  }
  return columns.filter((c) => inFamily(c, key as ServiceFamily));
}

// Who's off: not working that day and nothing booked with them (anyone
// with a booking always shows, so nothing's ever out of sight).
export function offColumns<T extends ShownColumn>(columns: readonly T[], booked: ReadonlySet<string>): T[] {
  return columns.filter((c) => !c.working && !booked.has(c.staffId));
}

// "10 off today", "1 off today", or "3 off" on another day.
export function offLabel(count: number, isToday: boolean): string {
  return `${count} off${isToday ? " today" : ""}`;
}

// Why someone's off, for the list behind the chip: their approved full-day
// time off ("Vacation · Family trip"), the salon being closed, or simply
// not one of their days.
export function offReason(input: { timeOff: string | null; salonOpen: boolean; hasHours: boolean }): string {
  if (input.timeOff) return input.timeOff;
  if (!input.salonOpen) return "Salon closed";
  return input.hasHours ? "Not working" : "Day off";
}

// The list with one item moved, for reordering.
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

// A whole order with some of it reordered: the ids shown (a view or a
// department) take the places they had, in their new order, and everyone
// else stays put. So dragging within "Color" reorders the colorists
// without moving the others.
export function mergeOrder(all: readonly string[], shownBefore: readonly string[], shownAfter: readonly string[]): string[] {
  const shown = new Set(shownBefore);
  let i = 0;
  return all.map((id) => (shown.has(id) ? shownAfter[i++] : id));
}

// Problems with a view before it's saved.
export function viewProblems(name: string, staffIds: readonly string[], otherNames: readonly string[]): { name?: string; staff?: string } {
  const problems: { name?: string; staff?: string } = {};
  const trimmed = name.trim();
  if (!trimmed) problems.name = "Give the view a name.";
  else if (trimmed.length > VIEW_NAME_MAX) problems.name = `Keep it to ${VIEW_NAME_MAX} characters.`;
  else if (otherNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) problems.name = `There's already a view called ${trimmed}.`;
  if (staffIds.length === 0) problems.staff = "Choose at least one stylist.";
  return problems;
}

// A name for a narrow column, longest first: "Bridget Callahan",
// "Bridget C.", "Bridget", then initials ("BC") when Fit all squeezes it.
export function nameVariants(name: string, firstName: string, squeezed: boolean): string[] {
  const parts = name.split(" ").filter(Boolean);
  const last = parts.length > 1 ? parts.at(-1)! : "";
  const variants = [name, last ? `${firstName} ${firstLetter(last)}.` : firstName, firstName];
  if (squeezed) variants.push(parts.slice(0, 3).map(firstLetter).join("").toUpperCase());
  return [...new Set(variants)];
}
