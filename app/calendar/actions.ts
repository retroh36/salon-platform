"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { recomputeForVisit } from "@/lib/insights/compute";
import { formatDuration } from "@/lib/duration";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTION_LABELS, canBook, cancelReason, MAX_NOTES, type AppointmentAction } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { visitWarnings } from "@/lib/client-checks";
import { searchClients } from "@/lib/client-search";
import { normalizePhone } from "@/lib/clients";
import { describeUsage, parseUsageLines } from "@/lib/color-usage";
import { isUuid } from "@/lib/ids";
import { isZoom, type CalendarZoom } from "@/lib/calendar";
import { isUsable, loadClientPackages, type ClientPackage } from "@/lib/packages";
import { loadBackBarProducts } from "@/lib/inventory-load";
import { changeStatus, checkInPatchOverride, moveItem, saveBooking, saveNotes, undoCheckIn, undoNoShow, type BookingItemInput, type SaveResult, type VisitSeen } from "@/lib/scheduling/book";
import { describeProblem, type BookingProblem } from "@/lib/scheduling/booking";
import { bookingIdeas, type BookingIdeas } from "@/lib/denise/ideas";
import { loadBookingContext, loadCalendarStamp } from "@/lib/scheduling/load";
import { MAX_VISITS, planSeries, seriesDates, type Scope, type SeriesEnd } from "@/lib/scheduling/series";
import { bookSeries, changeSeries, changeSeriesStatus, moveSeriesItem, type VisitResult } from "@/lib/scheduling/series-book";
import { bookGroup, changeGroupStatus, moveGroupItem } from "@/lib/scheduling/group-book";
import { moveVisitTo } from "@/lib/scheduling/move-day";
import { recordMoveNotices, snapshotVisits } from "@/lib/move-notices";
import { MAX_GUESTS } from "@/lib/scheduling/groups";
import { formatDay } from "@/lib/schedule-format";
import { addDays, daysBetween, formatMinute, fromLocal, isLocalDate, MINUTES_PER_DAY, toLocal, todayIn, type LocalDate } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import type { TimeEvent } from "@/lib/visit-times";
import { repeatOffenderNote } from "@/lib/policy";
import { clientStanding, loadPolicy } from "@/lib/policy-load";

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
  // This booking's own length, e.g. the stylist's usual time.
  minutes?: number;
};

export type VisitInput = {
  appointmentId?: string;
  date: LocalDate;
  clientId: string | null;
  notes: string;
  lines: VisitLineInput[];
  // An edit: the visit as it was when the panel opened.
  seen?: { date: LocalDate; notes: string; items: { id: string; serviceId: string; staffId: string; startMinute: number }[] };
};

export type SaveVisitResult =
  | { ok: true; appointmentId: string }
  // ideas: Denise's nearest times that work, when the rules refused a time.
  | { ok: false; message: string; lineErrors?: string[][]; ideas?: BookingIdeas | null };

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
    case "changed":
      return "Someone else changed this visit while you had it open, so your edit wasn't saved. Close it and open it again to see their change, then make yours.";
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
    const minutes = line.minutes;
    if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 5 || minutes > 480 || minutes % 5 !== 0)) lineErrors[n].push("Choose a length in 5-minute steps.");
    if (start) items.push({ id: line.id, serviceId: line.serviceId, staffId: line.staffId, start, resource, minutes });
  });
  if (lineErrors.some((e) => e.length)) return { ok: false, message: "Fill in each service.", lineErrors };

  // A group guest's day changes with the whole group.
  if (input.appointmentId) {
    const { data: was } = await supabase.from("appointments").select("group_id, starts_at").eq("id", input.appointmentId).maybeSingle();
    if (was?.group_id && toLocal(new Date(was.starts_at), me.location.timezone).date !== input.date) {
      return { ok: false, message: "A group moves together: use Move to another day in ⋯ to move everyone." };
    }
  }

  const result = await withNotices(supabase, me.location, input.appointmentId ?? null, () =>
    saveBooking(supabase, me.location, {
      appointmentId: input.appointmentId,
      clientId: input.clientId,
      notes: input.notes,
      items,
      seen: seenVisit(input.seen, me.location.timezone),
    }),
  );
  if (!result.ok) {
    return {
      ok: false,
      message: saveErrorMessage(result),
      lineErrors: result.error === "invalid" ? result.problems.map((p) => p.map(describeProblem)) : undefined,
      ideas: result.error === "invalid" ? await ideasFor(supabase, me.location, input, result.problems) : null,
    };
  }
  refresh();
  return { ok: true, appointmentId: result.appointmentId };
}

