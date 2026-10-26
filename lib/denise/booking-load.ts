// What booking by asking Denise needs from the database (./booking-chat.ts):
// the menu with each stylist's prices, clients matching a name or phone,
// their last visit and alerts, and the best times by the booking rules,
// each stylist at the length they really take where Denise knows it. Used
// by her streaming endpoint and the chat's own actions (app/denise/).
// Front of house only (the callers check).

import type { SupabaseClient } from "@supabase/supabase-js";
import { searchClients } from "@/lib/client-search";
import type { Database } from "@/lib/database.types";
import { loadClientInsights, loadDurations, usualTimings } from "@/lib/insights/read";
import { LATER_DAYS, MAX_DAYS, MAX_PHONE_SERVICES, phoneTimes, type PhoneRequest, type PhoneStylist } from "@/lib/phone-booking";
import { clientStanding } from "@/lib/policy-load";
import { STAFF_LEVELS, type StaffLevel } from "@/lib/schedule-forms";
import { formatDay } from "@/lib/schedule-format";
import { durationMinutes } from "@/lib/scheduling/booking";
import { loadBookingContext } from "@/lib/scheduling/load";
import type { Ranked } from "@/lib/scheduling/phone";
import { addDays, daysBetween, formatMinute, isLocalDate, toLocal, todayIn, type LocalDate } from "@/lib/scheduling/time";
import { levelPricesFrom, stylistPrice } from "@/lib/services";
import { fullName } from "@/lib/staff";
import type { BookingDeps, BookingSlot, ClientAlerts, ClientMatch, LastVisit, TimesFound } from "./booking-chat";
import type { BookingMenu } from "./booking-request";

type Supabase = SupabaseClient<Database>;
export type Booker = { supabase: Supabase; me: { id: string; business_id: string; location: { id: string; timezone: string } } };

export type PricedMenu = BookingMenu & {
  stylists: PhoneStylist[];
  price: (staffId: string, serviceId: string) => number;
};

// The menu, the stylists who do something on it, and what each charges.
export async function bookingMenu(s: Booker): Promise<PricedMenu> {
  const [services, staff, offers] = await Promise.all([
    s.supabase.from("services").select("id, name, category, price_cents, service_level_prices(level, price_cents)").eq("business_id", s.me.business_id).is("archived_at", null).order("category").order("name"),
    s.supabase.from("staff").select("id, first_name, level, calendar_position").eq("location_id", s.me.location.id).eq("is_active", true).order("calendar_position", { nullsFirst: false }).order("first_name"),
    s.supabase.from("staff_services").select("staff_id, service_id, price_cents"),
  ]);
  if (services.error) throw services.error;
  if (staff.error) throw staff.error;
  if (offers.error) throw offers.error;
  const doesServices = new Set(offers.data.map((o) => o.staff_id));
  const custom = new Map(offers.data.map((o) => [`${o.staff_id}:${o.service_id}`, o.price_cents]));
  const level = new Map(staff.data.map((m) => [m.id, m.level as StaffLevel | null]));
  const byId = new Map(services.data.map((sv) => [sv.id, { price_cents: sv.price_cents, levelPrices: levelPricesFrom(sv.service_level_prices as { level: StaffLevel; price_cents: number }[]) }]));
  return {
    services: services.data.map((sv) => ({ id: sv.id, name: sv.name, category: sv.category })),
    stylists: staff.data.filter((m) => doesServices.has(m.id)).map((m) => ({ id: m.id, firstName: m.first_name, level: m.level })),
    price: (staffId, serviceId) => {
      const service = byId.get(serviceId);
      return service ? stylistPrice(service, { level: level.get(staffId) ?? null, customCents: custom.get(`${staffId}:${serviceId}`) ?? null }) : 0;
    },
  };
}

// Clients matching what was typed: the best matches first (whole first
// and last names, then the most recent visitors).
export async function matchClients(s: Booker, text: string | null): Promise<ClientMatch[]> {
  if (!text || text.trim().length < 2) return [];
  const { clients } = await searchClients(s.supabase, s.me.business_id, text, 25);
  if (!clients.length) return [];
  const latest = await lastVisits(s, clients.map((c) => c.id));
  const words = text.toLowerCase().split(/\s+/);
  const exact = (c: { first_name: string; last_name: string }) => words.filter((w) => w === c.first_name.toLowerCase() || w === c.last_name.toLowerCase()).length;
  return [...clients]
    .sort((a, b) => exact(b) - exact(a) || (latest.get(b.id) ?? "").localeCompare(latest.get(a.id) ?? ""))
    .slice(0, 6)
    .map((c) => matchOf(s, c, latest.get(c.id)));
}

async function lastVisits(s: Booker, clientIds: string[]): Promise<Map<string, string>> {
  const { data, error } = await s.supabase.from("appointments").select("client_id, starts_at").in("client_id", clientIds).eq("status", "completed").order("starts_at", { ascending: false });
  if (error) throw error;
  const latest = new Map<string, string>();
  for (const a of data) if (a.client_id && !latest.has(a.client_id)) latest.set(a.client_id, a.starts_at);
  return latest;
}

const matchOf = (s: Booker, c: { id: string; first_name: string; last_name: string; phone: string | null; allergies: string | null }, at: string | undefined): ClientMatch => ({
  id: c.id,
  name: fullName(c),
  phone: c.phone,
  allergies: c.allergies,
  lastVisit: at ? formatDay(toLocal(new Date(at), s.me.location.timezone).date) : null,
});

