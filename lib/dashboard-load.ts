// Loads the Dashboard for the signed-in staff member: today at a glance,
// what's happening right now, the team, Denise's brief and fixes,
// opportunities and the week. What each role sees is decided here:
// owners and managers see money; the front desk sees everything else;
// stylists get their own day. The numbers come from ./dashboard.ts,
// lib/insights/ and existing queries, never from Claude.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppointmentStatus } from "@/lib/appointments";
import { staffPhotoUrl } from "@/lib/branding";
import type { Database } from "@/lib/database.types";
import { deniseDay } from "@/lib/denise/day-state";
import { salesBetween } from "@/lib/denise/knowledge";
import type { DeniseState } from "@/lib/denise/types";
import type { ClientInsight } from "@/lib/insights/clients";
import { describeClient } from "@/lib/insights/describe";
import { loadAllClientInsights, loadSalonInsight } from "@/lib/insights/read";
import { loadPackagesByClient, withPackages } from "@/lib/packages";
import { formatDayAt, formatLongDay } from "@/lib/schedule-format";
import type { StaffLevel } from "@/lib/schedule-forms";
import { loadDisruptions } from "@/lib/scheduling/disruptions";
import { loadBookingContext, loadOffers, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, startOfWeek, toLocal, todayIn, type LocalDate } from "@/lib/scheduling/time";
import { matchOpening } from "@/lib/scheduling/waitlist";
import { can } from "@/lib/permissions";
import { isFrontOfHouse, sortStaff, type StaffRole } from "@/lib/staff";
import { loadWaitlist } from "@/lib/waitlist-load";
import { compare, dayCounts, LATE_UNTIL, fullness, gapsWorthFilling, rightNow, stylistToday, type DayCounts, type DayVisit, type StylistToday } from "./dashboard";
import { firstLetter } from "@/lib/initial";

type Supabase = SupabaseClient<Database>;

export type DashboardMe = {
  id: string;
  // An assistant's stylist: their dashboard is that stylist's day.
  assists_staff_id?: string | null;
  first_name: string;
  role: StaffRole;
  permissions: readonly string[];
  business_id: string;
  location: { id: string; name: string; timezone: string; business: { name: string } | null };
};

// Whose day a stylist or assistant sees: their own, or their stylist's.
const bookOf = (me: Pick<DashboardMe, "id" | "assists_staff_id">) => me.assists_staff_id ?? me.id;

export type Comparison = { now: number; then: number; change: number };

export type LiveVisit = Pick<DayVisit, "appointmentId" | "itemId" | "client" | "service" | "start" | "end" | "status"> & { staffId: string; staffName: string };

export type StylistCard = StylistToday & { name: string; level: StaffLevel | null; color: string | null; photoUrl: string | null };

export type LiveData = {
  nowMinute: number;
  inChair: LiveVisit[];
  upNext: LiveVisit[];
  late: (LiveVisit & { lateMinutes: number })[];
  team: StylistCard[];
};

export type Opportunities = {
  overdue: { clientId: string; name: string; reason: string; risk: ClientInsight["churnRisk"] }[];
  overdueTotal: number;
  gaps: { staffId: string; staffName: string; date: LocalDate; start: number; end: number; matches: string[] }[];
  lowStock: { product: string; reason: string }[];
  lowStockTotal: number;
};

export type MyDay = {
  visits: LiveVisit[];
  // Their client now (checked in), else the next one to come.
  next: (LiveVisit & { insight: ReturnType<typeof describeClient> | null }) | null;
  stats: { toCome: number; percent: number | null; done: number; rebookedPercent: number | null; salonRebookedPercent: number | null };
  // Denise's notes about their visits today.
  notes: string[];
};

