// Booking rules: can this service be booked with this stylist, in this
// chair or room, at this time?
//
// The single source of truth for appointments; the calendar, online booking
// and the AI scheduler all check bookings here. Pure functions over data
// loaded by ./load.ts.
//
// An appointment item is valid when:
//   1. the service exists and is on the menu,
//   2. the stylist is active and offers that service,
//   3. it starts on a 5-minute mark,
//   4. the stylist is available for the whole item (./availability.ts:
//      salon open, on shift, no approved time off),
//   5. the stylist has no other client while they're busy with this one.
//      Processing time is free time: another client can be booked into it,
//      as long as that client's busy time fits in the gap, and
//   6. the resource, if any, isn't used by another item at any point,
//      processing included (the client is still in the chair).

import { isAvailable, type LocationSchedule, type StaffSchedule, type Unavailable } from "./availability.ts";
import type { TimeBlockKind } from "./blocks.ts";
import { toLocal } from "./time.ts";

const MINUTE_MS = 60_000;

export type ServiceTiming = { activeMinutes: number; processingMinutes: number; finishingMinutes: number };

// An item on the calendar, with the timing it was booked with.
export type BookedItem = ServiceTiming & {
  id?: string;
  appointmentId?: string;
  serviceId: string;
  staffId: string;
  resourceId?: string | null;
  start: Date;
};

export type SegmentKind = "active" | "processing" | "finishing";
export type Segment = { kind: SegmentKind; start: Date; end: Date };

export function durationMinutes(timing: ServiceTiming): number {
  return timing.activeMinutes + timing.processingMinutes + timing.finishingMinutes;
}

export function itemEnd(item: BookedItem): Date {
  return new Date(item.start.getTime() + durationMinutes(item) * MINUTE_MS);
}

// The item's parts in order, skipping empty ones.
export function itemSegments(item: BookedItem): Segment[] {
  const parts: [SegmentKind, number][] = [
    ["active", item.activeMinutes],
    ["processing", item.processingMinutes],
    ["finishing", item.finishingMinutes],
  ];
  const segments: Segment[] = [];
  let at = item.start.getTime();
  for (const [kind, minutes] of parts) {
    if (minutes <= 0) continue;
    segments.push({ kind, start: new Date(at), end: new Date(at + minutes * MINUTE_MS) });
    at += minutes * MINUTE_MS;
  }
  return segments;
}

type Span = { start: number; end: number }; // epoch ms, [start, end)

// When the stylist is with the client: everything but processing.
export function staffBusySpans(item: BookedItem): Span[] {
  return itemSegments(item)
    .filter((s) => s.kind !== "processing")
    .map((s) => ({ start: s.start.getTime(), end: s.end.getTime() }));
}

