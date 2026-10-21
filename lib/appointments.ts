// Appointment statuses, what can be done to a visit in each, prices and
// visit totals. Pure, so the calendar's panels and the server share them.
// Whether a time can be booked is decided in lib/scheduling/booking.ts.

import type { Enums } from "@/lib/database.types";
import type { StaffRole } from "@/lib/staff";

export type AppointmentStatus = Enums<"appointment_status">;

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: "Booked",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  completed: "Checked out",
  canceled: "Canceled",
  no_show: "No-show",
};

export type AppointmentAction = "check_in" | "check_out" | "cancel" | "no_show";

export const ACTION_LABELS: Record<AppointmentAction, string> = {
  check_in: "Check in client",
  check_out: "Check out client",
  cancel: "Cancel booking",
  no_show: "Mark no-show",
};

export const ACTION_STATUS: Record<AppointmentAction, AppointmentStatus> = {
  check_in: "checked_in",
  check_out: "completed",
  cancel: "canceled",
  no_show: "no_show",
};

// Upcoming visits can be checked in, canceled or marked as a no-show; a
// client who's checked in can be checked out (payment comes later) or
// canceled. Checked-out, canceled and no-show visits are final.
const ALLOWED: Record<AppointmentStatus, AppointmentAction[]> = {
  booked: ["check_in", "cancel", "no_show"],
  confirmed: ["check_in", "cancel", "no_show"],
  checked_in: ["check_out", "cancel"],
  completed: [],
  canceled: [],
  no_show: [],
};

export function allowedActions(status: AppointmentStatus): AppointmentAction[] {
  return ALLOWED[status];
}

// Services, stylists and times can change until the visit is over.
export function isEditable(status: AppointmentStatus): boolean {
  return status === "booked" || status === "confirmed" || status === "checked_in";
}

const FRONT_OF_HOUSE: StaffRole[] = ["owner", "manager", "front_desk"];

// Who books, edits, moves and changes the status of appointments. Stylists
// can only edit notes on their own visits. The database enforces the same.
export function canBook(role: StaffRole): boolean {
  return FRONT_OF_HOUSE.includes(role);
}

export function canEditNotes(role: StaffRole, myStaffId: string, staffOnVisit: readonly string[]): boolean {
  return canBook(role) || staffOnVisit.includes(myStaffId);
}

export const CANCEL_REASONS = ["Client canceled", "Client rescheduled", "Client is sick", "Stylist unavailable", "Salon closed", "Other"];

// "Client canceled" plus optional detail -> "Client canceled: flight delayed".
// Null if there's no reason (Other needs detail).
export function cancelReason(reason: string, detail: string): string | null {
  const r = reason.trim();
  const d = detail.trim().slice(0, 300);
  if (!CANCEL_REASONS.includes(r)) return null;
  if (r === "Other") return d || null;
  return d ? `${r}: ${d}` : r;
}

export const MAX_NOTES = 2000;

// The stylist's price for a service, or the menu price.
export function priceFor(menuPriceCents: number, stylistPriceCents: number | null | undefined): number {
  return stylistPriceCents ?? menuPriceCents;
}

// From the first service's start to the last one's end, in minutes since
// midnight, and the total price.
export function visitSummary(lines: readonly { startMinute: number; minutes: number; priceCents: number }[]) {
  if (lines.length === 0) return null;
  const start = Math.min(...lines.map((l) => l.startMinute));
  const end = Math.max(...lines.map((l) => l.startMinute + l.minutes));
  return { start, end, minutes: end - start, priceCents: lines.reduce((sum, l) => sum + l.priceCents, 0) };
}
