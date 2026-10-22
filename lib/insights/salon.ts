// The salon's patterns: its busiest and quietest hours, how often each
// service and each weekday runs over, no-shows by day and time of day, and
// how often each stylist's clients rebook before they leave. Pure; runs
// under plain Node.

import type { VisitStatus } from "./clients.ts";
import { timeOfDay, type TimeOfDay } from "./clients.ts";
import { OVERRUN_MINUTES } from "./durations.ts";
import { median, ratio } from "./stats.ts";

// One service on one visit. Times are local to the salon.
export type SalonItem = {
  appointmentId: string;
  clientId: string | null;
  staffId: string;
  serviceId: string;
  start: Date;
  weekday: number;
  minute: number;
  bookedMinutes: number;
  actualMinutes: number | null;
  status: VisitStatus;
  // When the visit was booked, and when the client left (if they did).
  createdAt: Date;
  checkedOutAt: Date | null;
};

// Opening hours by ISO weekday, in minutes since midnight.
export type OpenHours = Partial<Record<number, { start: number; end: number }[]>>;

export type HourLoad = { weekday: number; hour: number; bookedMinutesPerWeek: number };
export type ServiceOverrun = { serviceId: string; visits: number; overrunRate: number; typicalOverMinutes: number | null };
export type WeekdayRunning = {
  weekday: number;
  visits: number;
  overrunRate: number;
  // Average of actual minus booked, every timed visit that day (negative
  // means early).
  averageOverMinutes: number;
  // The stylist who runs over most that day (5+ timed visits), if any does
  // more than the salon as a whole.
  worstStaffId: string | null;
  worstStaffRate: number | null;
  // The services that run over most that day.
  worstServiceIds: string[];
};
export type RateBy<K> = { key: K; visits: number; rate: number };
export type StylistRebooking = { staffId: string; visits: number; rebookedRate: number };

export type SalonInsight = {
  weeks: number;
  hours: HourLoad[];
  busiest: HourLoad[];
  quietest: HourLoad[];
  serviceOverruns: ServiceOverrun[];
  weekdays: WeekdayRunning[];
  noShowsByWeekday: RateBy<number>[];
  noShowsByTimeOfDay: RateBy<TimeOfDay>[];
  rebooking: StylistRebooking[];
  noShowRate: number | null;
  overrunRate: number | null;
  rebookedRate: number | null;
};

const DAY = 86_400_000;
// Rebooked: the next visit was booked by the end of the day after.
const REBOOK_WITHIN_DAYS = 1;
const MIN_WORST_VISITS = 5;

const over = (i: SalonItem) => i.actualMinutes !== null && i.actualMinutes > i.bookedMinutes + OVERRUN_MINUTES;