// What the editor saw, as instants (nothing to compare if it's unreadable).
function seenVisit(seen: VisitInput["seen"], timezone: string): VisitSeen | undefined {
  if (!seen || !isLocalDate(seen.date) || !Array.isArray(seen.items)) return undefined;
  const items = seen.items.map((i) => ({ id: i.id, serviceId: i.serviceId, staffId: i.staffId, start: fromLocal(seen.date, i.startMinute, timezone) }));
  if (items.some((i) => !i.start)) return undefined;
  return { notes: seen.notes, items: items as VisitSeen["items"] };
}

// Denise's nearest times that work, for a refused booking. Never fails the
// save's answer: without them, the rule's message still shows.
async function ideasFor(supabase: Awaited<ReturnType<typeof getCurrentStaff>>["supabase"], location: { id: string; timezone: string }, input: VisitInput, problems: BookingProblem[][]) {
  try {
    const [ctx, { data: staff }] = await Promise.all([loadBookingContext(supabase, location, input.date, input.date), supabase.from("staff").select("id, first_name")]);
    const today = todayIn(location.timezone);
    return bookingIdeas(ctx, input.date, input.lines, problems, new Map((staff ?? []).map((s) => [s.id, s.first_name])), input.date === today ? new Date() : undefined);
  } catch (error) {
    console.error("Denise couldn't suggest times:", error);
    return null;
  }
}

export type MoveResult = { ok: true } | { ok: false; message: string };

type Supabase = Awaited<ReturnType<typeof getCurrentStaff>>["supabase"];

// The visits a change to this one can move: it, and the rest of its series
// or group still to come.
async function relatedVisits(supabase: Supabase, appointmentId: string): Promise<string[]> {
  const { data: a } = await supabase.from("appointments").select("id, series_id, group_id").eq("id", appointmentId).maybeSingle();
  if (!a) return [];
  if (!a.series_id && !a.group_id) return [a.id];
  const column = a.series_id ? "series_id" : "group_id";
  const { data } = await supabase.from("appointments").select("id").eq(column, (a.series_id ?? a.group_id)!).in("status", ["booked", "confirmed"]);
  return [...new Set([a.id, ...(data ?? []).map((r) => r.id)])];
}

const visitOfItem = async (supabase: Supabase, itemId: string) => (await supabase.from("appointment_items").select("appointment_id").eq("id", itemId).maybeSingle()).data?.appointment_id ?? null;

// Makes a change, then records a notice to the client and each stylist for
// every visit whose day, time or stylist it changed (like Denise's fixes).
async function withNotices<T>(supabase: Supabase, location: { timezone: string }, appointmentId: string | null, change: () => Promise<T>): Promise<T> {
  if (!appointmentId) return change();
  const before = await snapshotVisits(supabase, await relatedVisits(supabase, appointmentId), location.timezone);
  const result = await change();
  await recordMoveNotices(supabase, location, before);
  return result;
}

export async function moveVisitItem(input: { itemId: string; staffId: string; date: LocalDate; startMinute: number }): Promise<MoveResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.itemId) || !isUuid(input.staffId) || !isLocalDate(input.date)) return { ok: false, message: "That move isn't possible." };
  const start = Number.isInteger(input.startMinute) ? fromLocal(input.date, input.startMinute, me.location.timezone) : null;
  if (!start) return { ok: false, message: "That time doesn't exist." };

  const result = await withNotices(supabase, me.location, await visitOfItem(supabase, input.itemId), () => moveItem(supabase, me.location, { itemId: input.itemId, staffId: input.staffId, start }));
  if (!result.ok) {
    if (result.error === "invalid") return { ok: false, message: [...new Set(result.problems.flat().map(describeProblem))].join(" ") };
    return { ok: false, message: saveErrorMessage(result) };
  }
  refresh();
  return { ok: true };
}

export type MoveDayResult = { ok: true; message: string } | { ok: false; message: string; ideas?: BookingIdeas | null };