export type DashboardData = {
  role: StaffRole;
  seesMoney: boolean;
  firstName: string;
  today: LocalDate;
  // "Thursday, October 22"
  todayLabel: string;
  // A brand-new salon: no services or stylists yet.
  newSalon: boolean;
  tiles: {
    appointments: Comparison;
    fullness: { now: number | null; then: number | null };
    revenueCents: Comparison | null;
    checkedIn: Comparison;
    missed: { noShows: number; canceled: number; thenNoShows: number; thenCanceled: number };
  };
  live: LiveData;
  // Front of house only.
  denise: DeniseState | null;
  opportunities: Opportunities | null;
  week: {
    days: { date: LocalDate; label: string; percent: number | null; today: boolean }[];
    sales: { thisWeek: number; lastWeek: number; through: string } | null;
  };
  // Stylists only.
  me: MyDay | null;
};

const FRONT_OF_HOUSE: StaffRole[] = ["owner", "manager", "front_desk"];
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const shortName = (c: { first_name: string; last_name: string } | null) => (c ? `${c.first_name}${c.last_name ? ` ${firstLetter(c.last_name)}.` : ""}` : "Walk-in");

// Every service on the location's visits that day, canceled ones included
// (for the counts).
async function loadVisits(supabase: Supabase, location: { id: string; timezone: string }, date: LocalDate): Promise<DayVisit[]> {
  const tz = location.timezone;
  const { data, error } = await supabase
    .from("appointment_items")
    .select(
      "id, appointment_id, staff_id, starts_at, ends_at, price_cents, started_at, finished_at, service:services(name), appointment:appointments!inner(id, status, checked_in_at, client:clients(id, first_name, last_name))",
    )
    .eq("location_id", location.id)
    .gte("starts_at", startOfLocalDay(date, tz).toISOString())
    .lt("starts_at", startOfLocalDay(addDays(date, 1), tz).toISOString())
    .order("starts_at");
  if (error) throw error;
  const minute = (at: string) => {
    const l = toLocal(new Date(at), tz);
    return l.date === date ? l.minute : l.date < date ? 0 : 24 * 60;
  };
  return data.map((i) => ({
    appointmentId: i.appointment_id,
    itemId: i.id,
    staffId: i.staff_id,
    clientId: i.appointment.client?.id ?? null,
    client: shortName(i.appointment.client),
    service: i.service.name,
    start: minute(i.starts_at),
    end: minute(i.ends_at),
    status: i.appointment.status as AppointmentStatus,
    checkedInAt: i.appointment.checked_in_at ? minute(i.appointment.checked_in_at) : null,
    started: i.started_at !== null,
    finished: i.finished_at !== null,
    priceCents: i.price_cents,
  }));
}

async function loadTeam(supabase: Supabase, locationId: string) {
  const { data, error } = await supabase.from("staff").select("id, first_name, last_name, role, level, color, photo_path, is_active, location_id").eq("location_id", locationId).eq("is_active", true);
  if (error) throw error;
  const offers = await loadOffers(supabase, data.map((s) => s.id));
  // Stylists: everyone who takes clients.
  return sortStaff(data).filter((s) => (offers.get(s.id)?.size ?? 0) > 0);
}

// What's happening now: in the chair, up next, late, and each working
// stylist (only the stylist themselves, for a stylist). Also polled by
// the Dashboard every 30 seconds.
export async function loadLive(supabase: Supabase, me: DashboardMe, now = new Date()): Promise<LiveData> {
  const tz = me.location.timezone;
  const today = todayIn(tz, now);
  const [visits, team, ctx, disruptions] = await Promise.all([
    loadVisits(supabase, me.location, today),
    loadTeam(supabase, me.location.id),
    loadBookingContext(supabase, me.location, today, today),
    loadDisruptions(supabase, me.location.id, today),
  ]);
  return live(visits, team, ctx, disruptions, today, toLocal(now, tz).minute, me);
}

