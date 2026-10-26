"use server";

// The calendar's Phone booking panel (./phone-panel.tsx): Denise reads what
// staff type during a call, and our code finds the client and the best
// times by the booking rules. Booking itself goes through saveVisit, like
// any booking. Front of house only.

import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { searchClients } from "@/lib/client-search";
import { claudeClient } from "@/lib/denise/claude";
import { failureRef, logDeniseError } from "@/lib/denise/errors";
import { readPhoneRequest, type PhoneMenu } from "@/lib/denise/phone-request";
import { metered } from "@/lib/denise/usage";
import { isUuid } from "@/lib/ids";
import { loadClientInsights, loadDurations, usualTimings } from "@/lib/insights/read";
import { clientWords, LATER_DAYS, maskedLine, MAX_DAYS, MAX_PHONE_SERVICES, phoneTimes, requestFrom, vocabularyOf, type PhoneRequest, type PhoneStylist } from "@/lib/phone-booking";
import { clientStanding } from "@/lib/policy-load";
import { STAFF_LEVELS } from "@/lib/schedule-forms";
import { formatDay } from "@/lib/schedule-format";
import { durationMinutes } from "@/lib/scheduling/booking";
import { loadBookingContext } from "@/lib/scheduling/load";
import type { Ranked } from "@/lib/scheduling/phone";
import { addDays, daysBetween, formatMinute, isLocalDate, toLocal, todayIn, type LocalDate } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientPolicyNote, type ClientOption } from "./actions";

const NOT_ALLOWED = "Only owners, managers and front desk can book appointments.";

async function booker() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me && canBook(me.role) ? { supabase, me } : null;
}
type Session = NonNullable<Awaited<ReturnType<typeof booker>>>;

// The menu and the stylists who do something on it.
async function phoneMenu(s: Session): Promise<PhoneMenu & { stylists: PhoneStylist[] }> {
  const [services, staff, offers] = await Promise.all([
    s.supabase.from("services").select("id, name, category").eq("business_id", s.me.business_id).is("archived_at", null).order("category").order("name"),
    s.supabase.from("staff").select("id, first_name, level, calendar_position").eq("location_id", s.me.location.id).eq("is_active", true).order("calendar_position", { nullsFirst: false }).order("first_name"),
    s.supabase.from("staff_services").select("staff_id"),
  ]);
  if (services.error) throw services.error;
  if (staff.error) throw staff.error;
  if (offers.error) throw offers.error;
  const doesServices = new Set(offers.data.map((o) => o.staff_id));
  return {
    services: services.data.map((sv) => ({ id: sv.id, name: sv.name, category: sv.category })),
    stylists: staff.data.filter((m) => doesServices.has(m.id)).map((m) => ({ id: m.id, firstName: m.first_name, level: m.level })),
  };
}

export type ClientMatch = ClientOption & { lastVisit: string | null };

// Clients matching what was typed: the best matches first (whole first
// and last names, then the most recent visitors).
async function matchClients(s: Session, text: string | null): Promise<ClientMatch[]> {
  if (!text || text.trim().length < 2) return [];
  const { clients } = await searchClients(s.supabase, s.me.business_id, text, 25);
  if (!clients.length) return [];
  const { data: last, error } = await s.supabase
    .from("appointments")
    .select("client_id, starts_at")
    .in("client_id", clients.map((c) => c.id))
    .eq("status", "completed")
    .order("starts_at", { ascending: false });
  if (error) throw error;
  const latest = new Map<string, string>();
  for (const a of last) if (a.client_id && !latest.has(a.client_id)) latest.set(a.client_id, a.starts_at);
  const words = text.toLowerCase().split(/\s+/);
  const exact = (c: { first_name: string; last_name: string }) => words.filter((w) => w === c.first_name.toLowerCase() || w === c.last_name.toLowerCase()).length;
  return [...clients]
    .sort((a, b) => exact(b) - exact(a) || (latest.get(b.id) ?? "").localeCompare(latest.get(a.id) ?? ""))
    .slice(0, 6)
    .map((c) => {
      const at = latest.get(c.id);
      return { id: c.id, name: fullName(c), phone: c.phone, allergies: c.allergies, lastVisit: at ? formatDay(toLocal(new Date(at), s.me.location.timezone).date) : null };
    });
}