// Moves a visit to another day and/or start time, every service together
// (a repeating visit: this one, this and following, or all; a group: the
// whole party). The booking rules check each; notices go to the client and
// stylists.
export async function moveVisitToDay(input: { appointmentId: string; date: LocalDate; startMinute: number }, scope: Scope = "this"): Promise<MoveDayResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.appointmentId)) return { ok: false, message: "That appointment no longer exists." };
  if (!isLocalDate(input.date)) return { ok: false, message: "Choose a date." };
  if (!Number.isInteger(input.startMinute) || input.startMinute < 0 || input.startMinute >= MINUTES_PER_DAY) return { ok: false, message: "Choose a start time." };
  if (!["this", "following", "all"].includes(scope)) return { ok: false, message: "Choose which visits to move." };
  const today = todayIn(me.location.timezone);
  if (input.date < today) return { ok: false, message: "Choose today or a later day." };

  const moved = await withNotices(supabase, me.location, input.appointmentId, () => moveVisitTo(supabase, me.location, input, scope));
  refresh();
  const when = `${formatDay(input.date)} at ${formatMinute(input.startMinute)}`;
  switch (moved.kind) {
    case "error":
      return {
        ok: false,
        message:
          moved.error === "not_movable" ? "Only visits still to come can move to another day. A checked-in visit stays where it is." : moved.error === "invalid_time" ? "That time doesn't exist that day." : "That appointment no longer exists.",
      };
    case "group":
      if (moved.result.ok) return { ok: true, message: `Moved the whole group (${moved.result.moved} guest${moved.result.moved === 1 ? "" : "s"}) to ${when}.` };
      if (moved.result.error === "invalid") {
        const problem = moved.result.problems?.flat()[0];
        return { ok: false, message: `The whole group doesn't fit then${problem ? `: ${describeProblem(problem)}` : "."} Nothing was moved.` };
      }
      return { ok: false, message: moved.result.error === "taken" ? "Someone changed the calendar at the same moment. Nothing was moved; try again." : "That visit is no longer in a group." };
    case "series": {
      const summary = scopeSummary(moved.results, "move");
      return summary.ok ? { ok: true, message: summary.message ?? `Moved to ${when}.` } : { ok: false, message: summary.message };
    }
    case "single": {
      const r = moved.result;
      if (r.ok) return { ok: true, message: `Moved to ${when}.` };
      if (r.error !== "invalid") return { ok: false, message: saveErrorMessage(r) };
      // Why, and Denise's nearest times that work that day.
      const { data: items } = await supabase.from("appointment_items").select("service_id, staff_id, starts_at").eq("appointment_id", input.appointmentId).order("starts_at");
      const first = items?.length ? toLocal(new Date(items[0].starts_at), me.location.timezone).minute : input.startMinute;
      const lines = (items ?? []).map((i) => ({ serviceId: i.service_id, staffId: i.staff_id, startMinute: toLocal(new Date(i.starts_at), me.location.timezone).minute - first + input.startMinute, resource: "any" }));
      return {
        ok: false,
        message: `That doesn't fit on ${formatDay(input.date)}: ${[...new Set(r.problems.flat().map(describeProblem))].join(" ")}`,
        ideas: await ideasFor(supabase, me.location, { date: input.date, clientId: null, notes: "", lines }, r.problems),
      };
    }
  }
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
    if (result.error === "patch_test") return { ok: false, message: result.message };
    const messages = {
      not_found: "That appointment no longer exists.",
      not_allowed: `This appointment can't be changed that way any more.`,
      needs_reason: "Choose a reason.",
      forbidden: NOT_ALLOWED,
    };
    return { ok: false, message: messages[result.error] };
  }
  // Denise learns from the visit once the response has gone.
  if (action === "check_out") after(() => recomputeForVisit(createAdminClient(), appointmentId));
  // No reload of the calendar here: it shows the change at once and loads
  // the day again in the background (setStatusNow in board.tsx), so the
  // answer comes back as soon as it's saved.
  return { ok: true };
}

// Remembers how tall this person likes the calendar.
export async function saveCalendarZoom(zoom: CalendarZoom): Promise<void> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isZoom(zoom)) return;
  const { error } = await supabase.rpc("set_calendar_zoom", { p_zoom: zoom });
  if (error) throw error;
}

