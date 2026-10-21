import { fromLocal, isLocalDate } from "../../../scheduling/time.ts";
import type { IssueLog } from "../issues.ts";
import type { AppointmentRecord, AppointmentStatus } from "../model.ts";
import type { PhorestAppointment } from "../types.ts";
import { cents, localTimeToMinutes, text } from "./common.ts";

function status(a: PhorestAppointment): AppointmentStatus {
  if (a.activationState === "CANCELED") return "canceled";
  if (a.state === "PAID") return "completed";
  if (a.state === "CHECKED_IN") return "checked_in";
  return "booked";
}

// Phorest appointments are one service with one staff member; a booking
// groups them. Each booking becomes an Appointment with its services as
// items. Times are branch-local and become UTC instants.
export function mapAppointments(
  appointments: PhorestAppointment[],
  ctx: { locationExternalId: string; timeZone: string; staffIds: Set<string>; serviceIds: Set<string>; clientIds: Set<string> },
  log: IssueLog,
): AppointmentRecord[] {
  const bookings = new Map<string, AppointmentRecord>();

  for (const a of appointments) {
    const id = text(a.appointmentId);
    if (!id) {
      log.add("appointment", "appointmentId", "skipped", "missing");
      continue;
    }
    if (a.deleted) {
      log.add("appointment", "deleted", "skipped", "deleted in Phorest");
      continue;
    }
    const date = text(a.appointmentDate);
    const start = localTimeToMinutes(a.startTime);
    const end = localTimeToMinutes(a.endTime);
    if (!date || !isLocalDate(date) || start === null || end === null) {
      log.add("appointment", "appointmentDate/startTime/endTime", "skipped", "missing or invalid");
      continue;
    }
    if (end <= start) {
      log.add("appointment", "endTime", "skipped", "not after the start time");
      continue;
    }
    const startsAt = fromLocal(date, start, ctx.timeZone);
    const endsAt = fromLocal(date, end, ctx.timeZone);
    if (!startsAt || !endsAt) {
      log.add("appointment", "startTime/endTime", "skipped", "time doesn't exist (daylight saving change)");
      continue;
    }
    const staffId = text(a.staffId);
    if (!staffId || !ctx.staffIds.has(staffId)) {
      log.add("appointment", "staffId", "skipped", "staff member not imported");
      continue;
    }
    const serviceId = text(a.serviceId);
    if (!serviceId || !ctx.serviceIds.has(serviceId)) {
      log.add("appointment", "serviceId", "skipped", "service not imported");
      continue;
    }

    const bookingId = text(a.bookingId) ?? id;
    let booking = bookings.get(bookingId);
    if (!booking) {
      const clientId = text(a.clientId);
      if (clientId && !ctx.clientIds.has(clientId)) log.add("appointment", "clientId", "dropped", "client not imported (e.g. walk-in)");
      booking = {
        externalId: bookingId,
        locationExternalId: ctx.locationExternalId,
        clientExternalId: clientId && ctx.clientIds.has(clientId) ? clientId : null,
        status: status(a),
        source: text(a.source),
        deposit_cents: 0,
        notes: null,
        items: [],
      };
      bookings.set(bookingId, booking);
    }
    booking.deposit_cents += Math.max(0, cents(a.depositAmount) ?? 0);
    const note = text(a.notes);
    if (note) booking.notes = booking.notes ? `${booking.notes}\n${note}` : note;
    booking.items.push({
      externalId: id,
      serviceExternalId: serviceId,
      staffExternalId: staffId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      price_cents: Math.max(0, cents(a.price) ?? 0),
    });
  }

  return [...bookings.values()];
}
