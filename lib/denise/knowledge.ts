// What Ask Denise's tools can look up (./assistant.ts), worked out here
// from the data and what she's learned (lib/insights/). Read as the staff
// member asking (RLS applies), and trimmed for Claude:
//   - clients by first name only: never phone numbers, emails, addresses,
//     allergies, notes or payment details;
//   - stylists see their own stats only (durations, rebooking, overdue
//     regulars), and no money: no client spend or salon sales;
//   - sales figures for owners and managers.
// Every number is calculated here; Claude only reads them.

import type { SupabaseClient } from "@supabase/supabase-js";
import { canManage } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import type { ClientInsight } from "@/lib/insights/clients";
import type { ClientSpend } from "@/lib/insights/describe";
import { loadAllClientInsights, loadClientInsights, loadDurations, loadSalonInsight } from "@/lib/insights/read";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, formatMinute, startOfWeek, toLocal, type LocalDate } from "@/lib/scheduling/time";
import type { StaffRole } from "@/lib/staff";
import { scanDay, type Viewer } from "./scan";

type Supabase = SupabaseClient<Database>;

export type SalesPeriod = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_30_days";
export const SALES_PERIODS: SalesPeriod[] = ["today", "yesterday", "this_week", "last_week", "this_month", "last_30_days"];

export type Asker = { role: StaffRole; staffId: string; businessId: string; location: { id: string; timezone: string }; salon: string; today: LocalDate };

export type Knowledge = {
  clients: (firstName: string) => Promise<unknown>;
  overdue: (limit: number) => Promise<unknown>;
  durations: (filter: { staffId: string | null; serviceId: string | null }) => Promise<unknown>;
  salon: () => Promise<unknown>;
  schedule: (date: LocalDate) => Promise<unknown>;
  stock: (query: string | null) => Promise<unknown>;
  sales: ((period: SalesPeriod) => Promise<unknown>) | null;
  fixes: ((date: LocalDate) => Promise<unknown>) | null;
};

const WEEKDAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const pct = (rate: number | null | undefined) => (rate === null || rate === undefined ? null : Math.round(rate * 100));
const dollars = (cents: number) => Math.round(cents) / 100;
const hourText = (hour: number) => formatMinute(hour * 60);

export function canSeeSales(role: StaffRole): boolean {
  return canManage(role);
}

