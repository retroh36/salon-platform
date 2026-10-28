// The team schedule (Scheduling → Team schedule), pure and unit-tested: a
// week of everyone's shifts as published, with the manager's draft on top,
// the hours scheduled and booked each day, Copy last week and Clear week,
// the clients a change would leave outside someone's hours, and dragging a
// shift. Loading is in ./team-schedule-load.ts, saving in
// app/scheduling/actions.ts (save_schedule_drafts, publish_schedule_week).

import { formatIntervals } from "./schedule-format.ts";
import { containsSpan, mergeIntervals, subtractIntervals, type Interval } from "./scheduling/intervals.ts";
import { MINUTES_PER_DAY, type LocalDate } from "./scheduling/time.ts";
import type { StaffRole } from "./staff.ts";

export type Shift = Interval;

// The groups down the side, in order. Owners and managers show only when
// they have hours that week.
export const ROLE_GROUPS: { key: string; label: string; roles: StaffRole[]; always: boolean }[] = [
  { key: "stylists", label: "Stylists", roles: ["stylist"], always: true },
  { key: "assistants", label: "Assistants", roles: ["assistant"], always: true },
  { key: "front_desk", label: "Front desk", roles: ["front_desk"], always: true },
  { key: "management", label: "Owners and managers", roles: ["owner", "manager"], always: false },
];

// A client's time with this person that day (their busy parts: processing
// time is free), in minutes from midnight.
export type BookedSpan = { appointmentId: string; client: string; start: number; end: number };

// One person on one day.
export type Cell = {
  staffId: string;
  date: LocalDate;
  // As published (what the calendar and online booking use).
  live: Shift[];
  // The draft day, when it differs from what's published.
  draft: Shift[] | null;
  // Approved time off that day ([] for none).
  timeOff: Interval[];
  // Their clients that day.
  booked: BookedSpan[];
};

export const cellKey = (staffId: string, date: LocalDate) => `${staffId}|${date}`;

// What the grid shows: the draft if there is one.
export const shown = (cell: Pick<Cell, "live" | "draft">): Shift[] => cell.draft ?? cell.live;

export const minutesIn = (shifts: readonly Interval[]) => shifts.reduce((n, s) => n + s.end - s.start, 0);

export const sameShifts = (a: readonly Shift[], b: readonly Shift[]) =>
  a.length === b.length && a.every((s, i) => s.start === b[i].start && s.end === b[i].end);

// Why a day's shifts can't be saved (the same rules as
// private.clean_shifts), or null.
export function shiftProblem(shifts: readonly Shift[]): string | null {
  if (shifts.length > 4) return "A day has up to 4 shifts.";
  const sorted = [...shifts].sort((a, b) => a.start - b.start);
  let prev = -1;
  for (const s of sorted) {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end > MINUTES_PER_DAY || s.start % 5 || s.end % 5) {
      return "Times are on 5-minute steps.";
    }
    if (s.start >= s.end) return "Each shift ends after it starts.";
    if (s.start <= prev) return "Shifts on one day can't overlap or touch.";
    prev = s.end;
  }
  return null;
}

// Earliest first.
export const sortShifts = (shifts: readonly Shift[]) => [...shifts].sort((a, b) => a.start - b.start);

// Minutes scheduled: their shifts less approved time off.
export function scheduledMinutes(cell: Cell): number {
  return minutesIn(subtractIntervals(mergeIntervals(shown(cell)), cell.timeOff));
}

// Minutes booked with clients.
export function bookedMinutes(cell: Pick<Cell, "booked">): number {
  return minutesIn(mergeIntervals(cell.booked.map((b) => ({ start: b.start, end: b.end }))));
}

// A day's totals across the team.
export function dayTotals(cells: readonly Cell[]): { scheduled: number; booked: number } {
  return cells.reduce((t, c) => ({ scheduled: t.scheduled + scheduledMinutes(c), booked: t.booked + bookedMinutes(c) }), { scheduled: 0, booked: 0 });
}

// Clients booked outside these shifts (or in approved time off).
export function outside(cell: Pick<Cell, "booked" | "timeOff">, shifts: readonly Shift[]): BookedSpan[] {
  const working = subtractIntervals(mergeIntervals(shifts), cell.timeOff);
  return cell.booked.filter((b) => !containsSpan(working, b.start, b.end));
}

// A day to save to the draft.
export type DayEdit = { staffId: string; date: LocalDate; shifts: Shift[] };

// Copy last week: each of this week's days set to the same weekday last
// week, as shown (draft included); only the days that change.
export function copyWeek(lastWeek: readonly Cell[], thisWeek: readonly Cell[], dates: { from: LocalDate; to: LocalDate }[]): DayEdit[] {
  const last = new Map(lastWeek.map((c) => [cellKey(c.staffId, c.date), c]));
  const toDate = new Map(dates.map((d) => [d.from, d.to]));
  const edits: DayEdit[] = [];
  for (const c of lastWeek) {
    const to = toDate.get(c.date);
    const target = to && thisWeek.find((t) => t.staffId === c.staffId && t.date === to);
    if (!target) continue;
    const shifts = shown(last.get(cellKey(c.staffId, c.date))!);
    if (!sameShifts(shifts, shown(target))) edits.push({ staffId: c.staffId, date: target.date, shifts });
  }
  return edits;
}