// The client's last finished visit: its services in order, and who did the first.
async function lastVisit(s: Session, clientId: string): Promise<{ serviceIds: string[]; staffId: string | null; text: string } | null> {
  const { data, error } = await s.supabase
    .from("appointments")
    .select("starts_at, appointment_items(service_id, staff_id, starts_at, services(name), staff(first_name))")
    .eq("client_id", clientId)
    .eq("status", "completed")
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.appointment_items.length) return null;
  const items = [...data.appointment_items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const names = items.map((i) => i.services?.name ?? "a service").join(" + ");
  const day = formatDay(toLocal(new Date(data.starts_at), s.me.location.timezone).date);
  return {
    serviceIds: [...new Set(items.map((i) => i.service_id))].slice(0, MAX_PHONE_SERVICES),
    staffId: items[0].staff_id,
    text: `${names} with ${items[0].staff?.first_name ?? "their stylist"}, ${day}`,
  };
}

export type CallReading = {
  ok: true;
  request: PhoneRequest;
  // "denise": she read the line; "fields": staff fill them in.
  by: "denise" | "fields";
  clients: ClientMatch[];
  note: string | null;
};

// Denise reads the line into the fields, and the client is looked up.
export async function readCall(line: string): Promise<CallReading | { ok: false; message: string }> {
  const s = await booker();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const text = line.trim().slice(0, 500);
  const today = todayIn(s.me.location.timezone);
  const menu = await phoneMenu(s);
  const named = text ? clientWords(text, vocabularyOf([...menu.services.flatMap((sv) => [sv.name, sv.category]), ...menu.stylists.map((m) => m.firstName)])) : null;

  const client = claudeClient();
  const parse =
    text.length >= 3
      ? await readPhoneRequest(client && metered(client, createAdminClient(), s.me.business_id, "phone_booking"), maskedLine(text, named), menu, (error) =>
          logDeniseError(error, { where: "reading a phone booking", businessId: s.me.business_id, ref: failureRef() }),
        )
      : null;
  const request = requestFrom(parse, named, today);
  const clients = await matchClients(s, named);

  let note: string | null = parse ? null : client ? "I couldn't read that one, so fill in what the client wants below." : null;
  // Same as last time: their last visit's services, with the same stylist.
  if (request.sameAsLast && clients.length === 1) {
    const last = await lastVisit(s, clients[0].id);
    if (last) {
      if (!request.serviceIds.length) request.serviceIds = last.serviceIds;
      if (!request.staffId && !request.level) request.staffId = last.staffId;
      note = `Same as last time: ${last.text}.`;
    } else note = `I couldn't find a finished visit for ${clients[0].name.split(" ")[0]}, so choose the services.`;
  }
  return { ok: true, request, by: parse ? "denise" : "fields", clients, note };
}

export type ClientAlerts = {
  allergies: string | null;
  card: "on_file" | "none";
  repeatNoShow: boolean;
  policyNote: string | null;
  last: { serviceIds: string[]; staffId: string | null; text: string } | null;
};

// What staff should know before booking this client.
export async function clientAlerts(clientId: string): Promise<ClientAlerts | null> {
  const s = await booker();
  if (!s || !isUuid(clientId)) return null;
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const [client, standing, noShows, last, policyNote] = await Promise.all([
    s.supabase.from("clients").select("allergies").eq("id", clientId).maybeSingle(),
    clientStanding(s.supabase, clientId),
    s.supabase.from("appointments").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("status", "no_show").gte("starts_at", yearAgo),
    lastVisit(s, clientId),
    clientPolicyNote(clientId),
  ]);
  if (client.error) throw client.error;
  if (!client.data) return null;
  return { allergies: client.data.allergies, card: standing.hasCard ? "on_file" : "none", repeatNoShow: (noShows.count ?? 0) >= 2, policyNote, last };
}

export type PhoneLine = { serviceId: string; staffId: string; startMinute: number; minutes: number; usual: boolean };
export type PhoneOption = {
  date: LocalDate;
  // "Tue, Nov 3 · 2:15pm–5:05pm"
  when: string;
  // "Balayage, then Women's Cut & Style with Bridget"
  what: string;
  reason: string;
  lines: PhoneLine[];
};
export type PhoneSearch = { ok: true; options: PhoneOption[]; otherDays: PhoneOption[]; sameLevel: PhoneOption[]; searched: string; lengths: string | null } | { ok: false; message: string };

