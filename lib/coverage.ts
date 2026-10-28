// Denise's checks on the team schedule, pure: who's working when, gaps in
// cover, and what giving someone a day off would leave. Our code works out
// every fact here; Denise only says them (in our wording on the Scheduling
// page, and through Ask Denise's tools).
import { intersectIntervals, mergeIntervals, subtractIntervals, type Interval } from "./scheduling/intervals.ts";
import { formatDay, formatIntervals } from "./schedule-format.ts";
import type { LocalDate } from "./scheduling/time.ts";

export type CoverageRole = "owner" | "manager" | "front_desk" | "stylist" | "assistant";
export type CoverageLevel = "artisan" | "senior" | "master" | null;

export type CoveragePerson = { id: string; firstName: string; role: CoverageRole; level: CoverageLevel; chair: string | null };

export type CoverageCell = {
  staffId: string;
  // What they'll work (the draft when there is one).
  shifts: Interval[];
  // Whether those are draft hours, not yet published.
  draft: boolean;
  // Approved time off that day.
  timeOff: Interval[];
  // Their clients that day, and the minutes those take.
  clients: number;
  bookedMinutes: number;
  // A chair lent to them that day.
  lentChair: string | null;
};

export type CoverageDay = {
  date: LocalDate;
  // When the salon is open ([] when closed).
  open: Interval[];
  cells: CoverageCell[];
  // Time off asked for and not yet decided, touching this day.
  requests: { staffId: string; startMinute: number | null; endMinute: number | null }[];
};

export type FlagKind = "desk_gap" | "no_stylists" | "no_master" | "double_chair" | "draft_on_time_off" | "request_busy_day";

export type CoverageFlag = { kind: FlagKind; date: LocalDate; staffIds: string[]; text: string };

// Gaps shorter than this aren't worth a warning (a late start, a handover).
export const GAP_MINUTES = 30;
// A day this full (booked over scheduled stylist time) is busy.
export const BUSY_SHARE = 0.8;

// Front of house cover: the front desk and managers.
const DESK_ROLES: CoverageRole[] = ["front_desk", "manager"];

const hoursOf = (day: CoverageDay, people: readonly CoveragePerson[], roles: CoverageRole[]) => {
  const ids = new Set(people.filter((p) => roles.includes(p.role)).map((p) => p.id));
  return day.cells.filter((c) => ids.has(c.staffId));
};

// What someone actually works: their shifts less approved time off.
export const working = (cell: Pick<CoverageCell, "shifts" | "timeOff">): Interval[] => subtractIntervals(mergeIntervals(cell.shifts), cell.timeOff);

// Times the salon is open with nobody in these roles working.
function gaps(day: CoverageDay, cells: readonly CoverageCell[]): Interval[] {
  const covered = mergeIntervals(cells.flatMap(working));
  return subtractIntervals(mergeIntervals(day.open), covered).filter((g) => g.end - g.start >= GAP_MINUTES);
}

// Stylists' booked share of their working time that day.
export function bookedShare(day: CoverageDay, people: readonly CoveragePerson[]): number {
  const cells = hoursOf(day, people, ["stylist"]);
  const scheduled = cells.reduce((n, c) => n + working(c).reduce((m, s) => m + s.end - s.start, 0), 0);
  const booked = cells.reduce((n, c) => n + c.bookedMinutes, 0);
  return scheduled ? booked / scheduled : booked ? 1 : 0;
}