function live(
  visits: DayVisit[],
  team: Awaited<ReturnType<typeof loadTeam>>,
  ctx: Awaited<ReturnType<typeof loadBookingContext>>,
  disruptions: Awaited<ReturnType<typeof loadDisruptions>>,
  today: LocalDate,
  nowMinute: number,
  me: DashboardMe,
): LiveData {
  const mineOnly = !isFrontOfHouse(me.role);
  const book = bookOf(me);
  const names = new Map(team.map((s) => [s.id, s.first_name]));
  const shown = visits.filter((v) => !mineOnly || v.staffId === book);
  const now = rightNow(shown, nowMinute);
  const view = (v: DayVisit): LiveVisit => ({
    appointmentId: v.appointmentId,
    itemId: v.itemId,
    client: v.client,
    service: v.service,
    start: v.start,
    end: v.end,
    status: v.status,
    staffId: v.staffId,
    staffName: names.get(v.staffId) ?? "Another stylist",
  });
  return {
    nowMinute,
    inChair: now.inChair.map(view),
    upNext: now.upNext.map(view),
    late: now.late.map((v) => ({ ...view(v), lateMinutes: v.lateMinutes })),
    team: team
      .filter((s) => !mineOnly || s.id === book)
      .flatMap((s) => {
        const t = stylistToday(ctx, visits, s.id, today, nowMinute, disruptions);
        return t ? [{ ...t, name: s.first_name, level: s.level, color: s.color, photoUrl: staffPhotoUrl(s.photo_path) }] : [];
      }),
  };
}