export function knowledgeFor(supabase: Supabase, me: Asker): Knowledge {
  const isStylist = me.role === "stylist";
  const frontOfHouse = me.role === "owner" || me.role === "manager" || me.role === "front_desk";
  const tz = me.location.timezone;
  const dateOf = (iso: string | null) => (iso ? toLocal(new Date(iso), tz).date : null);

  // Names, loaded once per question.
  let names: Promise<{ staff: Map<string, string>; services: Map<string, string> }> | null = null;
  const lookups = () =>
    (names ??= (async () => {
      const [staff, services] = await Promise.all([supabase.from("staff").select("id, first_name"), supabase.from("services").select("id, name")]);
      if (staff.error) throw staff.error;
      if (services.error) throw services.error;
      return { staff: new Map(staff.data.map((s) => [s.id, s.first_name])), services: new Map(services.data.map((s) => [s.id, s.name])) };
    })());

  const clientFacts = async (firstName: string, c: ClientInsight, spend: ClientSpend | null) => {
    const { staff, services } = await lookups();
    return {
      first_name: firstName,
      visits: c.visits,
      usual_gap_days: c.intervalDays,
      gap_from_enough_visits: c.intervalTrusted,
      last_visit: dateOf(c.lastVisit),
      next_due: dateOf(c.nextDue),
      due_status: c.due,
      days_overdue: c.overdueDays,
      next_booked: dateOf(c.nextBooked),
      usual_stylist: c.preferredStaffId ? (staff.get(c.preferredStaffId) ?? null) : null,
      usual_day: c.preferredWeekday ? WEEKDAY[c.preferredWeekday] : null,
      usual_time_of_day: c.timeOfDay,
      usual_services: c.usualServiceIds.map((id) => services.get(id) ?? "a service"),
      late_percent: pct(c.lateRate),
      no_show_percent: pct(c.noShowRate),
      cancel_percent: pct(c.cancelRate),
      churn_risk: c.churnRisk,
      ...(spend ? { retail_percent: pct(spend.retailRate), lifetime_spend_dollars: dollars(spend.lifetimeSpendCents), average_visit_dollars: spend.averageVisitCents === null ? null : dollars(spend.averageVisitCents) } : {}),
    };
  };

  return {
    async clients(firstName) {
      const name = firstName.trim().replace(/[%_,()]/g, "").slice(0, 40);
      if (!name) return { error: "Give a first name." };
      const { data, error } = await supabase.from("clients").select("id, first_name").eq("business_id", me.businessId).ilike("first_name", `${name}%`).limit(6);
      if (error) throw error;
      const known = await loadClientInsights(supabase, me.businessId, data.map((c) => c.id));
      const matches = await Promise.all(
        data.map(async (c, i) => {
          const k = known.get(c.id);
          return k ? { match: i + 1, ...(await clientFacts(c.first_name, k.habits, frontOfHouse ? k.spend : null)) } : { match: i + 1, first_name: c.first_name, visits: 0, due_status: "new" };
        }),
      );
      return { matches, note: matches.length > 1 ? "Several clients have this first name; ask which one if it matters." : undefined };
    },

    async overdue(limit) {
      const all = await loadAllClientInsights(supabase, me.businessId);
      const due = [...all]
        .filter(([, c]) => (c.due === "overdue" || c.due === "due_soon") && c.visits >= 2)
        .filter(([, c]) => !isStylist || c.preferredStaffId === me.staffId)
        .sort((a, b) => b[1].overdueDays - a[1].overdueDays);
      const top = due.slice(0, Math.min(Math.max(limit, 1), 20));
      const { data, error } = top.length ? await supabase.from("clients").select("id, first_name").in("id", top.map(([id]) => id)) : { data: [], error: null };
      if (error) throw error;
      const first = new Map(data.map((c) => [c.id, c.first_name]));
      const { staff } = await lookups();
      return {
        total_due_or_overdue: due.length,
        scope: isStylist ? "your regulars" : "all regulars (2+ visits)",
        clients: top.map(([id, c]) => ({
          first_name: first.get(id) ?? "a client",
          days_overdue: c.overdueDays,
          due_status: c.due,
          usual_gap_days: c.intervalDays,
          last_visit: dateOf(c.lastVisit),
          usual_stylist: c.preferredStaffId ? (staff.get(c.preferredStaffId) ?? null) : null,
          churn_risk: c.churnRisk,
        })),
      };
    },

    async durations({ staffId, serviceId }) {
      // Stylists see their own times only, and are told so.
      if (isStylist && staffId && staffId !== me.staffId) return { restricted: "Stylists can see their own times only, not other stylists'." };
      const only = isStylist ? me.staffId : staffId;
      const all = await loadDurations(supabase, me.businessId, only ? [only] : undefined);
      const { staff, services } = await lookups();
      const rows = [...all.values()]
        .filter((d) => !serviceId || d.serviceId === serviceId)
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 30)
        .map((d) => ({
          stylist: staff.get(d.staffId) ?? "a stylist",
          service: services.get(d.serviceId) ?? "a service",
          typical_minutes: d.medianMinutes,
          middle_half_minutes: `${d.p25Minutes}–${d.p75Minutes}`,
          visits_counted: d.visits,
          outliers_set_aside: d.outliers,
          trusted: d.trusted,
          consistency: d.consistency,
          trend: d.trend,
          trend_minutes: d.trendMinutes,
          menu_minutes: d.menuMinutes,
          usually_booked_minutes: d.bookedMinutes,
          ran_over_percent: pct(d.overrunRate),
          suggested_minutes: d.suggestedMinutes,
        }));
      return { scope: isStylist ? "your own services" : "all stylists", rows, note: rows.length ? undefined : "No timed visits for that yet." };
    },

    async salon() {
      const s = await loadSalonInsight(supabase, me.businessId, me.location.id);
      if (!s) return { error: "Nothing learned yet." };
      const { staff, services } = await lookups();
      const mine = (id: string | null) => (!isStylist || id === me.staffId ? (id ? (staff.get(id) ?? null) : null) : "(another stylist)");
      return {
        weeks_of_history: s.weeks,
        busiest_hours: s.busiest.map((h) => ({ day: WEEKDAY[h.weekday], hour: hourText(h.hour), booked_minutes_per_week: h.bookedMinutesPerWeek })),
        quietest_hours: s.quietest.map((h) => ({ day: WEEKDAY[h.weekday], hour: hourText(h.hour), booked_minutes_per_week: h.bookedMinutesPerWeek })),
        running_over_by_day: s.weekdays.map((w) => ({
          day: WEEKDAY[w.weekday],
          timed_visits: w.visits,
          ran_over_percent: pct(w.overrunRate),
          average_minutes_over: w.averageOverMinutes,
          stylist_running_over_most: mine(w.worstStaffId),
          stylist_ran_over_percent: !isStylist || w.worstStaffId === me.staffId ? pct(w.worstStaffRate) : null,
          services_running_over_most: w.worstServiceIds.map((id) => services.get(id) ?? "a service"),
        })),
        services_running_over: s.serviceOverruns.slice(0, 6).map((o) => ({ service: services.get(o.serviceId) ?? "a service", timed_visits: o.visits, ran_over_percent: pct(o.overrunRate), typical_minutes_over: o.typicalOverMinutes })),
        no_shows_by_day: s.noShowsByWeekday.map((n) => ({ day: WEEKDAY[n.key], visits: n.visits, no_show_percent: pct(n.rate) })),
        no_shows_by_time_of_day: s.noShowsByTimeOfDay.map((n) => ({ time_of_day: n.key, visits: n.visits, no_show_percent: pct(n.rate) })),
        rebooking_by_stylist: s.rebooking.filter((r) => !isStylist || r.staffId === me.staffId).map((r) => ({ stylist: staff.get(r.staffId) ?? "a stylist", visits: r.visits, rebooked_before_leaving_percent: pct(r.rebookedRate) })),
        salon_no_show_percent: pct(s.noShowRate),
        salon_ran_over_percent: pct(s.overrunRate),
        salon_rebooked_percent: isStylist ? null : pct(s.rebookedRate),
      };
    },

    async schedule(date) {
      const [{ data, error }, learned] = await Promise.all([
        supabase
          .from("appointment_items")
          .select("staff_id, service_id, starts_at, active_minutes, processing_minutes, finishing_minutes, appointment:appointments!inner(status, client:clients(first_name))")
          .eq("location_id", me.location.id)
          .gte("starts_at", startOfLocalDay(date, tz).toISOString())
          .lt("starts_at", startOfLocalDay(addDays(date, 1), tz).toISOString())
          .neq("appointment.status", "canceled")
          .order("starts_at"),
        loadDurations(supabase, me.businessId),
      ]);
      if (error) throw error;
      const { staff, services } = await lookups();
      return {
        date,
        visits: data.map((i) => {
          const start = toLocal(new Date(i.starts_at), tz).minute;
          const minutes = i.active_minutes + i.processing_minutes + i.finishing_minutes;
          const usual = learned.get(`${i.staff_id}:${i.service_id}`);
          return {
            time: `${formatMinute(start)}–${formatMinute(start + minutes)}`,
            stylist: staff.get(i.staff_id) ?? "a stylist",
            client: i.appointment.client?.first_name ?? "walk-in",
            service: services.get(i.service_id) ?? "a service",
            status: i.appointment.status,
            booked_minutes: minutes,
            stylist_usually_takes_minutes: usual?.trusted ? usual.medianMinutes : null,
          };
        }),
      };
    },

    async stock(query) {
      const { data, error } = await supabase
        .from("stock_levels")
        .select("on_hand, reorder_point, product:products!inner(brand, line, name, unit, type, is_active)")
        .eq("location_id", me.location.id)
        .eq("product.is_active", true);
      if (error) throw error;
      const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const rows = data
        .map((l) => ({
          product: [l.product.brand, l.product.line, l.product.name].filter(Boolean).join(" "),
          kind: l.product.type === "retail" ? "retail" : "back bar",
          on_hand: Number(l.on_hand),
          unit: l.product.unit === "unit" ? "units" : l.product.unit,
          reorder_point: Number(l.reorder_point),
          low: Number(l.on_hand) < Number(l.reorder_point),
        }))
        .filter((r) => (words.length ? words.every((w) => r.product.toLowerCase().includes(w)) : r.low));
      return { scope: words.length ? `matching "${query}"` : "low stock only", products: rows.slice(0, 25) };
    },

    sales: canSeeSales(me.role)
      ? async (period) => {
          const range = salesRange(period, me.today);
          const previous = { from: addDays(range.from, -daysIn(range)), to: addDays(range.from, -1) };
          const [now, before] = await Promise.all([salesBetween(supabase, me, range.from, range.to), salesBetween(supabase, me, previous.from, previous.to)]);
          // The changes, worked out here so Claude doesn't have to.
          return {
            period,
            from: range.from,
            to: range.to,
            ...now,
            previous_period: { from: previous.from, to: previous.to, ...before },
            change: {
              total_dollars: dollars(Math.round((now.total_dollars - before.total_dollars) * 100)),
              total_percent: before.total_dollars ? Math.round(((now.total_dollars - before.total_dollars) / before.total_dollars) * 1000) / 10 : null,
              visits: now.visits_checked_out - before.visits_checked_out,
              average_visit_dollars: now.average_visit_dollars !== null && before.average_visit_dollars !== null ? dollars(Math.round((now.average_visit_dollars - before.average_visit_dollars) * 100)) : null,
              no_shows: now.no_shows - before.no_shows,
            },
          };
        }
      : null,

    fixes: frontOfHouse
      ? async (date) => {
          const viewer: Viewer = { location: me.location, salon: me.salon, canBook: true };
          const state = await scanDay(supabase, viewer, date);
          return {
            date,
            problems: state.conflicts.map((c) => ({ problem: c.headline, kind: c.kind, options: c.options.map((o) => o.summary) })),
            note: state.conflicts.length ? "These fixes are in Denise's panel for staff to approve or dismiss." : "Nothing to fix that day.",
          };
        }
      : null,
  };
}