// Everything worth a manager's attention on a day.
export function coverageFlags(people: readonly CoveragePerson[], day: CoverageDay): CoverageFlag[] {
  if (!day.open.length) return [];
  const flags: CoverageFlag[] = [];
  const person = new Map(people.map((p) => [p.id, p]));
  const name = (id: string) => person.get(id)?.firstName ?? "Someone";
  const label = formatDay(day.date);
  const flag = (kind: FlagKind, staffIds: string[], text: string) => flags.push({ kind, date: day.date, staffIds, text });

  const desk = hoursOf(day, people, DESK_ROLES);
  if (people.some((p) => DESK_ROLES.includes(p.role)))
    for (const g of gaps(day, desk)) flag("desk_gap", [], `Nobody on the front desk ${formatIntervals([g])} on ${label}.`);

  const stylists = hoursOf(day, people, ["stylist"]);
  for (const g of gaps(day, stylists)) flag("no_stylists", [], `No stylists working ${formatIntervals([g])} on ${label}.`);

  const masters = people.filter((p) => p.role === "stylist" && p.level === "master");
  if (masters.length && !masters.some((m) => day.cells.some((c) => c.staffId === m.id && working(c).length)))
    flag("no_master", masters.map((m) => m.id), `No Master stylist working on ${label}.`);

  // Two people on one chair at once: its own stylist and someone it's lent to.
  const byChair = new Map<string, { id: string; hours: Interval[] }[]>();
  for (const c of day.cells) {
    const chair = c.lentChair ?? person.get(c.staffId)?.chair;
    if (!chair || !working(c).length) continue;
    byChair.set(chair, [...(byChair.get(chair) ?? []), { id: c.staffId, hours: working(c) }]);
  }
  for (const [chair, users] of byChair)
    for (let i = 0; i < users.length; i++)
      for (let j = i + 1; j < users.length; j++) {
        const both = intersectIntervals(users[i].hours, users[j].hours);
        if (both.length) flag("double_chair", [users[i].id, users[j].id], `${name(users[i].id)} and ${name(users[j].id)} are both on ${chair} ${formatIntervals(both)} on ${label}.`);
      }

  for (const c of day.cells)
    if (c.draft && intersectIntervals(mergeIntervals(c.shifts), c.timeOff).length)
      flag("draft_on_time_off", [c.staffId], `${name(c.staffId)}'s draft hours on ${label} overlap approved time off.`);

  const busy = bookedShare(day, people) >= BUSY_SHARE;
  for (const r of day.requests) {
    const cell = day.cells.find((c) => c.staffId === r.staffId);
    const clients = cell?.clients ?? 0;
    if (!clients && !busy) continue;
    const why = clients ? `${clients} of ${name(r.staffId)}'s clients are booked then` : "the day is already busy";
    flag("request_busy_day", [r.staffId], `${name(r.staffId)} asked for time off on ${label}, and ${why}.`);
  }
  return flags;
}

// The parts of a day people ask about ("Thursday night").
export type DayPart = "morning" | "afternoon" | "evening" | "all_day";
export const DAY_PARTS: Record<DayPart, Interval> = {
  morning: { start: 0, end: 12 * 60 },
  afternoon: { start: 12 * 60, end: 17 * 60 },
  evening: { start: 17 * 60, end: 24 * 60 },
  all_day: { start: 0, end: 24 * 60 },
};

// Who's working in a part of the day, earliest first, with their hours.
export function whoIsWorking(people: readonly CoveragePerson[], day: CoverageDay, part: DayPart): { id: string; firstName: string; role: CoverageRole; level: CoverageLevel; hours: Interval[] }[] {
  const window = DAY_PARTS[part];
  const person = new Map(people.map((p) => [p.id, p]));
  return day.cells
    .map((c) => ({ c, hours: working(c) }))
    .filter(({ hours }) => intersectIntervals(hours, [window]).length)
    .sort((a, b) => a.hours[0].start - b.hours[0].start)
    .map(({ c, hours }) => ({ id: c.staffId, firstName: person.get(c.staffId)!.firstName, role: person.get(c.staffId)!.role, level: person.get(c.staffId)!.level, hours }));
}

// What giving someone the day off would leave: their clients to move, who
// else is off, the stylists and Masters left, how busy the rest would be,
// and any new gaps in cover.
export type TimeOffImpact = {
  staffId: string;
  date: LocalDate;
  working: boolean;
  clients: number;
  alsoOff: string[];
  stylistsLeft: number;
  mastersLeft: number;
  busyShareAfter: number;
  newFlags: CoverageFlag[];
};

export function timeOffImpact(people: readonly CoveragePerson[], day: CoverageDay, staffId: string): TimeOffImpact {
  const cell = day.cells.find((c) => c.staffId === staffId);
  const isOn = (c: CoverageCell) => working(c).length > 0;
  // Their clients' time stays booked, on the stylists left.
  const after: CoverageDay = {
    ...day,
    cells: day.cells.map((c) => (c.staffId === staffId ? { ...c, shifts: [], clients: 0, bookedMinutes: 0 } : c)),
    requests: [],
  };
  if (cell) {
    const other = after.cells.find((c) => c.staffId !== staffId && isOn(c) && people.find((p) => p.id === c.staffId)?.role === "stylist");
    if (other) other.bookedMinutes += cell.bookedMinutes;
  }
  const before = new Set(coverageFlags(people, { ...day, requests: [] }).map((f) => f.text));
  const stylistsOn = after.cells.filter((c) => isOn(c) && people.find((p) => p.id === c.staffId)?.role === "stylist");
  const scheduled = people.filter((p) => p.role !== "owner");
  return {
    staffId,
    date: day.date,
    working: Boolean(cell && isOn(cell)),
    clients: cell?.clients ?? 0,
    alsoOff: scheduled.filter((p) => p.id !== staffId && !day.cells.some((c) => c.staffId === p.id && isOn(c))).map((p) => p.firstName),
    stylistsLeft: stylistsOn.length,
    mastersLeft: stylistsOn.filter((c) => people.find((p) => p.id === c.staffId)?.level === "master").length,
    busyShareAfter: bookedShare(after, people),
    newFlags: coverageFlags(people, after).filter((f) => !before.has(f.text)),
  };
}