export async function loadDashboard(supabase: Supabase, me: DashboardMe, now = new Date()): Promise<DashboardData> {
  const tz = me.location.timezone;
  const today = todayIn(tz, now);
  const nowMinute = toLocal(now, tz).minute;
  const lastWeek = addDays(today, -7);
  const tomorrow = addDays(today, 1);
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const frontOfHouse = FRONT_OF_HOUSE.includes(me.role);
  const seesMoney = can(me, "reports");
  const viewer = { location: { id: me.location.id, timezone: tz }, salon: me.location.business?.name ?? "the salon", canBook: frontOfHouse };

  const [visits, before, team, ctx, disruptions, insights, salon, denise, services] = await Promise.all([
    loadVisits(supabase, me.location, today),
    loadVisits(supabase, me.location, lastWeek),
    loadTeam(supabase, me.location.id),
    loadBookingContext(supabase, me.location, lastWeek < weekStart ? lastWeek : weekStart, tomorrow > weekEnd ? tomorrow : weekEnd),
    loadDisruptions(supabase, me.location.id, today),
    loadAllClientInsights(supabase, me.business_id),
    loadSalonInsight(supabase, me.business_id, me.location.id),
    // With the morning brief, from our own numbers (no Claude call).
    deniseDay({ supabase, role: me.role, businessId: me.business_id, viewer, today }, today, { brief: true }),
    supabase.from("services").select("id", { count: "exact", head: true }).is("archived_at", null),
  ]);
  const stylistIds = team.map((s) => s.id);
  const names = new Map(team.map((s) => [s.id, s.first_name]));
  const book = bookOf(me);
  const ownBook = !isFrontOfHouse(me.role);
  const mine = (v: DayVisit) => !ownBook || v.staffId === book;
  const scopeIds = ownBook ? [book] : stylistIds;

  // Today at a glance, against the same day last week (check-ins up to
  // the same time of day).
  const counts: DayCounts = dayCounts(visits.filter(mine));
  const thenCounts: DayCounts = dayCounts(before.filter(mine), nowMinute);
  const thenAll: DayCounts = dayCounts(before.filter(mine));
  const tiles: DashboardData["tiles"] = {
    appointments: compare(counts.appointments, thenAll.appointments),
    fullness: { now: fullness(ctx, scopeIds, today).percent, then: fullness(ctx, scopeIds, lastWeek).percent },
    revenueCents: seesMoney ? compare(counts.expectedCents, thenAll.expectedCents) : null,
    checkedIn: compare(dayCounts(visits.filter(mine), nowMinute).checkedIn, thenCounts.checkedIn),
    missed: { noShows: counts.noShows, canceled: counts.canceled, thenNoShows: thenAll.noShows, thenCanceled: thenAll.canceled },
  };

  // The week, Monday to Sunday.
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((date, i) => ({
    date,
    label: WEEKDAY_SHORT[i],
    percent: fullness(ctx, scopeIds, date).percent,
    today: date === today,
  }));
  let sales: DashboardData["week"]["sales"] = null;
  if (seesMoney) {
    const [thisWeek, lastWeekSales] = await Promise.all([
      salesBetween(supabase, { location: viewer.location }, weekStart, today),
      salesBetween(supabase, { location: viewer.location }, addDays(weekStart, -7), lastWeek),
    ]);
    sales = { thisWeek: thisWeek.total_dollars, lastWeek: lastWeekSales.total_dollars, through: WEEKDAY_SHORT[days.findIndex((d) => d.today)] };
  }

  const liveData = live(visits, team, ctx, disruptions, today, nowMinute, me);
  const base = {
    role: me.role,
    seesMoney,
    firstName: me.first_name,
    today,
    todayLabel: formatLongDay(today, false),
    newSalon: (services.count ?? 0) === 0 || team.length === 0,
    tiles,
    live: liveData,
    week: { days, sales },
  };

  if (ownBook) {
    const myVisits = visits.filter((v) => v.staffId === book && v.status !== "canceled");
    // Only what's shown: no prices.
    const view = (v: DayVisit): LiveVisit => ({
      appointmentId: v.appointmentId,
      itemId: v.itemId,
      client: v.client,
      service: v.service,
      start: v.start,
      end: v.end,
      status: v.status,
      staffId: v.staffId,
      staffName: names.get(book) ?? me.first_name,
    });
    const firstOfVisit = [...new Map(myVisits.map((v) => [v.appointmentId, v])).values()];
    // Who's in their chair now, else the next client still to come.
    const nextVisit =
      firstOfVisit.find((v) => v.status === "checked_in" && !v.finished) ??
      firstOfVisit.find((v) => (v.status === "booked" || v.status === "confirmed") && v.start >= nowMinute - LATE_UNTIL);
    const known = nextVisit?.clientId ? insights.get(nextVisit.clientId) : undefined;
    const nextPackages = nextVisit?.clientId ? (await loadPackagesByClient(supabase, [nextVisit.clientId])).get(nextVisit.clientId) : undefined;
    const rebooking = salon?.rebooking.find((r) => r.staffId === book);
    const myItems = new Set(myVisits.map((v) => v.itemId));
    return {
      ...base,
      denise: null,
      opportunities: {
        ...(await overdueFor(supabase, insights, (c) => c.preferredStaffId === book, names, now)),
        gaps: [],
        lowStock: [],
        lowStockTotal: 0,
      },
      me: {
        visits: myVisits.map(view),
        next: nextVisit
          ? {
              ...view(nextVisit),
              insight: withPackages(known ? describeClient(known, null, { staff: (id) => names.get(id) ?? null, dayOf: (iso) => formatDayAt(iso, tz) }, now) : null, nextPackages),
            }
          : null,
        stats: {
          toCome: firstOfVisit.filter((v) => (v.status === "booked" || v.status === "confirmed") && v.start >= nowMinute - LATE_UNTIL).length,
          percent: tiles.fullness.now,
          done: new Set(myVisits.filter((v) => v.status === "completed").map((v) => v.appointmentId)).size,
          rebookedPercent: rebooking ? Math.round(rebooking.rebookedRate * 100) : null,
          salonRebookedPercent: salon?.rebookedRate != null ? Math.round(salon.rebookedRate * 100) : null,
        },
        notes: denise.conflicts.filter((c) => c.itemIds.some((id) => myItems.has(id))).map((c) => c.headline),
      },
    };
  }

  // Opportunities: overdue regulars, gaps worth filling (with waitlist
  // matches), and stock that upcoming services need.
  const entries = await loadWaitlist(supabase, me.location.id, today);
  const gaps = [...gapsWorthFilling(ctx, stylistIds, today, nowMinute).sort((a, b) => a.start - b.start), ...gapsWorthFilling(ctx, stylistIds, tomorrow).sort((a, b) => a.start - b.start)]
    .slice(0, 3)
    .map((g) => {
      const matched = matchOpening(ctx, g, entries.filter((e) => e.fromDate <= g.date));
      const clientName = new Map(entries.map((e) => [e.id, e.clientName]));
      return { ...g, staffName: names.get(g.staffId) ?? "A stylist", matches: matched.slice(0, 2).map((m) => clientName.get(m.entryId) ?? "A client") };
    });
  const reorderItems = denise.reorders.flatMap((r) => r.items);
  return {
    ...base,
    // No money for the front desk, not even in what's sent to the browser.
    denise: seesMoney ? denise : { ...denise, reorders: denise.reorders.map((r) => ({ ...r, totalCents: 0 })) },
    opportunities: {
      ...(await overdueFor(supabase, insights, () => true, names, now)),
      gaps,
      lowStock: reorderItems.slice(0, 3),
      lowStockTotal: denise.reorders.reduce((n, r) => n + r.lines, 0),
    },
    me: null,
  };
}