// When the resource is taken: the whole item.
function resourceSpan(item: BookedItem): Span {
  return { start: item.start.getTime(), end: itemEnd(item).getTime() };
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

export type BookingService = ServiceTiming & { id: string; archived: boolean };
export type BookingStaff = { id: string; isActive: boolean; schedule: StaffSchedule; serviceIds: ReadonlySet<string> };
export type ResourceKind = "chair" | "room" | "station";
export type BookingResource = { id: string; isActive: boolean; kind?: ResourceKind; sortOrder?: number };

// One day of a stylist's blocked time (lunch, a meeting…), as instants.
export type BlockedTime = { blockId: string; date: string; staffId: string; kind: TimeBlockKind; start: Date; end: Date; repeating?: boolean };

export type BookingContext = {
  location: LocationSchedule;
  services: ReadonlyMap<string, BookingService>;
  staff: ReadonlyMap<string, BookingStaff>;
  resources: ReadonlyMap<string, BookingResource>;
  // Items that hold time: from appointments that aren't canceled or no-shows.
  booked: readonly BookedItem[];
  // Blocked time: the stylist's busy time can't overlap it.
  blocks?: readonly BlockedTime[];
};

export type ItemRequest = {
  // Set when moving or changing an item that's already booked, so it
  // doesn't conflict with itself.
  id?: string;
  serviceId: string;
  staffId: string;
  resourceId?: string | null;
  start: Date;
  // For an item that's already booked and keeps its service: the timing it
  // was booked with, so menu changes since don't move it. Its service may
  // have been archived since; it can still be moved.
  timing?: ServiceTiming;
};

export type BookingProblem =
  | { code: "unknown_service" }
  | { code: "service_archived" }
  | { code: "unknown_staff" }
  | { code: "staff_inactive" }
  | { code: "service_not_offered" }
  | { code: "invalid_start" }
  | { code: "staff_unavailable"; reason: Unavailable }
  | { code: "staff_double_booked"; conflictWith?: string }
  | { code: "staff_blocked"; kind: TimeBlockKind; blockId: string; date: string }
  | { code: "unknown_resource" }
  | { code: "resource_inactive" }
  | { code: "resource_in_use"; conflictWith?: string }
  | { code: "no_free_resource" }
  | { code: "not_booked" };

export type ItemCheck = { valid: true; item: BookedItem } | { valid: false; problems: BookingProblem[] };

export type CheckOptions = {
  // Items of this appointment are ignored: it's being rebooked as a whole.
  replacingAppointmentId?: string;
};

// Checks one item against the calendar, plus `alsoBooking` (other items
// being booked at the same time). Returns every problem found.
export function checkItem(
  ctx: BookingContext,
  request: ItemRequest,
  alsoBooking: readonly BookedItem[] = [],
  options: CheckOptions = {},
): ItemCheck {
  const problems: BookingProblem[] = [];

  const service = ctx.services.get(request.serviceId);
  if (!service) problems.push({ code: "unknown_service" });
  else if (service.archived && !request.timing) problems.push({ code: "service_archived" });

  const staff = ctx.staff.get(request.staffId);
  if (!staff) problems.push({ code: "unknown_staff" });
  else if (!staff.isActive) problems.push({ code: "staff_inactive" });
  if (service && staff && !staff.serviceIds.has(service.id)) problems.push({ code: "service_not_offered" });

  if (request.start.getTime() % MINUTE_MS !== 0 || toLocal(request.start, ctx.location.timeZone).minute % 5 !== 0) {
    problems.push({ code: "invalid_start" });
  }

  if (request.resourceId != null) {
    const resource = ctx.resources.get(request.resourceId);
    if (!resource) problems.push({ code: "unknown_resource" });
    else if (!resource.isActive) problems.push({ code: "resource_inactive" });
  }

  // Without the service there's no timing to check against.
  if (!service) return { valid: false, problems };

  const timing = request.timing ?? service;
  const item: BookedItem = {
    id: request.id,
    serviceId: service.id,
    staffId: request.staffId,
    resourceId: request.resourceId ?? null,
    start: request.start,
    activeMinutes: timing.activeMinutes,
    processingMinutes: timing.processingMinutes,
    finishingMinutes: timing.finishingMinutes,
  };

  if (staff) {
    const availability = isAvailable(staff.schedule, ctx.location, item.start, durationMinutes(item));
    if (!availability.available) problems.push({ code: "staff_unavailable", reason: availability.reason });
  }

  const others = otherItems(ctx, request.id, alsoBooking, options);

  const busy = staffBusySpans(item);
  const staffConflict = others.find(
    (o) => o.staffId === item.staffId && staffBusySpans(o).some((s) => busy.some((b) => overlaps(s, b))),
  );
  if (staffConflict) problems.push({ code: "staff_double_booked", conflictWith: staffConflict.id });

  const block = (ctx.blocks ?? []).find((b) => b.staffId === item.staffId && busy.some((s) => overlaps(s, { start: b.start.getTime(), end: b.end.getTime() })));
  if (block) problems.push({ code: "staff_blocked", kind: block.kind, blockId: block.blockId, date: block.date });

  if (item.resourceId != null) {
    const span = resourceSpan(item);
    const resourceConflict = others.find((o) => o.resourceId === item.resourceId && overlaps(resourceSpan(o), span));
    if (resourceConflict) problems.push({ code: "resource_in_use", conflictWith: resourceConflict.id });
  }

  return problems.length ? { valid: false, problems } : { valid: true, item };
}

// Everything an item must not clash with: the calendar (minus the item's own
// booked copy) plus items being booked alongside it.
function otherItems(ctx: BookingContext, id: string | undefined, alsoBooking: readonly BookedItem[], options: CheckOptions): BookedItem[] {
  return [
    ...ctx.booked.filter(
      (b) =>
        (id === undefined || b.id !== id) &&
        (options.replacingAppointmentId === undefined || b.appointmentId !== options.replacingAppointmentId),
    ),
    ...alsoBooking,
  ];
}

// A free chair for an item: `preferred` if it's free, otherwise the first
// free active chair in the salon's order. Null if every chair is taken.
// Rooms and stations are only used when chosen.
export function pickResource(
  ctx: BookingContext,
  item: BookedItem,
  preferred: string | null = null,
  alsoBooking: readonly BookedItem[] = [],
  options: CheckOptions = {},
): string | null {
  const others = otherItems(ctx, item.id, alsoBooking, options);
  const span = resourceSpan(item);
  const isFree = (id: string) => ctx.resources.get(id)?.isActive && !others.some((o) => o.resourceId === id && overlaps(resourceSpan(o), span));

  if (preferred && isFree(preferred)) return preferred;
  const chairs = [...ctx.resources.values()]
    .filter((r) => r.kind === "chair")
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return chairs.find((r) => isFree(r.id))?.id ?? null;
}

// Checks the items of one appointment together: each against the calendar
// and against the items listed before it (e.g. a color with one stylist and
// a blow-dry with another straight after).
export function checkAppointment(
  ctx: BookingContext,
  requests: readonly ItemRequest[],
  options: CheckOptions = {},
): { valid: boolean; items: ItemCheck[] } {
  const accepted: BookedItem[] = [];
  const items = requests.map((request) => {
    const check = checkItem(ctx, request, accepted, options);
    if (check.valid) accepted.push(check.item);
    return check;
  });
  return { valid: items.length > 0 && items.every((c) => c.valid), items };
}

export type MoveRequest = { itemId: string; staffId: string; resourceId: string | null; start: Date };

// Checks moving several booked items at once (e.g. a fix that shifts two
// clients): each keeps its booked timing and is checked in its new place
// against the calendar without the moved items' old places, and against the
// moves before it. One list of problems per move, empty when it's fine.
export function checkMoves(ctx: BookingContext, moves: readonly MoveRequest[]): { valid: boolean; problems: BookingProblem[][] } {
  const ids = new Set(moves.map((m) => m.itemId));
  const calendar = { ...ctx, booked: ctx.booked.filter((b) => !b.id || !ids.has(b.id)) };
  const accepted: BookedItem[] = [];
  const problems = moves.map((m): BookingProblem[] => {
    const old = ctx.booked.find((b) => b.id === m.itemId);
    if (!old) return [{ code: "not_booked" }];
    const check = checkItem(
      calendar,
      { id: m.itemId, serviceId: old.serviceId, staffId: m.staffId, resourceId: m.resourceId, start: m.start, timing: old },
      accepted,
    );
    if (!check.valid) return check.problems;
    accepted.push({ ...check.item, appointmentId: old.appointmentId });
    return [];
  });
  return { valid: problems.every((p) => p.length === 0), problems };
}

const UNAVAILABLE_MESSAGES: Record<Unavailable, string> = {
  location_closed: "The salon is closed for part of this time.",
  not_working: "The stylist isn't working for all of this time.",
  time_off: "The stylist has time off then.",
  invalid_duration: "The service has no length.",
  crosses_midnight: "The appointment would run past midnight.",
};

const BLOCKED_MESSAGES: Record<TimeBlockKind, string> = {
  lunch: "The stylist is at lunch then.",
  break: "The stylist is on a break then.",
  training: "The stylist is in training then.",
  meeting: "The stylist is in a meeting then.",
  personal: "The stylist has blocked out that time.",
};

// A sentence for the front desk.
export function describeProblem(problem: BookingProblem): string {
  switch (problem.code) {
    case "unknown_service":
      return "That service doesn't exist.";
    case "service_archived":
      return "That service is no longer on the menu.";
    case "unknown_staff":
      return "That staff member isn't at this location.";
    case "staff_inactive":
      return "That staff member is no longer active.";
    case "service_not_offered":
      return "The stylist doesn't offer this service.";
    case "invalid_start":
      return "Appointments start on a 5-minute mark.";
    case "staff_unavailable":
      return UNAVAILABLE_MESSAGES[problem.reason];
    case "staff_double_booked":
      return "The stylist already has a client then.";
    case "staff_blocked":
      return BLOCKED_MESSAGES[problem.kind];
    case "unknown_resource":
      return "That chair or room doesn't exist.";
    case "resource_inactive":
      return "That chair or room is out of use.";
    case "resource_in_use":
      return "That chair or room is already in use then.";
    case "no_free_resource":
      return "Every chair is in use then.";
    case "not_booked":
      return "That appointment is no longer on the calendar.";
  }
}

// Booked items the stylist would be busy with during [start, end): what a
// block there would clash with (processing time doesn't).
export function busyDuring(ctx: BookingContext, staffId: string, start: Date, end: Date, also: readonly BookedItem[] = []): BookedItem[] {
  const span = { start: start.getTime(), end: end.getTime() };
  return [...ctx.booked, ...also].filter((b) => b.staffId === staffId && staffBusySpans(b).some((s) => overlaps(s, span)));
}
