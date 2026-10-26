// What Ask Denise's tools can look up (./assistant.ts), worked out here
// from the data and what she's learned (lib/insights/). Read as the staff
// member asking (RLS applies), and trimmed for Claude:
//   - clients by first name only: never phone numbers, emails, addresses,
//     allergies, notes or payment details;
//   - stylists see their own stats only (durations, rebooking, overdue
//     regulars), and no money: no client spend or salon sales;
//   - sales figures for owners and managers.
// Every number is calculated here; Claude only reads them.

import { loadRewardsOverview } from "@/lib/rewards-load";
import { can } from "@/lib/permissions";
import { isFrontOfHouse } from "@/lib/staff";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canManage } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import type { ClientInsight } from "@/lib/insights/clients";
import type { ClientSpend } from "@/lib/insights/describe";
import { loadAllClientInsights, loadClientInsights, loadDurations, loadSalonInsight } from "@/lib/insights/read";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, formatMinute, fromLocal, startOfWeek, toLocal, type LocalDate } from "@/lib/scheduling/time";
import type { StaffRole } from "@/lib/staff";
import { loadGiftCardLiability, loadUnusedPackages } from "@/lib/reports-load";
import { FEE_KIND_LABELS, FEE_STATUS_LABELS, type FeeStatus } from "@/lib/policy";
import { loadPolicy } from "@/lib/policy-load";
import { repeatOffenders } from "@/lib/policy-report";
import { scanDay, type Viewer } from "./scan";
import { eventKnowledge } from "./events";

type Supabase = SupabaseClient<Database>;

export type SalesPeriod = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_30_days";
export const SALES_PERIODS: SalesPeriod[] = ["today", "yesterday", "this_week", "last_week", "this_month", "last_30_days"];

export type Asker = { role: StaffRole; permissions: readonly string[]; staffId: string; bookStaffId?: string | null; businessId: string; location: { id: string; timezone: string }; salon: string; today: LocalDate };

export type Knowledge = {
  clients: (firstName: string) => Promise<unknown>;
  // One client by id (the one on the page staff are looking at), with
  // their next visits as booked now.
  client: (clientId: string) => Promise<unknown>;
  overdue: (limit: number) => Promise<unknown>;
  durations: (filter: { staffId: string | null; serviceId: string | null }) => Promise<unknown>;
  salon: () => Promise<unknown>;
  schedule: (date: LocalDate) => Promise<unknown>;
  stock: (query: string | null) => Promise<unknown>;
  sales: ((period: SalesPeriod) => Promise<unknown>) | null;
  fixes: ((date: LocalDate) => Promise<unknown>) | null;
  // Owners only: what's owed on gift cards and unused packages.
  giftCards: (() => Promise<unknown>) | null;
  packages: ((limit: number) => Promise<unknown>) | null;
  // The rewards program: points outstanding, tiers and the top tier's
  // clients (first names). Owners and managers with reports.
  rewards: ((limit: number) => Promise<unknown>) | null;
  // The front of house: late cancellations and no-shows under the policy
  // (fee amounts for owners and managers).
  policy: ((period: PolicyPeriod) => Promise<unknown>) | null;
  // Events in a month (a stylist: theirs, no money), and what's left to
  // collect on one (the front of house).
  events: (month: string) => Promise<unknown>;
  eventBalance: ((name: string) => Promise<unknown>) | null;
};

export type PolicyPeriod = "this_month" | "last_month" | "last_30_days";
export const POLICY_PERIODS: PolicyPeriod[] = ["this_month", "last_month", "last_30_days"];

const WEEKDAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const pct = (rate: number | null | undefined) => (rate === null || rate === undefined ? null : Math.round(rate * 100));
const dollars = (cents: number) => Math.round(cents) / 100;
const hourText = (hour: number) => formatMinute(hour * 60);

// Sales and what the salon owes are reports (lib/permissions.ts).
export function canSeeSales(me: { permissions: readonly string[] }): boolean {
  return can(me, "reports");
}

