"use server";

import { revalidatePath } from "next/cache";
import { ACTION_LABELS, canBook, cancelReason, MAX_NOTES, type AppointmentAction } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { searchClients } from "@/lib/client-search";
import { normalizePhone } from "@/lib/clients";
import { isUuid } from "@/lib/ids";
import { changeStatus, moveItem, saveBooking, saveNotes, type BookingItemInput, type SaveResult } from "@/lib/scheduling/book";
import { describeProblem } from "@/lib/scheduling/booking";
import { fromLocal, isLocalDate, MINUTES_PER_DAY, type LocalDate } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";

export type ClientOption = { id: string; name: string; phone: string | null; allergies: string | null };

const NOT_ALLOWED = "Only owners, managers and front desk can book and change appointments.";

function refresh() {
  revalidatePath("/calendar", "layout");
}

export async function findClients(query: string): Promise<ClientOption[]> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role) || query.trim().length < 2) return [];
  const { clients } = await searchClients(supabase, me.business_id, query.slice(0, 100), 8);
  return clients.map((c) => ({ id: c.id, name: fullName(c), phone: c.phone, allergies: c.allergies }));
}

export type QuickAddResult = { ok: true; client: ClientOption } | { ok: false; errors: { first_name?: string; phone?: string; form?: string } };

// A new client from the booking panel: name and phone only. The rest can be
// filled in on their profile later.
export async function quickAddClient(input: { firstName: string; lastName: string; phone: string }): Promise<QuickAddResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, errors: { form: NOT_ALLOWED } };

  const first_name = input.firstName.trim().slice(0, 100);
  const last_name = input.lastName.trim().slice(0, 100);
  const phone = normalizePhone(input.phone);
  const errors: { first_name?: string; phone?: string } = {};
  if (!first_name) errors.first_name = "Enter a first name.";
  if (!phone) errors.phone = "Enter a 10-digit phone number.";
  if (errors.first_name || errors.phone) return { ok: false, errors };

  const { data, error } = await supabase
    .from("clients")
    .insert({ business_id: me.business_id, first_name, last_name, phone })
    .select("id, first_name, last_name, phone, allergies")
    .single();
  if (error?.code === "42501") return { ok: false, errors: { form: NOT_ALLOWED } };
  if (error) throw error;
  return { ok: true, client: { id: data.id, name: fullName(data), phone: data.phone, allergies: data.allergies } };
}

export type VisitLineInput = {
  id?: string;
  serviceId: string;
  staffId: string;
  startMinute: number;
  // "any" for any free chair, "none" for no chair, or a resource id.
  resource: string;
};

export type VisitInput = {
  appointmentId?: string;
  date: LocalDate;
  clientId: string | null;
  notes: string;
  lines: VisitLineInput[];
};

export type SaveVisitResult =
  | { ok: true; appointmentId: string }
  | { ok: false; message: string; lineErrors?: string[][] };

function saveErrorMessage(result: Exclude<SaveResult, { ok: true }>): string {
  switch (result.error) {
    case "invalid":
      return "This can't be booked as it is. See the highlighted services.";
    case "no_items":
      return "Add at least one service.";
    case "not_found":
      return "That appointment, client, stylist or service no longer exists. Reload and try again.";
    case "not_editable":
      return "This appointment is finished or canceled, so it can't be changed.";
    case "forbidden":
      return NOT_ALLOWED;
    case "busy":
      return "The calendar kept changing while saving. Try again.";
  }
}