export async function clientById(s: Booker, id: string): Promise<ClientMatch | null> {
  const { data, error } = await s.supabase.from("clients").select("id, first_name, last_name, phone, allergies").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return matchOf(s, data, (await lastVisits(s, [id])).get(id));
}

// The client's last finished visit: its services in order, and who did the first.
export async function lastVisit(s: Booker, clientId: string): Promise<LastVisit | null> {
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

// What staff should know before booking this client.
export async function clientAlerts(s: Booker, clientId: string, policyNote: (clientId: string) => Promise<string | null>): Promise<ClientAlerts | null> {
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const [client, standing, noShows, last, note] = await Promise.all([
    s.supabase.from("clients").select("allergies").eq("id", clientId).maybeSingle(),
    clientStanding(s.supabase, clientId),
    s.supabase.from("appointments").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("status", "no_show").gte("starts_at", yearAgo),
    lastVisit(s, clientId),
    policyNote(clientId),
  ]);
  if (client.error) throw client.error;
  if (!client.data) return null;
  return { allergies: client.data.allergies, card: standing.hasCard ? "on_file" : "none", repeatNoShow: (noShows.count ?? 0) >= 2, policyNote: note, last };
}

// Why a request can't be searched, or null.
export function requestProblem(r: PhoneRequest, today: LocalDate, menu: BookingMenu): string | null {
  if (!r || !Array.isArray(r.serviceIds) || !r.serviceIds.length) return "Choose at least one service.";
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

// A request from the browser, with only the fields we know, or null.
export function cleanRequest(raw: unknown): PhoneRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  if (!Array.isArray(r.serviceIds) || !r.serviceIds.every((id) => typeof id === "string")) return null;
  const part = (["morning", "afternoon", "evening"] as const).find((p) => p === r.part) ?? null;
  return {
    clientText: str(r.clientText)?.slice(0, 100) ?? null,
    sameAsLast: r.sameAsLast === true,
    serviceIds: r.serviceIds as string[],
    staffId: str(r.staffId),
    level: STAFF_LEVELS.find((l) => l === r.level) ?? null,
    from: str(r.from) ?? "",
    to: str(r.to) ?? "",
    part,
    after: num(r.after),
    before: num(r.before),
    earliest: r.earliest === true,
  };
}

// The three best times for the request (or the nearest alternatives), each
// stylist checked at the length they really take where Denise knows it.
export async function findTimes(s: Booker, menu: PricedMenu, request: PhoneRequest, clientId: string | null, laterThan: { date: LocalDate; minute: number } | null): Promise<TimesFound> {
  const tz = s.me.location.timezone;
  const r = { ...request, from: request.from < todayIn(tz) ? todayIn(tz) : request.from };
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
    laterThan,
  });

  const names = new Map(menu.stylists.map((m) => [m.id, m.firstName]));
  const serviceName = new Map(menu.services.map((sv) => [sv.id, sv.name]));
  const slot = (c: Ranked): BookingSlot => {
    const end = toLocal(c.end, tz).minute;
    const stylists = [...new Set(c.lines.map((l) => l.staffId))];
    const what =
      stylists.length === 1
        ? `${c.lines.map((l) => serviceName.get(l.serviceId)).join(", then ")} with ${names.get(stylists[0])}`
        : c.lines.map((l) => `${serviceName.get(l.serviceId)} with ${names.get(l.staffId)}`).join(", then ");
    const lines = c.lines.map((l) => ({
      serviceId: l.serviceId,
      staffId: l.staffId,
      startMinute: l.startMinute,
      minutes: durationMinutes(l.timing),
      usual: usualFor(l.staffId, l.serviceId) !== null,
      priceCents: menu.price(l.staffId, l.serviceId),
    }));
    return { date: c.date, when: `${formatDay(c.date)} · ${formatMinute(c.minute)}–${formatMinute(end)}`, what, reason: c.reason, priceCents: lines.reduce((n, l) => n + l.priceCents, 0), lines };
  };

  // Which lengths came from what Denise has learned.
  const usualLines = [...found.options, ...found.otherDays, ...found.sameLevel].flatMap((c) => c.lines).filter((l) => usualFor(l.staffId, l.serviceId));
  const part = r.part ? `${r.part}s` : r.after !== null ? `after ${formatMinute(r.after)}` : r.before !== null ? `before ${formatMinute(r.before)}` : "any time";
  const days = r.from === r.to ? formatDay(r.from) : `${formatDay(r.from)} to ${formatDay(r.to)}`;
  return {
    options: found.options.map(slot),
    otherDays: found.otherDays.map(slot),
    sameLevel: found.sameLevel.map(slot),
    searched: `${days}, ${part}`,
    lengths: usualLines.length ? "Times use each stylist's usual length for the service, where I know it." : null,
  };
}

// Everything the chat's booking turn needs, for this staff member.
export function bookingDeps(s: Booker, menu: PricedMenu, read: BookingDeps["read"], policyNote: (clientId: string) => Promise<string | null>): BookingDeps {
  return {
    today: todayIn(s.me.location.timezone),
    menu,
    read,
    findClients: (text) => matchClients(s, text),
    clientById: (id) => clientById(s, id),
    lastVisit: (id) => lastVisit(s, id),
    alerts: (id) => clientAlerts(s, id, policyNote),
    times: async (request, clientId, later) => {
      const problem = requestProblem(request, todayIn(s.me.location.timezone), menu);
      if (problem) return { options: [], otherDays: [], sameLevel: [], searched: "", lengths: null, problem };
      return findTimes(s, menu, request, clientId, later);
    },
  };
}