export function knowledgeFor(supabase: Supabase, me: Asker): Knowledge {
  // Stylists and assistants see their own book: an assistant's is the
  // stylist they assist. Other stylists' times and rebooking need
  // see_team_numbers (an owner can allow it).
  const frontOfHouse = isFrontOfHouse(me.role);
  const isStylist = !frontOfHouse;
  const own = me.bookStaffId ?? me.staffId;
  const ownTimesOnly = isStylist && !can(me, "see_team_numbers");
  const tz = me.location.timezone;
  // Dates as Denise says them, weekday worked out here ("Sat, Oct 24", with
  // the year when it isn't this one), so Claude never has to.
  const dateOf = (iso: string | null) => (iso ? sayDate(toLocal(new Date(iso), tz).date, me.today) : null);

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

  const events = eventKnowledge(supabase, { businessId: me.businessId, timezone: tz, money: frontOfHouse, today: me.today }, (d) => sayDate(d, me.today));

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

    async client(clientId) {
      const { data, error } = await supabase.from("clients").select("id, first_name").eq("id", clientId).maybeSingle();
      if (error) throw error;
      if (!data) return { error: "I can't see that client." };
      const [known, upcoming] = await Promise.all([
        loadClientInsights(supabase, me.businessId, [clientId]),
        supabase
          .from("appointments")
          .select("starts_at, status, appointment_items(starts_at, services(name), staff(first_name))")
          .eq("client_id", clientId)
          .in("status", ["booked", "confirmed", "checked_in"])
          .gte("starts_at", startOfLocalDay(me.today, tz).toISOString())
          .order("starts_at")
          .limit(3),
      ]);
      if (upcoming.error) throw upcoming.error;
      const k = known.get(clientId);
      const facts = k ? await clientFacts(data.first_name, k.habits, frontOfHouse ? k.spend : null) : { first_name: data.first_name, visits: 0, due_status: "new" };
      return {
        ...facts,
        upcoming_visits: upcoming.data.map((a) => {
          const at = toLocal(new Date(a.starts_at), tz);
          const items = [...a.appointment_items].sort((x, y) => x.starts_at.localeCompare(y.starts_at));
          return {
            date: sayDate(at.date, me.today),
            time: formatMinute(at.minute),
            services: items.map((i) => i.services?.name ?? "a service"),
            stylists: [...new Set(items.map((i) => i.staff?.first_name ?? "a stylist"))],
            checked_in: a.status === "checked_in",
          };
        }),
      };
    },

    async overdue(limit) {
      const all = await loadAllClientInsights(supabase, me.businessId);
      const due = [...all]
        .filter(([, c]) => (c.due === "overdue" || c.due === "due_soon") && c.visits >= 2)
        .filter(([, c]) => !isStylist || c.preferredStaffId === own)
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
      if (ownTimesOnly && staffId && staffId !== own) return { restricted: "Stylists can see their own times only, not other stylists'." };
      const only = ownTimesOnly ? own : staffId;
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
          // Tapped times, or a rougher estimate from check-in to checkout.
          based_on: d.basis === "check_in_out" ? "check-in to checkout times (an estimate)" : "tapped start and finish times",
          middle_half_minutes: `${d.p25Minutes}–${d.p75Minutes}`,
          visits_counted: d.visits,
          outliers_set_aside: d.outliers,
          trusted: d.trusted,
          consistency: d.consistency,
          // Only real trends (significant, from enough recent visits).
          ...(d.trend !== "steady" ? { trend: d.trend === "faster" ? "getting faster" : "getting slower", trend_minutes: d.trendMinutes } : {}),
          menu_minutes: d.menuMinutes,
          usually_booked_minutes: d.bookedMinutes,
          ran_over_percent: pct(d.overrunRate),
          suggested_booking_minutes: d.suggestedMinutes,
        }));
      return { scope: ownTimesOnly ? "your own services" : "all stylists", rows, note: rows.length ? undefined : "No timed visits for that yet." };
    },

    async salon() {
      const s = await loadSalonInsight(supabase, me.businessId, me.location.id);
      if (!s) return { error: "Nothing learned yet." };
      const { staff, services } = await lookups();
      const mine = (id: string | null) => (!ownTimesOnly || id === own ? (id ? (staff.get(id) ?? null) : null) : "(another stylist)");
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
          stylist_ran_over_percent: !ownTimesOnly || w.worstStaffId === own ? pct(w.worstStaffRate) : null,
          services_running_over_most: w.worstServiceIds.map((id) => services.get(id) ?? "a service"),
          estimated_percent: pct(w.estimatedShare ?? 0),
        })),
        services_running_over: s.serviceOverruns.slice(0, 6).map((o) => ({ service: services.get(o.serviceId) ?? "a service", timed_visits: o.visits, ran_over_percent: pct(o.overrunRate), typical_minutes_over: o.typicalOverMinutes, estimated_percent: pct(o.estimatedShare ?? 0) })),
        no_shows_by_day: s.noShowsByWeekday.map((n) => ({ day: WEEKDAY[n.key], visits: n.visits, no_show_percent: pct(n.rate) })),
        no_shows_by_time_of_day: s.noShowsByTimeOfDay.map((n) => ({ time_of_day: n.key, visits: n.visits, no_show_percent: pct(n.rate) })),
        rebooking_by_stylist: s.rebooking.filter((r) => !ownTimesOnly || r.staffId === own).map((r) => ({ stylist: staff.get(r.staffId) ?? "a stylist", visits: r.visits, rebooked_before_leaving_percent: pct(r.rebookedRate) })),
        salon_no_show_percent: pct(s.noShowRate),
        salon_ran_over_percent: pct(s.overrunRate),
        // How much of the running-over figures comes from check-in to
        // checkout estimates (they count half) rather than tapped times.
        running_over_estimated_percent: pct(s.estimatedShare ?? null),
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
            ...(usual?.trusted && usual.basis === "check_in_out" ? { usual_time_based_on: "check-in to checkout times (an estimate)" } : {}),
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

    sales: canSeeSales(me)
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

    giftCards:
      canSeeSales(me)
        ? async () => {
            const l = await loadGiftCardLiability(supabase, me.businessId);
            return {
              purchased_balance_dollars: dollars(l.purchased.cents),
              cards_with_a_balance: l.purchased.count,
              promotional_balance_dollars: dollars(l.promotional.cents),
              promotional_cards: l.promotional.count,
              expired_balance_dollars: dollars(l.expired.cents),
              expired_cards: l.expired.count,
              note: "Purchased balances are services the salon owes; promotional credit has no cash value; what happens to expired balances depends on state law.",
            };
          }
        : null,

    packages:
      canSeeSales(me)
        ? async (limit) => {
            const p = await loadUnusedPackages(supabase, me.businessId);
            return {
              unused_value_dollars: dollars(p.cents),
              uses_left: p.uses,
              clients_with_unused_packages: p.clients.length,
              // Most value first, first names only.
              clients: p.clients.slice(0, Math.min(Math.max(limit, 1), 20)).map((c) => ({ first_name: c.firstName, packages: c.packages, uses_left: c.uses, value_dollars: dollars(c.cents) })),
            };
          }
        : null,

    rewards: canSeeSales(me)
      ? async (limit) => {
          const now = new Date();
          const since = new Date(now.getTime() - 90 * 86_400_000);
          const loaded = await loadRewardsOverview(supabase, me.businessId, since, now);
          if (!loaded) return { program: "off", note: "The salon has no rewards program on (Settings, then Rewards)." };
          const o = loaded.overview;
          const tierName = (id: string | null) => loaded.settings.tiers.find((t) => t.id === id)?.name ?? null;
          return {
            points_outstanding: o.outstanding,
            outstanding_estimated_value_dollars: o.outstandingCents ? dollars(o.outstandingCents) : null,
            value_note: o.outstandingCents ? "Estimated at the best amount-off reward; not a cash debt." : "No amount-off reward to value points by.",
            clients_in_the_program: o.members,
            clients_by_tier: o.byTier.map((t) => ({ tier: t.name, clients: t.count })),
            last_90_days: { points_earned: o.earned, points_redeemed: o.redeemed, rewards_taken: o.redemptions, redemption_rate_percent: o.redemptionRate, points_expired: o.expired, referrals_completed: o.referrals.completed },
            vips: {
              means: loaded.settings.tiers.length ? `clients in the top tier (${o.byTier[0]?.name})` : "the biggest spenders over the last 12 months (no tiers set up)",
              total: o.vips.length,
              clients: o.vips.slice(0, Math.min(Math.max(limit, 1), 20)).map((m) => ({ first_name: m.firstName, tier: tierName(m.tierId), points: m.balance, spent_last_12_months_dollars: dollars(m.spendCents), visits_last_12_months: m.visits })),
            },
          };
        }
      : null,

    policy: frontOfHouse
      ? async (period) => {
          const monthStart = `${me.today.slice(0, 7)}-01` as LocalDate;
          const range =
            period === "this_month"
              ? { from: monthStart, to: addDays(me.today, 1) }
              : period === "last_month"
                ? { from: `${addDays(monthStart, -1).slice(0, 7)}-01` as LocalDate, to: monthStart }
                : { from: addDays(me.today, -29), to: addDays(me.today, 1) };
          const policy = await loadPolicy(supabase, me.businessId);
          const since = new Date();
          since.setUTCMonth(since.getUTCMonth() - policy.settings.repeatMonths);
          const select = "id, kind, fee_cents, from_deposit_cents, status, created_at, client_id, client:clients(first_name, last_name), appointment:appointments(starts_at)";
          const [inPeriod, recent] = await Promise.all([
            supabase.from("policy_fees").select(select).eq("business_id", me.businessId).neq("status", "voided")
              .gte("created_at", fromLocal(range.from, 0, tz)!.toISOString()).lt("created_at", fromLocal(range.to, 0, tz)!.toISOString()).order("created_at"),
            supabase.from("policy_fees").select(select).eq("business_id", me.businessId).gte("created_at", since.toISOString()),
          ]);
          if (inPeriod.error) throw inPeriod.error;
          if (recent.error) throw recent.error;
          const money = canManage(me.role);
          const offenders = repeatOffenders(
            recent.data.map((f) => ({ id: f.id, kind: f.kind as "late_cancel" | "no_show", feeCents: f.fee_cents, fromDepositCents: f.from_deposit_cents, status: f.status, createdAt: f.created_at, clientId: f.client_id, clientName: f.client.first_name })),
            policy.settings.repeatCount,
          );
          return {
            period,
            late_cancellations: inPeriod.data.filter((f) => f.kind === "late_cancel").length,
            no_shows: inPeriod.data.filter((f) => f.kind === "no_show").length,
            // First names only.
            incidents: inPeriod.data.map((f) => ({
              first_name: f.client.first_name,
              what: FEE_KIND_LABELS[f.kind as "late_cancel" | "no_show"],
              visit_date: dateOf(f.appointment.starts_at),
              fee: FEE_STATUS_LABELS[f.status as FeeStatus],
              ...(money ? { fee_dollars: dollars(f.fee_cents) } : {}),
            })),
            repeat_offenders: offenders.map((o) => ({ first_name: o.clientName, strikes: o.strikes })),
            rule: `${policy.settings.repeatCount}+ in ${policy.settings.repeatMonths} months is a repeat offender${policy.settings.repeatAction === "off" ? "" : policy.settings.repeatAction === "prepay" ? ", who pays for the visit up front" : `, who pays a ${policy.settings.repeatDepositPercent}% deposit`}.`,
          };
        }
      : null,

    events: (month) => events.inMonth(month),
    eventBalance: frontOfHouse ? (name) => events.balance(name) : null,

    fixes: frontOfHouse
      ? async (date) => {
          const viewer: Viewer = { location: me.location, salon: me.salon, canBook: true };
          const state = await scanDay(supabase, viewer, date);
          return {
            date,
            // Clients by first name only.
            problems: state.conflicts.map((c) => ({ problem: c.firstNames.headline, kind: c.kind, options: c.firstNames.options })),
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
// Checked-out service and retail sales between two dates (also the
// Dashboard's "this week").
export async function salesBetween(supabase: Supabase, me: Pick<Asker, "location">, from: LocalDate, to: LocalDate) {
  const tz = me.location.timezone;
  const start = startOfLocalDay(from, tz).toISOString();
  const end = startOfLocalDay(addDays(to, 1), tz).toISOString();
  // From the sales taken (not voided): services and retail before tax, net
  // of discounts and returned products; tax, tips and refunds on their own.
  let serviceCents = 0;
  let retailCents = 0;
  let taxCents = 0;
  let tipCents = 0;
  let refundCents = 0;
  const visits = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("sales")
      .select("id, appointment_id, tax_cents, tip_cents, refunded_cents, sale_items(kind, quantity, returned_quantity, unit_price_cents, discount_cents)")
      .eq("location_id", me.location.id)
      .neq("status", "voided")
      .gte("created_at", start)
      .lt("created_at", end)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    for (const sale of data) {
      for (const i of sale.sale_items) {
        const net = i.unit_price_cents * i.quantity - i.discount_cents;
        const kept = i.quantity ? Math.round((net * (i.quantity - i.returned_quantity)) / i.quantity) : 0;
        if (i.kind === "service") serviceCents += kept;
        else if (i.kind === "product") retailCents += kept;
      }
      taxCents += sale.tax_cents;
      tipCents += sale.tip_cents;
      refundCents += sale.refunded_cents;
      if (sale.appointment_id) visits.add(sale.appointment_id);
    }
    if (data.length < 1000) break;
  }
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
    tax_dollars: dollars(taxCents),
    tips_dollars: dollars(tipCents),
    refunds_dollars: dollars(refundCents),
    visits_checked_out: visits.size,
    average_visit_dollars: visits.size ? dollars(Math.round((serviceCents + retailCents) / visits.size)) : null,
    no_shows: noShows ?? 0,
  };
}

// "2026-10-24" -> "Sat, Oct 24" (", 2025" added for another year).
export function sayDate(date: LocalDate, today: LocalDate): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}),
  });
}