// Denise's draft of a month: everyone's pattern, approved time off taken
// out, and a desk gap filled by someone on the front desk who's off that
// day (the one with the fewest hours that week, never over 40), for the
// gap, at least four hours, within opening hours.
export type DraftDay = { staffId: string; date: LocalDate; shifts: Interval[] };
export const MIN_SHIFT = 4 * 60;
export const MAX_WEEK_MINUTES = 40 * 60;

export function draftMonth(
  people: readonly CoveragePerson[],
  days: readonly (CoverageDay & { weekStart: LocalDate })[],
): { changes: DraftDay[]; filled: CoverageFlag[]; left: CoverageFlag[] } {
  const changes: DraftDay[] = [];
  const filled: CoverageFlag[] = [];
  const weekMinutes = new Map<string, number>();
  const key = (id: string, week: LocalDate) => `${id}|${week}`;
  const drafted = days.map((d) => ({
    ...d,
    cells: d.cells.map((c) => {
      const shifts = working(c);
      if (shifts.length !== c.shifts.length || shifts.some((s, i) => s.start !== c.shifts[i].start || s.end !== c.shifts[i].end))
        changes.push({ staffId: c.staffId, date: d.date, shifts });
      return { ...c, shifts, timeOff: c.timeOff };
    }),
  }));
  for (const d of drafted)
    for (const c of d.cells) weekMinutes.set(key(c.staffId, d.weekStart), (weekMinutes.get(key(c.staffId, d.weekStart)) ?? 0) + working(c).reduce((n, s) => n + s.end - s.start, 0));

  const desk = people.filter((p) => p.role === "front_desk");
  for (const d of drafted) {
    for (const gap of gaps(d, hoursOf(d, people, DESK_ROLES))) {
      const open = mergeIntervals(d.open).find((o) => o.start <= gap.start && o.end >= gap.end);
      if (!open) continue;
      const length = Math.max(gap.end - gap.start, MIN_SHIFT);
      // Grow the shift around the gap, inside opening hours.
      const start = Math.max(open.start, Math.min(gap.start, open.end - length));
      const shift = { start, end: Math.min(open.end, start + length) };
      const pick = desk
        .map((p) => ({ p, cell: d.cells.find((c) => c.staffId === p.id), used: weekMinutes.get(key(p.id, d.weekStart)) ?? 0 }))
        .filter(({ cell }) => cell && !working(cell).length && !intersectIntervals([shift], cell.timeOff).length)
        .filter(({ used }) => used + shift.end - shift.start <= MAX_WEEK_MINUTES)
        .sort((a, b) => a.used - b.used || a.p.firstName.localeCompare(b.p.firstName))[0];
      if (!pick) continue;
      pick.cell!.shifts = [shift];
      weekMinutes.set(key(pick.p.id, d.weekStart), pick.used + shift.end - shift.start);
      const existing = changes.find((c) => c.staffId === pick.p.id && c.date === d.date);
      if (existing) existing.shifts = [shift];
      else changes.push({ staffId: pick.p.id, date: d.date, shifts: [shift] });
      filled.push({ kind: "desk_gap", date: d.date, staffIds: [pick.p.id], text: `${pick.p.firstName} covers the front desk ${formatIntervals([shift])} on ${formatDay(d.date)}.` });
    }
  }
  const order = new Map(people.map((p, i) => [p.id, i]));
  changes.sort((a, b) => a.date.localeCompare(b.date) || order.get(a.staffId)! - order.get(b.staffId)!);
  const left = drafted.flatMap((d) => coverageFlags(people, { ...d, requests: [] }).filter((f) => f.kind !== "draft_on_time_off"));
  return { changes, filled, left };
}

// Denise's month drafts in the AI action log.
export const DRAFT_FEATURE = "schedule_draft";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// The month after `today`'s: "2026-11", "November", its first and last day.
export function nextMonth(today: LocalDate): { month: string; name: string; from: LocalDate; to: LocalDate } {
  const [y, m] = today.split("-").map(Number);
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { month: `${year}-${mm}`, name: MONTHS[month - 1], from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}