// Clear week: every day with hours set to off.
export function clearWeek(cells: readonly Cell[]): DayEdit[] {
  return cells.filter((c) => shown(c).length > 0).map((c) => ({ staffId: c.staffId, date: c.date, shifts: [] }));
}

// What a cell becomes once a day is saved: the draft goes when it's the
// same as what's published.
export function withEdit(cell: Cell, shifts: Shift[]): Cell {
  const next = sortShifts(shifts);
  return { ...cell, draft: sameShifts(next, cell.live) ? null : next };
}

// The draft's changes, for the publish check: each day that will change,
// and the clients it leaves outside the new hours.
export type Change = { staffId: string; date: LocalDate; before: Shift[]; after: Shift[]; affected: BookedSpan[] };

export function changesOf(cells: readonly Cell[]): Change[] {
  return cells
    .filter((c) => c.draft && !sameShifts(c.draft, c.live))
    .map((c) => ({ staffId: c.staffId, date: c.date, before: c.live, after: c.draft!, affected: outside(c, c.draft!).filter((b) => !outside(c, c.live).includes(b)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// "9am–5pm", or "Off".
export const sayShifts = (shifts: readonly Shift[]) => (shifts.length ? formatIntervals([...shifts]) : "Off");

// The Mark out panel for a day whose new hours leave clients outside them:
// leaving early when the day now ends earlier, else the whole day.
export function outPanelHref(change: Pick<Change, "staffId" | "date" | "before" | "after">): string {
  const search = new URLSearchParams({ date: change.date, out: change.staffId });
  const lastEnd = change.after.at(-1)?.end;
  if (lastEnd != null && change.before.length && change.after[0].start <= change.before[0].start && lastEnd < change.before.at(-1)!.end) {
    search.set("leaves", `${String(Math.floor(lastEnd / 60)).padStart(2, "0")}:${String(lastEnd % 60).padStart(2, "0")}`);
  }
  return `/calendar?${search}`;
}

// The span the grid's tracks cover: the salon's opening hours that week
// and everyone's shifts, on whole hours (7am to 9pm when nothing's open).
export function trackRange(open: readonly Interval[], shifts: readonly Interval[]): Interval {
  const all = [...open, ...shifts];
  if (!all.length) return { start: 7 * 60, end: 21 * 60 };
  const start = Math.min(...all.map((i) => i.start));
  const end = Math.max(...all.map((i) => i.end));
  return { start: Math.floor(start / 60) * 60, end: Math.min(MINUTES_PER_DAY, Math.ceil(end / 60) * 60) };
}

export const SNAP = 15;
const MIN_SHIFT = 30;

// Dragging a shift: moved by `delta` minutes (snapped to 15), or one edge
// moved; kept inside the day's track and clear of the day's other shifts.
// Null when it doesn't fit.
export function dragShift(
  shifts: readonly Shift[],
  index: number,
  mode: "move" | "start" | "end",
  delta: number,
  range: Interval,
): Shift[] | null {
  const step = Math.round(delta / SNAP) * SNAP;
  const s = shifts[index];
  let next: Shift;
  if (mode === "move") {
    const len = s.end - s.start;
    const start = Math.max(range.start, Math.min(range.end - len, s.start + step));
    next = { start, end: start + len };
  } else if (mode === "start") {
    next = { start: Math.max(range.start, Math.min(s.end - MIN_SHIFT, s.start + step)), end: s.end };
  } else {
    next = { start: s.start, end: Math.min(range.end, Math.max(s.start + MIN_SHIFT, s.end + step)) };
  }
  const out = sortShifts(shifts.map((x, i) => (i === index ? next : x)));
  return shiftProblem(out) ? null : out;
}

// A shift moved to another day: added there if it fits.
export function dropOnDay(target: readonly Shift[], shift: Shift): Shift[] | null {
  const out = sortShifts([...target, shift]);
  return shiftProblem(out) ? null : out;
}

// A new shift for a day: the salon's hours that day (or 9 to 5), after any
// shifts already there.
export function newShift(existing: readonly Shift[], open: readonly Interval[]): Shift | null {
  const day = open.length ? { start: open[0].start, end: open.at(-1)!.end } : { start: 9 * 60, end: 17 * 60 };
  if (!existing.length) return day;
  const after = existing.at(-1)!.end + 60;
  const end = Math.max(day.end, after + 2 * 60);
  return after + MIN_SHIFT <= Math.min(end, MINUTES_PER_DAY) ? { start: after, end: Math.min(end, MINUTES_PER_DAY) } : null;
}

// A repeating pattern in words: "Every week", "Every 2 weeks".
export const patternLabel = (weeks: number) => (weeks <= 1 ? "Every week" : `Repeats every ${weeks} weeks`);