// Takes back a check-in made by mistake (front of house).
export async function undoVisitCheckIn(appointmentId: string): Promise<ActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(appointmentId)) return { ok: false, message: "That appointment no longer exists." };
  const result = await undoCheckIn(supabase, appointmentId);
  if (!result.ok) {
    if (result.error === "patch_test") return { ok: false, message: result.message };
    const messages = {
      not_found: "That appointment no longer exists.",
      not_allowed: "Only a checked-in visit can go back to booked. After checkout, void the sale instead.",
      needs_reason: "",
      forbidden: NOT_ALLOWED,
    };
    return { ok: false, message: messages[result.error] };
  }
  // Shown at once on the calendar, which reloads in the background.
  return { ok: true };
}

// Takes back a no-show (front of house), if the time is still free.
export async function undoVisitNoShow(appointmentId: string): Promise<ActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(appointmentId)) return { ok: false, message: "That appointment no longer exists." };
  const result = await undoNoShow(supabase, me.location, appointmentId);
  if (!result.ok) {
    if (result.error === "invalid") return { ok: false, message: `That time isn't free any more: ${[...new Set(result.problems.map(describeProblem))].join(" ")} Book them again instead.` };
    if (result.error === "patch_test") return { ok: false, message: result.message };
    const messages = {
      not_found: "That appointment no longer exists.",
      not_allowed: "Only a no-show can be taken back.",
      needs_reason: "",
      forbidden: NOT_ALLOWED,
      busy: "The calendar is busy. Try again.",
    };
    return { ok: false, message: messages[result.error] };
  }
  // Shown at once on the calendar, which reloads in the background.
  return { ok: true };
}

// A manager or owner checks a client in without the patch test the salon
// requires, with a reason (kept in the visit's history).
export async function checkInWithPatchOverride(appointmentId: string, reason: string): Promise<ActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || (me.role !== "owner" && me.role !== "manager")) return { ok: false, message: "Only a manager or owner can check a client in without the patch test." };
  if (!isUuid(appointmentId)) return { ok: false, message: "That appointment no longer exists." };
  const result = await checkInPatchOverride(supabase, appointmentId, reason);
  if (!result.ok) {
    const messages = {
      not_found: "That appointment no longer exists.",
      not_allowed: "This visit is already checked in or over.",
      needs_reason: "Say why (up to 300 characters).",
      forbidden: "Only a manager or owner can check a client in without the patch test.",
      patch_test: "",
    };
    return { ok: false, message: messages[result.error] };
  }
  // Shown at once on the calendar, which reloads in the background.
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