// The most overdue regulars with nothing booked, with why they stand out.
async function overdueFor(supabase: Supabase, insights: Map<string, ClientInsight>, keep: (c: ClientInsight) => boolean, names: Map<string, string>, now: Date, limit = 3) {
  const due = [...insights].filter(([, c]) => (c.due === "overdue" || c.due === "due_soon") && c.visits >= 2 && keep(c)).sort((a, b) => b[1].overdueDays - a[1].overdueDays);
  const top = due.slice(0, limit);
  const { data, error } = top.length ? await supabase.from("clients").select("id, first_name, last_name").in("id", top.map(([id]) => id)) : { data: [], error: null };
  if (error) throw error;
  const clientNames = new Map(data.map((c) => [c.id, shortName(c)]));
  return {
    overdueTotal: due.length,
    overdue: top.flatMap(([clientId, c]) => (clientNames.has(clientId) ? [{ clientId, name: clientNames.get(clientId)!, reason: overdueReason(c, names, now), risk: c.churnRisk }] : [])),
  };
}

// Regulars due back with nothing booked, most overdue first (a stylist's
// own regulars, for a stylist): the Clients page's "Due back" list.
export async function loadDueBack(supabase: Supabase, me: Pick<DashboardMe, "id" | "assists_staff_id" | "role" | "business_id" | "location">, limit = 100) {
  const [insights, team] = await Promise.all([loadAllClientInsights(supabase, me.business_id), loadTeam(supabase, me.location.id)]);
  const names = new Map(team.map((s) => [s.id, s.first_name]));
  return overdueFor(supabase, insights, (c) => isFrontOfHouse(me.role) || c.preferredStaffId === bookOf(me), names, new Date(), limit);
}

export function overdueReason(c: ClientInsight, names: Map<string, string>, now: Date): string {
  const parts: string[] = [];
  if (c.intervalDays) parts.push(`usually every ${Math.max(1, Math.round(c.intervalDays / 7))} wk`);
  if (c.overdueDays > 0) parts.push(c.overdueDays < 7 ? `${c.overdueDays} ${c.overdueDays === 1 ? "day" : "days"} overdue` : `${Math.round(c.overdueDays / 7)} wk overdue`);
  else if (c.nextDue) parts.push(`due in ${Math.max(1, Math.round((new Date(c.nextDue).getTime() - now.getTime()) / 86_400_000))} days`);
  const stylist = c.preferredStaffId ? names.get(c.preferredStaffId) : null;
  if (stylist) parts.push(`sees ${stylist}`);
  if (c.churnRisk === "high") parts.push("visits getting further apart");
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