function daysIn(r: { from: LocalDate; to: LocalDate }): number {
  return Math.round((new Date(`${r.to}T12:00:00Z`).getTime() - new Date(`${r.from}T12:00:00Z`).getTime()) / 86_400_000) + 1;
}

export function salesRange(period: SalesPeriod, today: LocalDate): { from: LocalDate; to: LocalDate } {
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "this_week":
      return { from: startOfWeek(today), to: today };
    case "last_week":
      return { from: addDays(startOfWeek(today), -7), to: addDays(startOfWeek(today), -1) };
    case "this_month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "last_30_days":
      return { from: addDays(today, -29), to: today };
  }
}

// Checked-out services at the prices booked, retail sold, and visits.
async function salesBetween(supabase: Supabase, me: Asker, from: LocalDate, to: LocalDate) {
  const tz = me.location.timezone;
  const start = startOfLocalDay(from, tz).toISOString();
  const end = startOfLocalDay(addDays(to, 1), tz).toISOString();
  let serviceCents = 0;
  const visits = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("appointment_items")
      .select("appointment_id, price_cents, appointment:appointments!inner(status)")
      .eq("location_id", me.location.id)
      .eq("appointment.status", "completed")
      .gte("starts_at", start)
      .lt("starts_at", end)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    for (const i of data) {
      serviceCents += i.price_cents;
      visits.add(i.appointment_id);
    }
    if (data.length < 1000) break;
  }
  const { data: sales, error } = await supabase
    .from("stock_movements")
    .select("change, product:products(price_cents)")
    .eq("location_id", me.location.id)
    .eq("reason", "sale")
    .gte("created_at", start)
    .lt("created_at", end);
  if (error) throw error;
  const retailCents = sales.reduce((sum, m) => sum + -Number(m.change) * (m.product?.price_cents ?? 0), 0);
  const { count: noShows, error: noShowError } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("location_id", me.location.id)
    .eq("status", "no_show")
    .gte("starts_at", start)
    .lt("starts_at", end);
  if (noShowError) throw noShowError;
  return {
    services_dollars: dollars(serviceCents),
    retail_dollars: dollars(retailCents),
    total_dollars: dollars(serviceCents + retailCents),
    visits_checked_out: visits.size,
    average_visit_dollars: visits.size ? dollars(Math.round((serviceCents + retailCents) / visits.size)) : null,
    no_shows: noShows ?? 0,
  };
}