// A formula for a service on this visit, with the products used. If the
// visit is already checked out, stock is put right straight away.
export async function addVisitFormula(input: { itemId: string; date: LocalDate; formula: string; notes: string; lines: string }): Promise<ActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { ok: false, message: "Sign in again." };
  if (!isUuid(input.itemId) || !isLocalDate(input.date)) return { ok: false, message: "That service is no longer on the visit." };
  if (input.date > todayIn(me.location.timezone)) return { ok: false, message: "Record the formula on the day of the visit." };

  const { data: item, error: itemError } = await supabase.from("appointment_items").select("staff_id, appointment:appointments(client_id)").eq("id", input.itemId).maybeSingle();
  if (itemError) throw itemError;
  if (!item?.appointment.client_id) return { ok: false, message: "Formulas are kept on a client's record; this visit has no client." };

  const products = new Map((await loadBackBarProducts(supabase)).map((p) => [p.id, p]));
  const lines = parseUsageLines(input.lines, products);
  if (!lines.ok) return { ok: false, message: lines.error };
  const text = input.formula.trim() || describeUsage(lines.lines, products);
  if (!text) return { ok: false, message: "Add the products used, or write the formula." };
  if (text.length > 2000 || input.notes.length > 500) return { ok: false, message: "Keep the formula under 2,000 characters." };

  const { error } = await supabase.rpc("add_formula", {
    p_client_id: item.appointment.client_id,
    p_appointment_item_id: input.itemId,
    p_visit_date: input.date,
    p_formula: text,
    p_notes: input.notes,
    p_lines: lines.lines.map((l) => ({ product_id: l.productId, amount: l.amount })),
  });
  if (error?.code === "42501") return { ok: false, message: "You don't have permission to add formulas." };
  if (error?.code === "22023") return { ok: false, message: "Formulas use back-bar products." };
  if (error) throw error;
  refresh();
  revalidatePath("/inventory", "layout");
  revalidatePath(`/clients/${item.appointment.client_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Recurring appointments
// ---------------------------------------------------------------------------

export type RepeatInput = { intervalWeeks: number; end: SeriesEnd };

export type SeriesPreviewVisit = {
  date: LocalDate;
  label: string;
  ok: boolean;
  problems: string[];
  // Denise's suggestions for a visit that doesn't fit.
  alternatives: { label: string; date: LocalDate; lines: VisitLineInput[] }[];
};

function readRepeat(repeat: RepeatInput, first: LocalDate): string | null {
  if (!Number.isInteger(repeat.intervalWeeks) || repeat.intervalWeeks < 1 || repeat.intervalWeeks > 52) return "Repeat every 1 to 52 weeks.";
  if (repeat.end.kind === "count" && (!Number.isInteger(repeat.end.count) || repeat.end.count < 2 || repeat.end.count > MAX_VISITS)) return `A series has 2 to ${MAX_VISITS} visits.`;
  if (repeat.end.kind === "until" && (!isLocalDate(repeat.end.until) || repeat.end.until <= first)) return "End after the first visit.";
  return null;
}

// Each line with the item it was (on an edit) and its own length, if set.
const toLines = (lines: VisitLineInput[]) =>
  lines.map(({ id, serviceId, staffId, startMinute, resource, minutes }) => ({
    serviceId,
    staffId,
    startMinute,
    resource,
    ...(id && isUuid(id) ? { itemId: id } : {}),
    ...(Number.isInteger(minutes) && minutes! > 0 ? { minutes } : {}),
  }));

// Every visit of a series, checked against the booking rules, with
// suggestions for the ones that don't fit. Nothing is saved.
export async function previewSeries(input: VisitInput, repeat: RepeatInput): Promise<{ ok: true; visits: SeriesPreviewVisit[] } | { ok: false; message: string }> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isLocalDate(input.date) || !input.lines.length) return { ok: false, message: "Add at least one service." };
  const bad = readRepeat(repeat, input.date);
  if (bad) return { ok: false, message: bad };

  const dates = seriesDates(input.date, repeat.intervalWeeks, repeat.end);
  const ctx = await loadBookingContext(supabase, me.location, addDays(dates[0], -3), addDays(dates.at(-1)!, 3));
  const lines = toLines(input.lines);
  const { data: staff } = await supabase.from("staff").select("id, first_name");
  const staffName = new Map((staff ?? []).map((s) => [s.id, s.first_name]));
  const firstStart = Math.min(...lines.map((l) => l.startMinute));

  const visits = planSeries(ctx, lines, dates).map((v): SeriesPreviewVisit => ({
    date: v.date,
    label: formatDay(v.date),
    ok: v.check.ok,
    problems: [...new Set(v.check.problems.flat().map(describeProblem))],
    alternatives: v.alternatives.map((a) => {
      const start = formatMinute(Math.min(...a.lines.map((l) => l.startMinute)));
      const label =
        a.kind === "time"
          ? `Same day at ${start} (${a.shift > 0 ? `${formatDuration(a.shift)} later` : `${formatDuration(-a.shift)} earlier`})`
          : a.kind === "stylist"
            ? `With ${[...new Set(a.lines.filter((l, i) => l.staffId !== lines[i].staffId).map((l) => staffName.get(l.staffId)))].join(" and ")} at ${formatMinute(firstStart)}`
            : `${formatDay(a.date)} at ${formatMinute(firstStart)}`;
      return { label, date: a.date, lines: a.lines.map((l) => ({ ...l })) };
    }),
  }));
  return { ok: true, visits };
}

export type SeriesSaveResult = { ok: true; appointmentId: string; message: string } | { ok: false; message: string };

// Books the series: each visit as staff chose (as planned, an alternative,
// or skipped), each checked again as it's saved.
export async function saveSeries(input: VisitInput, repeat: RepeatInput, visits: { date: LocalDate; lines: VisitLineInput[] }[]): Promise<SeriesSaveResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!input.clientId || !isUuid(input.clientId)) return { ok: false, message: "Choose a client, or add a new one." };
  const bad = readRepeat(repeat, input.date);
  if (bad) return { ok: false, message: bad };
  if (!visits.length || visits.length > MAX_VISITS || visits.some((v) => !isLocalDate(v.date) || !v.lines.length)) return { ok: false, message: "Choose at least one visit." };
  if (visits.some((v) => v.lines.some((l) => !isUuid(l.serviceId) || !isUuid(l.staffId) || !Number.isInteger(l.startMinute)))) return { ok: false, message: "Fill in each service." };

  const { results } = await bookSeries(supabase, { ...me.location, businessId: me.business_id }, {
    clientId: input.clientId,
    notes: input.notes.trim() || null,
    intervalWeeks: repeat.intervalWeeks,
    end: repeat.end,
    visits: visits.map((v) => ({ date: v.date, lines: toLines(v.lines) })),
  });
  const failed = results.filter((r): r is Extract<VisitResult, { ok: false }> => !r.ok);
  if (failed.some((f) => f.error === "forbidden")) return { ok: false, message: NOT_ALLOWED };
  if (failed.length) return { ok: false, message: `Nothing was booked: ${notFitting(failed)} Check the times and try again.` };
  refresh();
  const first = results.find((r) => r.ok && r.date === input.date) ?? results[0];
  return { ok: true, appointmentId: (first as { appointmentId: string }).appointmentId, message: `Booked ${results.length} visit${results.length === 1 ? "" : "s"}.` };
}

// The visits that stopped a series change, with why ("held back" ones fit).
function notFitting(failed: Extract<VisitResult, { ok: false }>[]): string {
  const stopped = failed.filter((f) => f.error !== "held_back");
  if (!stopped.length) return "the calendar changed at the same moment.";
  return `${stopped
    .map((f) => `${formatDay(f.date)} ${f.problems ? `doesn't fit (${[...new Set(f.problems.flat().map(describeProblem))].join(" ").replace(/\.$/, "")})` : "couldn't be saved"}`)
    .join("; ")}.`;
}

// Every visit in scope changes, or none does.
function scopeSummary(results: VisitResult[], what: string): SaveVisitResult & { message?: string } {
  const failed = results.filter((r): r is Extract<VisitResult, { ok: false }> => !r.ok);
  if (!results.length) return { ok: false, message: `Couldn't ${what} any visits.` };
  if (failed.length) return { ok: false, message: `Nothing was changed: ${notFitting(failed)}` };
  return { ok: true, appointmentId: (results[0] as { appointmentId: string }).appointmentId, message: `Changed ${results.length} visit${results.length === 1 ? "" : "s"}.` };
}

// Saves an edit to a series visit: this visit, this and following, or all.
export async function saveVisitScoped(input: VisitInput, scope: Scope): Promise<SaveVisitResult & { message?: string }> {
  if (scope === "this" || !input.appointmentId) return saveVisit(input);
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.appointmentId) || !input.clientId || !isUuid(input.clientId)) return { ok: false, message: "Choose a client." };
  if (!isLocalDate(input.date)) return { ok: false, message: "Choose a date." };
  // A new date moves each visit in scope by the same number of days.
  const { data: was } = await supabase.from("appointments").select("starts_at").eq("id", input.appointmentId).maybeSingle();
  const days = was ? daysBetween(toLocal(new Date(was.starts_at), me.location.timezone).date, input.date) : 0;
  const appointmentId = input.appointmentId;
  const results = await withNotices(supabase, me.location, appointmentId, () =>
    changeSeries(supabase, me.location, appointmentId, scope, { clientId: input.clientId!, notes: input.notes.trim() || null, lines: toLines(input.lines) }, days),
  );
  refresh();
  return scopeSummary(results, "change");
}

