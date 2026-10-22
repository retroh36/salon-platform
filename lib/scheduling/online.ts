// Online booking: when a visit can start, for the salon's public booking
// site. A visit is one or more services back to back, each starting when
// the one before ends, with a chosen stylist or "no preference" (anyone who
// offers the service). Every time offered passes the same rules as the
// calendar (./booking.ts: hours, time off, blocked time, processing gaps),
// with a free chair for each service, and the visit is planned and checked
// again when it's saved (./online-book.ts).
//
// Pure, over a BookingContext from ./load.ts.

import { checkItem, itemEnd, pickResource, timingFor, type BookedItem, type BookingContext, type CheckOptions } from "./booking.ts";
import { fromLocal, MINUTES_PER_DAY, type LocalDate } from "./time.ts";

export type VisitRequest = {
  // In the order they're done.
  serviceIds: readonly string[];
  // A chosen stylist, or null for no preference.
  staffId: string | null;
  // Who may be booked online, in the order to try them for "no preference".
  stylistIds: readonly string[];
};

export type PlannedItem = { serviceId: string; staffId: string; resourceId: string | null; start: Date };

// A time the visit can start, and who does what then.
export type VisitTime = { minute: number; start: Date; items: PlannedItem[] };

// Minutes between the start times offered.
export const ONLINE_STEP = 15;

// Who does each service of the visit starting at `start`, in which chair,
// or null if it can't be booked then. With no preference, each service goes
// to the first stylist who can take it, keeping the same stylist as the
// service before when they can.
export function planVisitAt(ctx: BookingContext, request: VisitRequest, start: Date, options: CheckOptions = {}): PlannedItem[] | null {
  if (request.serviceIds.length === 0) return null;
  const hasChairs = [...ctx.resources.values()].some((r) => r.kind === "chair" && r.isActive);
  const accepted: BookedItem[] = [];
  const planned: PlannedItem[] = [];
  let at = start;

  for (const serviceId of request.serviceIds) {
    const service = ctx.services.get(serviceId);
    if (!service || service.archived) return null;
    const previous = planned.at(-1)?.staffId;
    const candidates = request.staffId
      ? [request.staffId]
      : [...request.stylistIds].sort((a, b) => Number(b === previous) - Number(a === previous));

    let placed: { item: BookedItem; resourceId: string | null } | null = null;
    for (const staffId of candidates) {
      const staff = ctx.staff.get(staffId);
      if (!staff?.isActive || !staff.serviceIds.has(serviceId)) continue;
      const draft: BookedItem = { ...timingFor(ctx, staffId, serviceId)!, serviceId, staffId, start: at };
      const resourceId = pickResource(ctx, draft, null, accepted, options);
      if (!resourceId && hasChairs) continue;
      const check = checkItem(ctx, { serviceId, staffId, resourceId, start: at }, accepted, options);
      if (check.valid) {
        placed = { item: check.item, resourceId };
        break;
      }
    }
    if (!placed) return null;
    accepted.push(placed.item);
    planned.push({ serviceId, staffId: placed.item.staffId, resourceId: placed.resourceId, start: at });
    at = itemEnd(placed.item);
  }
  return planned;
}

export type TimesOptions = CheckOptions & {
  // Nothing before this instant (now plus the salon's notice time).
  notBefore: Date;
  // Nothing starting after this instant (the end of the booking window).
  notAfter?: Date;
  step?: number;
};

// Every time on `date` the visit can start.
export function visitTimes(ctx: BookingContext, request: VisitRequest, date: LocalDate, options: TimesOptions): VisitTime[] {
  const step = options.step ?? ONLINE_STEP;
  const times: VisitTime[] = [];
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += step) {
    const start = fromLocal(date, minute, ctx.location.timeZone);
    if (!start || start < options.notBefore) continue;
    if (options.notAfter && start > options.notAfter) break;
    const items = planVisitAt(ctx, request, start, options);
    if (items) times.push({ minute, start, items });
  }
  return times;
}
