// Free times for a service: every stylist who offers it, at each start time
// in a window, checked with the booking rules (./booking.ts), with a free
// chair. Each stylist is checked with their own length for the service:
// `timings` (e.g. how long they really take, from lib/insights/), else
// their own or the menu's. Used by Denise's "Ask Denise" to answer "who's
// free for a color at 3?". Pure, over a BookingContext from ./load.ts.

import { checkItem, durationMinutes, pickResource, timingFor, type BookedItem, type BookingContext, type ServiceTiming } from "./booking.ts";
import { fromLocal, type LocalDate } from "./time.ts";

export type OpeningQuery = {
  serviceId: string;
  date: LocalDate;
  // Only these stylists (default: everyone who offers the service).
  staffIds?: string[];
  // Local minutes since midnight, inclusive start window.
  from?: number;
  to?: number;
  // Minutes between candidate starts.
  step?: number;
  // Not before this instant (now, for today).
  notBefore?: Date;
  limit?: number;
  // Staff id -> the length to check that stylist with.
  timings?: ReadonlyMap<string, ServiceTiming>;
};

export type Opening = { staffId: string; start: Date; startMinute: number; resourceId: string | null; minutes: number };

export function findOpenings(ctx: BookingContext, q: OpeningQuery): Opening[] {
  const service = ctx.services.get(q.serviceId);
  if (!service || service.archived) return [];
  const step = q.step ?? 15;
  const from = Math.max(0, q.from ?? 0);
  const to = Math.min(24 * 60 - step, q.to ?? 24 * 60);
  const limit = q.limit ?? 8;
  const stylists = [...ctx.staff.values()].filter((s) => s.isActive && s.serviceIds.has(q.serviceId) && (!q.staffIds || q.staffIds.includes(s.id)));

  const openings: Opening[] = [];
  // Earliest first, spreading across stylists at each time.
  for (let minute = Math.ceil(from / step) * step; minute <= to && openings.length < limit; minute += step) {
    const start = fromLocal(q.date, minute, ctx.location.timeZone);
    if (!start || (q.notBefore && start < q.notBefore)) continue;
    for (const staff of stylists) {
      if (openings.length >= limit) break;
      const timing = q.timings?.get(staff.id) ?? timingFor(ctx, staff.id, service.id)!;
      const draft: BookedItem = { ...timing, serviceId: service.id, staffId: staff.id, start };
      const resourceId = pickResource(ctx, draft);
      if (!resourceId && [...ctx.resources.values()].some((r) => r.kind === "chair" && r.isActive)) continue;
      if (checkItem(ctx, { serviceId: service.id, staffId: staff.id, resourceId, start, timing }).valid) {
        openings.push({ staffId: staff.id, start, startMinute: minute, resourceId, minutes: durationMinutes(timing) });
      }
    }
  }
  return openings;
}