// Drag-moves a series visit's service: this visit, this and following, or all.
export async function moveVisitItemScoped(input: { itemId: string; staffId: string; date: LocalDate; startMinute: number }, scope: Scope): Promise<MoveResult & { message?: string }> {
  if (scope === "this") return moveVisitItem(input);
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.itemId) || !isUuid(input.staffId) || !isLocalDate(input.date)) return { ok: false, message: "That move isn't possible." };
  const start = fromLocal(input.date, input.startMinute, me.location.timezone);
  if (!start) return { ok: false, message: "That time doesn't exist." };
  const results = await withNotices(supabase, me.location, await visitOfItem(supabase, input.itemId), () => moveSeriesItem(supabase, me.location, { itemId: input.itemId, staffId: input.staffId, start }, scope));
  refresh();
  const summary = scopeSummary(results, "move");
  return summary.ok ? { ok: true, message: summary.message } : { ok: false, message: summary.message };
}

// Cancels or marks a series visit: this one, this and following, or all.
export async function changeVisitStatusScoped(appointmentId: string, action: AppointmentAction, scope: Scope, reason = "", detail = ""): Promise<ActionResult & { message?: string }> {
  if (scope === "this") {
    const result = await changeVisitStatus(appointmentId, action, reason, detail);
    refresh();
    return result;
  }
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(appointmentId) || !(action in ACTION_LABELS)) return { ok: false, message: "That appointment no longer exists." };
  let why: string | null = null;
  if (action === "cancel") {
    why = cancelReason(reason, detail);
    if (!why) return { ok: false, message: reason === "Other" ? "Say why it was canceled." : "Choose a reason." };
  }
  const results = await changeSeriesStatus(supabase, appointmentId, scope, action, why, me.location.timezone);
  refresh();
  const done = results.filter((r) => r.result.ok).length;
  return done ? { ok: true, message: `${done} visit${done === 1 ? "" : "s"} ${action === "cancel" ? "canceled" : "updated"}.` } : { ok: false, message: "No visits could be changed." };
}