export function salonInsight(items: readonly SalonItem[], open: OpenHours, weeks: number): SalonInsight {
  const held = items.filter((i) => i.status !== "canceled" && i.status !== "no_show");

  // Booked staff-minutes falling in each open hour, per week.
  const load = new Map<string, number>();
  for (const i of held) {
    for (let m = i.minute; m < i.minute + i.bookedMinutes; m += 5) {
      const key = `${i.weekday}:${Math.floor(m / 60)}`;
      load.set(key, (load.get(key) ?? 0) + 5);
    }
  }
  const hours: HourLoad[] = [];
  for (const [weekday, spans] of Object.entries(open)) {
    for (const span of spans ?? []) {
      for (let hour = Math.floor(span.start / 60); hour * 60 < span.end; hour++) {
        hours.push({ weekday: Number(weekday), hour, bookedMinutesPerWeek: Math.round((load.get(`${weekday}:${hour}`) ?? 0) / Math.max(weeks, 1)) });
      }
    }
  }
  const busiest = [...hours].sort((a, b) => b.bookedMinutesPerWeek - a.bookedMinutesPerWeek || a.weekday - b.weekday || a.hour - b.hour);
  const quietest = [...hours].sort((a, b) => a.bookedMinutesPerWeek - b.bookedMinutesPerWeek || a.weekday - b.weekday || a.hour - b.hour);

  const timed = held.filter((i) => i.actualMinutes !== null);
  const serviceOverruns = groupBy(timed, (i) => i.serviceId)
    .map(([serviceId, list]) => {
      const overs = list.filter(over).map((i) => i.actualMinutes! - i.bookedMinutes);
      return { serviceId, visits: list.length, overrunRate: overs.length / list.length, typicalOverMinutes: overs.length ? Math.round(median(overs)!) : null };
    })
    .sort((a, b) => b.overrunRate - a.overrunRate || b.visits - a.visits);

  const salonRate = ratio(timed.filter(over).length, timed.length);
  const weekdays = groupBy(timed, (i) => i.weekday)
    .map(([weekday, list]): WeekdayRunning => {
      const staff = groupBy(list, (i) => i.staffId)
        .filter(([, l]) => l.length >= MIN_WORST_VISITS)
        .map(([staffId, l]) => ({ staffId, rate: l.filter(over).length / l.length }))
        .sort((a, b) => b.rate - a.rate);
      const worst = staff[0] && salonRate !== null && staff[0].rate > salonRate ? staff[0] : null;
      const services = groupBy(list, (i) => i.serviceId)
        .filter(([, l]) => l.length >= 3)
        .map(([serviceId, l]) => ({ serviceId, rate: l.filter(over).length / l.length }))
        .filter((s) => s.rate > 0)
        .sort((a, b) => b.rate - a.rate);
      return {
        weekday,
        visits: list.length,
        overrunRate: list.filter(over).length / list.length,
        averageOverMinutes: Math.round(list.reduce((sum, i) => sum + i.actualMinutes! - i.bookedMinutes, 0) / list.length),
        worstStaffId: worst?.staffId ?? null,
        worstStaffRate: worst?.rate ?? null,
        worstServiceIds: services.slice(0, 3).map((s) => s.serviceId),
      };
    })
    .sort((a, b) => a.weekday - b.weekday);

  // No-shows, per visit (first service).
  const visits = groupBy(items, (i) => i.appointmentId).map(([, list]) => [...list].sort((a, b) => a.start.getTime() - b.start.getTime())[0]);
  const settled = visits.filter((v) => v.status === "completed" || v.status === "no_show");
  const noShowRate = (list: SalonItem[]) => list.filter((v) => v.status === "no_show").length / list.length;
  const noShowsByWeekday = groupBy(settled, (v) => v.weekday)
    .map(([key, list]) => ({ key, visits: list.length, rate: noShowRate(list) }))
    .sort((a, b) => a.key - b.key);
  const noShowsByTimeOfDay = groupBy(settled, (v) => timeOfDay(v.minute)).map(([key, list]) => ({ key, visits: list.length, rate: noShowRate(list) }));

  // Rebooking: a completed visit whose client had their next visit booked
  // by the end of the day after.
  const byClient = new Map<string, SalonItem[]>();
  for (const v of visits) if (v.clientId && v.status !== "canceled") byClient.set(v.clientId, [...(byClient.get(v.clientId) ?? []), v]);
  const rebooked = (v: SalonItem) => {
    const left = v.checkedOutAt ?? v.start;
    return (byClient.get(v.clientId!) ?? []).some((o) => o.start > v.start && o.createdAt.getTime() <= left.getTime() + REBOOK_WITHIN_DAYS * DAY);
  };
  const completed = visits.filter((v) => v.status === "completed" && v.clientId);
  const rebooking = groupBy(completed, (v) => v.staffId)
    .map(([staffId, list]) => ({ staffId, visits: list.length, rebookedRate: list.filter(rebooked).length / list.length }))
    .sort((a, b) => b.rebookedRate - a.rebookedRate);

  return {
    weeks,
    hours,
    busiest: busiest.slice(0, 3),
    quietest: quietest.slice(0, 3),
    serviceOverruns,
    weekdays,
    noShowsByWeekday,
    noShowsByTimeOfDay,
    rebooking,
    noShowRate: settled.length ? noShowRate(settled) : null,
    overrunRate: salonRate,
    rebookedRate: ratio(completed.filter(rebooked).length, completed.length),
  };
}

function groupBy<T, K>(list: readonly T[], key: (t: T) => K): [K, T[]][] {
  const groups = new Map<K, T[]>();
  for (const t of list) {
    const k = key(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups];
}