export async function saveVisit(input: VisitInput): Promise<SaveVisitResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };

  if (!isLocalDate(input.date)) return { ok: false, message: "Choose a date." };
  if (!input.clientId || !isUuid(input.clientId)) return { ok: false, message: "Choose a client, or add a new one." };
  if (input.appointmentId && !isUuid(input.appointmentId)) return { ok: false, message: "That appointment no longer exists." };
  if (input.notes.length > MAX_NOTES) return { ok: false, message: "Keep notes under 2,000 characters." };
  if (input.lines.length === 0) return { ok: false, message: "Add at least one service." };

  const lineErrors: string[][] = input.lines.map(() => []);
  const items: BookingItemInput[] = [];
  input.lines.forEach((line, n) => {
    if (!isUuid(line.serviceId)) lineErrors[n].push("Choose a service.");
    if (!isUuid(line.staffId)) lineErrors[n].push("Choose a stylist.");
    if (line.id && !isUuid(line.id)) lineErrors[n].push("This service is no longer on the appointment.");
    const valid = Number.isInteger(line.startMinute) && line.startMinute >= 0 && line.startMinute < MINUTES_PER_DAY;
    const start = valid ? fromLocal(input.date, line.startMinute, me.location.timezone) : null;
    if (!start) lineErrors[n].push("Choose a start time.");
    const resource =
      line.resource === "any" ? ({ kind: "any" } as const) : line.resource === "none" ? ({ kind: "none" } as const) : ({ kind: "exact", id: line.resource } as const);
    if (resource.kind === "exact" && !isUuid(resource.id)) lineErrors[n].push("Choose a chair.");
    if (start) items.push({ id: line.id, serviceId: line.serviceId, staffId: line.staffId, start, resource });
  });
  if (lineErrors.some((e) => e.length)) return { ok: false, message: "Fill in each service.", lineErrors };

  const result = await saveBooking(supabase, me.location, {
    appointmentId: input.appointmentId,
    clientId: input.clientId,
    notes: input.notes,
    items,
  });
  if (!result.ok) {
    return {
      ok: false,
      message: saveErrorMessage(result),
      lineErrors: result.error === "invalid" ? result.problems.map((p) => p.map(describeProblem)) : undefined,
    };
  }
  refresh();
  return { ok: true, appointmentId: result.appointmentId };
}

export type MoveResult = { ok: true } | { ok: false; message: string };

export async function moveVisitItem(input: { itemId: string; staffId: string; date: LocalDate; startMinute: number }): Promise<MoveResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.itemId) || !isUuid(input.staffId) || !isLocalDate(input.date)) return { ok: false, message: "That move isn't possible." };
  const start = Number.isInteger(input.startMinute) ? fromLocal(input.date, input.startMinute, me.location.timezone) : null;
  if (!start) return { ok: false, message: "That time doesn't exist." };

  const result = await moveItem(supabase, me.location, { itemId: input.itemId, staffId: input.staffId, start });
  if (!result.ok) {
    if (result.error === "invalid") return { ok: false, message: [...new Set(result.problems.flat().map(describeProblem))].join(" ") };
    return { ok: false, message: saveErrorMessage(result) };
  }
  refresh();
  return { ok: true };
}

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function changeVisitStatus(
  appointmentId: string,
  action: AppointmentAction,
  reason = "",
  detail = "",
): Promise<ActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(appointmentId) || !(action in ACTION_LABELS)) return { ok: false, message: "That appointment no longer exists." };

  let why: string | null = null;
  if (action === "cancel") {
    why = cancelReason(reason, detail);
    if (!why) return { ok: false, message: reason === "Other" ? "Say why it was canceled." : "Choose a reason." };
  }

  const result = await changeStatus(supabase, appointmentId, action, why);
  if (!result.ok) {
    const messages = {
      not_found: "That appointment no longer exists.",
      not_allowed: `This appointment can't be changed that way any more.`,
      needs_reason: "Choose a reason.",
      forbidden: NOT_ALLOWED,
    };
    return { ok: false, message: messages[result.error] };
  }
  refresh();
  return { ok: true };
}

export async function saveVisitNotes(appointmentId: string, notes: string): Promise<ActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { ok: false, message: "Sign in again." };
  if (!isUuid(appointmentId)) return { ok: false, message: "That appointment no longer exists." };
  if (notes.length > MAX_NOTES) return { ok: false, message: "Keep notes under 2,000 characters." };

  const result = await saveNotes(supabase, appointmentId, notes);
  if (!result.ok) return { ok: false, message: "You can only edit notes on your own appointments." };
  refresh();
  return { ok: true };
}