// Patch test warnings for a booking being made: which services need one the
// client doesn't have, and whether the salon blocks the booking.
export async function patchTestWarnings(clientId: string, date: LocalDate, lines: { serviceId: string; startMinute: number }[]): Promise<{ messages: string[]; blocks: boolean }> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(clientId) || !isLocalDate(date)) return { messages: [], blocks: false };
  const items = lines.flatMap((l) => {
    const start = isUuid(l.serviceId) ? fromLocal(date, l.startMinute, me.location.timezone) : null;
    return start ? [{ serviceId: l.serviceId, start }] : [];
  });
  if (!items.length) return { messages: [], blocks: false };
  const warnings = (await visitWarnings(supabase, me.business_id, [{ appointmentId: "new", clientId, start: items[0].start, items }])).get("new");
  return { messages: warnings?.patch ?? [], blocks: warnings?.patchBlocks ?? false };
}

// Denise's heads-up for a repeat offender being booked (front of house).
export async function clientPolicyNote(clientId: string): Promise<string | null> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role) || !isUuid(clientId)) return null;
  const [policy, standing, { data: client }, { data: first }] = await Promise.all([
    loadPolicy(supabase, me.business_id),
    clientStanding(supabase, clientId),
    supabase.from("clients").select("first_name").eq("id", clientId).single(),
    supabase.from("policy_fees").select("created_at").eq("client_id", clientId).not("status", "in", "(waived,voided)").order("created_at").limit(1),
  ]);
  if (standing.action === "off" || !client) return null;
  // Only strikes in the window count; the first of them gives "since May".
  const windowStart = new Date();
  windowStart.setUTCMonth(windowStart.getUTCMonth() - standing.months);
  const firstAt = first?.[0]?.created_at && new Date(first[0].created_at) > windowStart ? new Date(first[0].created_at) : windowStart;
  const since = firstAt.toLocaleDateString("en-US", { month: "long", timeZone: me.location.timezone });
  return repeatOffenderNote(client.first_name, { strikes: standing.strikes, action: standing.action }, policy.settings, since, standing.hasCard);
}

export type GroupInput = { label: string; date: LocalDate; notes: string; guests: { clientId: string | null; lines: VisitLineInput[] }[] };
export type GroupSaveResult = { ok: true; appointmentId: string; message: string } | { ok: false; message: string; guestErrors?: string[][] };

// Books a group: every guest's visit, or none if they don't all fit.
export async function saveGroup(input: GroupInput): Promise<GroupSaveResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  const label = input.label.trim();
  if (!label || label.length > 80) return { ok: false, message: "Give the group a name, like \"Ava's bridal party\"." };
  if (!isLocalDate(input.date)) return { ok: false, message: "Choose a date." };
  if (input.guests.length < 2 || input.guests.length > MAX_GUESTS) return { ok: false, message: `A group is 2 to ${MAX_GUESTS} people.` };
  if (input.guests.some((g) => (g.clientId && !isUuid(g.clientId)) || !g.lines.length || g.lines.some((l) => !isUuid(l.serviceId) || !isUuid(l.staffId) || l.startMinute < 0))) {
    return { ok: false, message: "Choose a service, stylist and time for each guest." };
  }
  const result = await bookGroup(supabase, { ...me.location, businessId: me.business_id }, {
    label,
    date: input.date,
    notes: input.notes.trim().slice(0, MAX_NOTES) || null,
    guests: input.guests.map((g) => ({ clientId: g.clientId, lines: g.lines.map((l) => ({ serviceId: l.serviceId, staffId: l.staffId, startMinute: l.startMinute, resource: l.resource })) })),
  });
  if (result.ok) {
    refresh();
    return { ok: true, appointmentId: result.appointmentIds[0], message: `Booked ${input.guests.length} guests for ${label}.` };
  }
  if (result.error === "invalid") {
    return { ok: false, message: "Not everyone fits as planned. Change the highlighted guests.", guestErrors: result.problems.map((g) => g.map((line) => line.map(describeProblem)).flat()).map((g) => [...new Set(g)]) };
  }
  if (result.error === "taken") return { ok: false, message: "Someone booked a slot at the same moment. No one was booked; check the times and try again." };
  return { ok: false, message: NOT_ALLOWED };
}

