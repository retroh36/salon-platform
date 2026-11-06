// PTO balances, pure: from the salon's policy, the hours someone worked,
// their approved time off of the types that use PTO, and adjustments, the
// balance day by day as a statement (granted, earned, used, lost at the
// year's end, adjusted), what's booked ahead and what's waiting for a
// decision. Nothing is stored but adjustments, so a changed policy, a
// fixed punch or time off taken back puts every balance right.
import { addDays, datesBetween, type LocalDate } from "./scheduling/time.ts";

export type Accrual = "yearly" | "per_hour" | "per_period";
export type CarryOver = "all" | "none" | "up_to";

export type PtoPolicy = {
  accrual: Accrual;
  yearlyMinutes: number;
  prorateFirstYear: boolean;
  // Per hour worked: earnMinutes for every perHours worked.
  earnMinutes: number;
  perHours: number;
  periodMinutes: number;
  yearStartMonth: number;
  carryOver: CarryOver;
  carryMinutes: number;
  capMinutes: number | null;
  trackingFrom: LocalDate;
};

export const ACCRUAL_LABELS: Record<Accrual, string> = {
  yearly: "A yearly amount",
  per_hour: "Per hour worked",
  per_period: "Per pay period",
};

export type Interval = { start: number; end: number };
export type DaySpan = { startsOn: LocalDate; endsOn: LocalDate; startMinute: number | null; endMinute: number | null };

// The minutes of someone's working hours a stretch of time off takes on
// one day: all of them for a whole day, else only what it overlaps. A day
// they weren't working takes nothing.
export function minutesOff(hours: Interval[], span: DaySpan, date: LocalDate): number {
  if (date < span.startsOn || date > span.endsOn) return 0;
  const from = span.startMinute ?? 0;
  const to = span.endMinute ?? 1440;
  return hours.reduce((n, h) => n + Math.max(0, Math.min(h.end, to) - Math.max(h.start, from)), 0);
}

