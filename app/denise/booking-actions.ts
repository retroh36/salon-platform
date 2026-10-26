"use server";

// The booking cards in Denise's chat (components/denise-chat/): the times
// once staff pick the client or fill in the form, what the cancellation
// policy asks for before booking, booking itself (through saveVisit, like
// any booking), a new client, and the waitlist. Our code throughout; Denise
// only ever reads the line (app/api/denise). Front of house only.

import { randomUUID } from "node:crypto";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { withClient, type BookingReply, type ClientMatch, type SlotLine } from "@/lib/denise/booking-chat";
import { bookingDeps, bookingMenu, cleanRequest, clientById } from "@/lib/denise/booking-load";
import { isUuid } from "@/lib/ids";
import { loadVisitPolicies } from "@/lib/policy-visits";
import { requestFrom } from "@/lib/phone-booking";
import { isLocalDate, todayIn, type LocalDate } from "@/lib/scheduling/time";
import { sendCardLink } from "@/app/policy/actions";
import { clientPolicyNote, quickAddClient, saveVisit } from "@/app/calendar/actions";
import { addToWaitlist } from "@/app/calendar/waitlist-actions";

const NOT_ALLOWED = "Only owners, managers and front desk can book appointments.";

async function booker() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me && canBook(me.role) ? { supabase, me } : null;
}

// The times for a request once the client is known (or there isn't one):
// after "which one?", a new client, or the form.
export type ReplyResult = { ok: true; reply: BookingReply } | { ok: false; message: string };

export async function bookingTimes(rawRequest: unknown, clientId: string | null): Promise<ReplyResult> {
  const s = await booker();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const request = cleanRequest(rawRequest);
  if (!request) return { ok: false, message: "Fill in what the client wants." };
  if (clientId !== null && !isUuid(clientId)) return { ok: false, message: "Choose the client again." };
  const menu = await bookingMenu(s);
  const deps = bookingDeps(s, menu, async () => null, clientPolicyNote);
  const client = clientId ? await clientById(s, clientId) : null;
  if (clientId && !client) return { ok: false, message: "That client no longer exists." };
  return { ok: true, reply: await withClient(request, client, deps) };
}

// The form on its own ("Book with the form"), for a client or none.
export async function bookingForm(clientId: string | null): Promise<ReplyResult> {
  const s = await booker();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  return bookingTimes(requestFrom(null, null, todayIn(s.me.location.timezone)), clientId);
}

export type BookingPolicy = { cardLabel: string | null; cardNeeded: boolean; depositCents: number; phone: string | null };

// What the cancellation policy asks of this booking before it's made: a
// card on file, or a deposit (the same rules as booking details).
export async function bookingPolicy(clientId: string, lines: SlotLine[]): Promise<BookingPolicy | null> {
  const s = await booker();
  if (!s || !isUuid(clientId) || !Array.isArray(lines) || !lines.length) return null;
  const { data: client } = await s.supabase.from("clients").select("phone").eq("id", clientId).maybeSingle();
  if (!client) return null;
  const now = new Date().toISOString();
  // The visit isn't booked yet: a stand-in id for it.
  const visitId = randomUUID();
  const policies = await loadVisitPolicies(s.supabase, s.me.business_id, s.me.role, [
    {
      id: visitId,
      clientId,
      status: "booked",
      serviceIds: lines.map((l) => String(l.serviceId)),
      staffIds: [...new Set(lines.map((l) => String(l.staffId)))],
      visitCents: lines.reduce((n, l) => n + (Number.isInteger(l.priceCents) ? l.priceCents : 0), 0),
      serviceDepositCents: 0,
      depositPaidCents: 0,
      bookedAt: now,
      startsAt: now,
    },
  ]);
  const p = policies.get(visitId);
  if (!p) return null;
  return { cardLabel: p.cardLabel, cardNeeded: p.cardNeeded, depositCents: p.depositNeededCents, phone: client.phone };
}

export type ChatBookResult = { ok: true; appointmentId: string; message: string } | { ok: false; message: string };

// Books a time from the chat, at the lengths it was found with, and sends
// the card link when the policy needs one and staff left it ticked.
export async function bookFromChat(input: { date: LocalDate; clientId: string; lines: SlotLine[]; cardLink: boolean }): Promise<ChatBookResult> {
  const s = await booker();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isLocalDate(input.date) || !isUuid(input.clientId) || !Array.isArray(input.lines) || !input.lines.length) return { ok: false, message: "Choose a time again." };
  const saved = await saveVisit({
    date: input.date,
    clientId: input.clientId,
    notes: "",
    lines: input.lines.map((l) => ({ serviceId: l.serviceId, staffId: l.staffId, startMinute: l.startMinute, resource: "any", minutes: l.minutes })),
  });
  if (!saved.ok) return { ok: false, message: saved.message };
  let message = "Booked.";
  if (input.cardLink) {
    const policy = await bookingPolicy(input.clientId, input.lines);
    if (policy?.cardNeeded && policy.phone) {
      const sent = await sendCardLink({ clientId: input.clientId, appointmentId: saved.appointmentId, channel: "sms", to: policy.phone });
      message = sent.ok ? "Booked, and the card link is on its way." : `Booked. The card link didn't go: ${sent.message}`;
    }
  }
  return { ok: true, appointmentId: saved.appointmentId, message };
}

// A client who isn't on file yet.
export async function addChatClient(input: { firstName: string; lastName: string; phone: string }): Promise<{ ok: true; client: ClientMatch } | { ok: false; message: string }> {
  const s = await booker();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const r = await quickAddClient(input);
  if (!r.ok) return { ok: false, message: r.errors.first_name ?? r.errors.phone ?? r.errors.form ?? "Check the details." };
  return { ok: true, client: { ...r.client, lastVisit: null } };
}

// When nothing fits: the client waits for those days with that stylist (or
// any at the level asked for).
export async function waitlistFromChat(rawRequest: unknown, clientId: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const s = await booker();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const request = cleanRequest(rawRequest);
  if (!request || !isUuid(clientId)) return { ok: false, message: "Choose the client first." };
  const menu = await bookingMenu(s);
  const r = await addToWaitlist({
    clientId,
    serviceIds: request.serviceIds,
    staffIds: request.staffId ? [request.staffId] : request.level ? menu.stylists.filter((m) => m.level === request.level).map((m) => m.id) : [],
    fromDate: request.from,
    toDate: request.to,
    windows: request.part ? [request.part] : [],
    notes: "Added from Denise's chat.",
  });
  if (!r.ok) return { ok: false, message: r.message };
  const client = await clientById(s, clientId);
  return { ok: true, message: `${client?.name.split(" ")[0] ?? "The client"} is on the waitlist.` };
}