function checkRequest(r: PhoneRequest, today: LocalDate, menu: PhoneMenu & { stylists: PhoneStylist[] }): string | null {
  if (!Array.isArray(r.serviceIds) || !r.serviceIds.length) return "Choose at least one service.";
  if (r.serviceIds.length > MAX_PHONE_SERVICES) return "Choose up to four services.";
  if (r.serviceIds.some((id) => !menu.services.some((sv) => sv.id === id))) return "One of those services isn't on the menu.";
  if (r.staffId !== null && !menu.stylists.some((m) => m.id === r.staffId)) return "Choose a stylist from the list.";
  if (r.level !== null && !STAFF_LEVELS.includes(r.level)) return "Choose a level from the list.";
  if (!isLocalDate(r.from) || !isLocalDate(r.to) || r.to < r.from) return "Choose the days the client can come.";
  if (r.to < today) return "Those days have passed.";
  if (daysBetween(r.from, r.to) > MAX_DAYS) return "Search up to a month at a time.";
  for (const m of [r.after, r.before]) if (m !== null && (!Number.isInteger(m) || m < 0 || m > 24 * 60)) return "Choose a time of day.";
  return null;
}

// The three best times for the request (or the nearest alternatives), each
// stylist checked at the length they really take where Denise knows it.
export async function findPhoneTimes(request: PhoneRequest, clientId: string | null): Promise<PhoneSearch> {
  const s = await booker();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const tz = s.me.location.timezone;
  const today = todayIn(tz);
  const menu = await phoneMenu(s);
  const r: PhoneRequest = { ...request, from: request.from < today ? today : request.from };
  const problem = checkRequest(r, today, menu);
  if (problem) return { ok: false, message: problem };
  if (clientId && !isUuid(clientId)) return { ok: false, message: "Choose the client again." };

  const [ctx, learned, insight] = await Promise.all([
    loadBookingContext(s.supabase, s.me.location, r.from, addDays(r.to, LATER_DAYS)),
    loadDurations(s.supabase, s.me.business_id),
    clientId ? loadClientInsights(s.supabase, s.me.business_id, [clientId]) : Promise.resolve(new Map()),
  ]);
  const { usualFor, timingOf } = usualTimings(ctx, learned);
  const habits = insight.get(clientId ?? "")?.habits;
  const found = phoneTimes(ctx, r, {
    stylists: menu.stylists,
    timingOf,
    habits: { usualStaffId: habits?.preferredStaffId ?? null, usualWeekday: habits?.preferredWeekday ?? null, usualPart: habits?.timeOfDay ?? null },
    now: new Date(),
  });

  const names = new Map(menu.stylists.map((m) => [m.id, m.firstName]));
  const serviceName = new Map(menu.services.map((sv) => [sv.id, sv.name]));
  const option = (c: Ranked): PhoneOption => {
    const end = toLocal(c.end, tz).minute;
    const stylists = [...new Set(c.lines.map((l) => l.staffId))];
    const what =
      stylists.length === 1
        ? `${c.lines.map((l) => serviceName.get(l.serviceId)).join(", then ")} with ${names.get(stylists[0])}`
        : c.lines.map((l) => `${serviceName.get(l.serviceId)} with ${names.get(l.staffId)}`).join(", then ");
    return {
      date: c.date,
      when: `${formatDay(c.date)} · ${formatMinute(c.minute)}–${formatMinute(end)}`,
      what,
      reason: c.reason,
      lines: c.lines.map((l) => ({ serviceId: l.serviceId, staffId: l.staffId, startMinute: l.startMinute, minutes: durationMinutes(l.timing), usual: usualFor(l.staffId, l.serviceId) !== null })),
    };
  };

  // Which lengths came from what Denise has learned.
  const usualLines = [...found.options, ...found.otherDays, ...found.sameLevel].flatMap((c) => c.lines).filter((l) => usualFor(l.staffId, l.serviceId));
  const lengths = usualLines.length ? "Times use each stylist's usual length for the service, where Denise knows it." : null;
  const part = r.part ? `${r.part}s` : r.after !== null ? `after ${formatMinute(r.after)}` : "any time";
  const days = r.from === r.to ? formatDay(r.from) : `${formatDay(r.from)} to ${formatDay(r.to)}`;
  return {
    ok: true,
    options: found.options.map(option),
    otherDays: found.otherDays.map(option),
    sameLevel: found.sameLevel.map(option),
    searched: `${days}, ${part}`,
    lengths,
  };
}