// The first day of the PTO year a date is in.
export function yearStartOf(date: LocalDate, month: number): LocalDate {
  const [y, m] = date.split("-").map(Number);
  const year = m >= month ? y : y - 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

const nextYearStart = (start: LocalDate) => `${Number(start.slice(0, 4)) + 1}${start.slice(4)}`;
const daysBetween = (a: LocalDate, b: LocalDate) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
// Grants are rounded to the quarter hour.
const quarter = (minutes: number) => Math.round(minutes / 15) * 15;

export type PtoLineKind = "granted" | "earned" | "used" | "lost" | "adjusted";
export type PtoLine = { date: LocalDate; kind: PtoLineKind; minutes: number; balance: number; note: string };

export type PtoUse = { date: LocalDate; minutes: number; label: string };
export type PtoAdjustment = { date: LocalDate; minutes: number; reason: string };

export type PtoStatement = {
  lines: PtoLine[];
  // As of today, time off taken counted.
  balance: number;
  yearStart: LocalDate;
  carriedIn: number;
  earnedThisYear: number;
  usedThisYear: number;
  // Approved and still to come, and waiting for a decision.
  booked: number;
  pending: number;
  // What's left to ask for: the balance less what's booked.
  available: number;
};

// A person's statement from `startsOn` (the later of the policy's
// tracking date and their first day) to today. `worked` is minutes worked
// each day (per hour worked), `periodEnds` the last day of each pay period
// (per pay period), `uses` each day's PTO taken or booked (approved),
// `pending` each day's PTO asked for.
export function ptoStatement(
  policy: PtoPolicy,
  input: { startsOn: LocalDate; worked: Map<LocalDate, number>; periodEnds: LocalDate[]; uses: PtoUse[]; pending: PtoUse[]; adjustments: PtoAdjustment[] },
  today: LocalDate,
): PtoStatement {
  const lines: PtoLine[] = [];
  let balance = 0;
  const yearStart = yearStartOf(today, policy.yearStartMonth);
  let carriedIn = 0;
  let earnedThisYear = 0;
  let usedThisYear = 0;
  const thisYear = (d: LocalDate) => d >= yearStart;
  const room = (earn: number) => (policy.capMinutes == null ? earn : Math.max(0, Math.min(earn, policy.capMinutes - balance)));
  const push = (date: LocalDate, kind: PtoLineKind, minutes: number, note: string) => {
    balance += minutes;
    lines.push({ date, kind, minutes, balance, note });
  };
  const capNote = (earn: number, wanted: number) => (earn < wanted ? " (at the cap)" : "");

  // Hours earned per hour worked add up over a month, as one line.
  let month: { date: LocalDate; minutes: number; worked: number } | null = null;
  const closeMonth = () => {
    if (month && month.minutes > 0) {
      balance -= month.minutes;
      push(month.date, "earned", month.minutes, `For ${formatPto(month.worked)} worked`);
    }
    month = null;
  };

  const ends = new Set(input.periodEnds);
  const byDay = <T extends { date: LocalDate }>(list: T[]) => {
    const map = new Map<LocalDate, T[]>();
    for (const x of list) {
      const d = x.date < input.startsOn ? input.startsOn : x.date;
      map.set(d, [...(map.get(d) ?? []), x]);
    }
    return map;
  };
  const adjustments = byDay(input.adjustments);
  const uses = byDay(input.uses);

  if (input.startsOn <= today) {
    for (const date of datesBetween(input.startsOn, today)) {
      const first = date === input.startsOn;
      const newYear = date === yearStartOf(date, policy.yearStartMonth);
      if (newYear && month) closeMonth();
      // The year's end: what doesn't carry over is lost.
      if (newYear && !first && balance > 0) {
        const keep = policy.carryOver === "all" ? balance : policy.carryOver === "none" ? 0 : Math.min(balance, policy.carryMinutes);
        if (keep < balance) push(date, "lost", keep - balance, policy.carryOver === "none" ? "Doesn't carry over to the new year" : `Over the ${formatPto(policy.carryMinutes)} that carries over`);
      }
      if (newYear && thisYear(date)) carriedIn = Math.max(0, balance);

      for (const a of adjustments.get(date) ?? []) push(date, "adjusted", a.minutes, a.reason);

      if (policy.accrual === "yearly" && (newYear || first)) {
        let grant = policy.yearlyMinutes;
        if (first && !newYear && policy.prorateFirstYear) {
          const start = yearStartOf(date, policy.yearStartMonth);
          const next = nextYearStart(start);
          grant = quarter((policy.yearlyMinutes * daysBetween(date, next)) / daysBetween(start, next));
        }
        const earn = room(grant);
        if (earn > 0 || grant > 0) push(date, "granted", earn, `${first && !newYear && policy.prorateFirstYear ? `For the rest of the year (${formatPto(policy.yearlyMinutes)} a year)` : `The year's ${formatPto(grant)}`}${capNote(earn, grant)}`);
        if (thisYear(date)) earnedThisYear += earn;
      }

      if (policy.accrual === "per_hour") {
        const worked = input.worked.get(date) ?? 0;
        if (month && date.slice(0, 7) !== month.date.slice(0, 7)) closeMonth();
        if (worked > 0) {
          const earn = room((worked * policy.earnMinutes) / (policy.perHours * 60));
          balance += earn;
          month = month ?? { date, minutes: 0, worked: 0 };
          month.date = date;
          month.minutes += earn;
          month.worked += worked;
          if (thisYear(date)) earnedThisYear += earn;
        }
      }

      if (policy.accrual === "per_period" && ends.has(date)) {
        const earn = room(policy.periodMinutes);
        push(date, "earned", earn, `Pay period ending ${date}${capNote(earn, policy.periodMinutes)}`);
        if (thisYear(date)) earnedThisYear += earn;
      }

      for (const u of uses.get(date) ?? []) {
        if (u.minutes <= 0) continue;
        if (month) closeMonth();
        push(date, "used", -u.minutes, u.label);
        if (thisYear(date)) usedThisYear += u.minutes;
      }
    }
    closeMonth();
  }

  const after = (list: PtoUse[]) => list.filter((u) => u.date > today).reduce((n, u) => n + u.minutes, 0);
  const booked = after(input.uses);
  const pending = input.pending.filter((u) => u.date >= today).reduce((n, u) => n + u.minutes, 0);
  return { lines, balance, yearStart, carriedIn, earnedThisYear, usedThisYear, booked, pending, available: balance - booked };
}

// "8 hr", "12.5 hr", "-4 hr": balances to two decimals at most.
export function formatPto(minutes: number): string {
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours.toLocaleString("en-US", { maximumFractionDigits: 2 })} hr`;
}

// The last day of every pay period that ended between two dates.
export function periodEndsBetween(from: LocalDate, to: LocalDate, periodOf: (date: LocalDate) => { from: LocalDate; to: LocalDate }): LocalDate[] {
  const ends: LocalDate[] = [];
  for (let p = periodOf(from); p.to <= to; p = periodOf(addDays(p.to, 1))) ends.push(p.to);
  return ends;
}

// What a request would leave: the balance less what's booked, less this.
export function wouldLeave(statement: Pick<PtoStatement, "available">, minutes: number): number {
  return statement.available - minutes;
}