// Moves the whole group by the same amount as a dragged service.
export async function moveGroupVisit(input: { itemId: string; staffId: string; date: LocalDate; startMinute: number }): Promise<MoveResult & { message?: string }> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.itemId) || !isUuid(input.staffId) || !isLocalDate(input.date)) return { ok: false, message: "That move isn't possible." };
  const start = fromLocal(input.date, input.startMinute, me.location.timezone);
  if (!start) return { ok: false, message: "That time doesn't exist." };
  const result = await withNotices(supabase, me.location, await visitOfItem(supabase, input.itemId), () => moveGroupItem(supabase, me.location, { itemId: input.itemId, staffId: input.staffId, start }));
  refresh();
  if (result.ok) return { ok: true, message: `Moved the whole group (${result.moved} guest${result.moved === 1 ? "" : "s"}).` };
  if (result.error === "invalid") {
    const problem = result.problems?.flat()[0];
    return { ok: false, message: `the whole group doesn't fit there${problem ? ` (${describeProblem(problem).replace(/\.$/, "").toLowerCase()})` : ""}. Nothing was moved.` };
  }
  if (result.error === "taken") return { ok: false, message: "someone changed the calendar at the same moment. Nothing was moved; try again." };
  return { ok: false, message: "that visit is no longer in a group." };
}

// Cancels (or marks) every guest in the group.
export async function changeGroupVisitStatus(appointmentId: string, action: AppointmentAction, reason = "", detail = ""): Promise<ActionResult & { message?: string }> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(appointmentId) || !(action in ACTION_LABELS)) return { ok: false, message: "That appointment no longer exists." };
  let why: string | null = null;
  if (action === "cancel") {
    why = cancelReason(reason, detail);
    if (!why) return { ok: false, message: reason === "Other" ? "Say why it was canceled." : "Choose a reason." };
  }
  const results = await changeGroupStatus(supabase, appointmentId, action, why);
  refresh();
  const done = results.filter((r) => r.result.ok).length;
  return done ? { ok: true, message: `${done} guest${done === 1 ? "" : "s"} ${action === "cancel" ? "canceled" : "updated"}.` } : { ok: false, message: "No visits could be changed." };
}

// Changes whenever the location's calendar does (a booking saved anywhere,
// including online, or a visit's status or notes changed), so an open
// calendar can tell when to load again.
export async function calendarStamp(): Promise<string | null> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return null;
  return loadCalendarStamp(supabase, me.location.id);
}

const TIME_EVENTS: readonly TimeEvent[] = ["start", "processing", "rinse", "finish", "undo"];

// One tap on a service: started, processing, back in the chair, finished
// (or undo the last). The stylist doing it or the front of house.
export async function recordItemTime(itemId: string, event: TimeEvent): Promise<ActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(itemId) || !TIME_EVENTS.includes(event)) return { ok: false, message: "That service no longer exists." };
  const { error } = await supabase.rpc("record_item_time", { p_item_id: itemId, p_event: event });
  if (error?.code === "42501") return { ok: false, message: "Only the stylist doing this service or the front desk can record its times." };
  if (error?.code === "55000") return { ok: false, message: error.message.endsWith(".") ? error.message : `${error.message}.` };
  if (error) throw error;
  refresh();
  revalidatePath("/my-day");
  return { ok: true };
}

// A client's packages with uses left, for the booking form ("Ava has 3
// Blowouts left on a package").
export async function clientPackagesFor(clientId: string): Promise<ClientPackage[]> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(clientId)) return [];
  return (await loadClientPackages(supabase, clientId, true)).filter((p) => isUsable(p));
}
