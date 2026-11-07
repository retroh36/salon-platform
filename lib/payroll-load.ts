// Loading payroll (worked out in ./payroll.ts and ./commission.ts): the
// sales behind each person's pay through payroll_sales (each line with the
// rate and plan version recorded when it was sold), from the start of any
// tier window the period is part of, the plans' rules (commission_rules),
// their pay history, and scheduled and clocked hours for anyone paid by
// the hour (which pays is the salon's choice, businesses.payroll_hours),
// and how working roles paid each day (working_role_pay_history) for
// anyone with shifts in them.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { roleLabel } from "@/lib/staff";
import { loadStaffSchedules, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { entryDay, entryMinutes } from "@/lib/time-clock";
import { parseRules } from "./commission";
import {
  hourlyPay,
  payLine,
  periodContaining,
  planContext,
  ticketsFor,
  windowsFrom,
  type PayLine,
  type PayPeriod,
  type PayPeriodKind,
  type HoursBasis,
  type PayrollSale,
  type PlanVersion,
  type RateHistory,
  type RoleNames,
  type RolePayOn,
} from "./payroll";
import type { PayMethod } from "./working-roles";

type Supabase = SupabaseClient<Database>;

export async function loadPaySettings(supabase: Supabase, businessId: string): Promise<{ kind: PayPeriodKind; anchor: LocalDate; hours: HoursBasis; timeClock: boolean }> {
  const { data, error } = await supabase.from("businesses").select("pay_period, pay_period_anchor, payroll_hours, time_clock").eq("id", businessId).single();
  if (error) throw error;
  return { kind: data.pay_period as PayPeriodKind, anchor: data.pay_period_anchor, hours: data.payroll_hours as HoursBasis, timeClock: data.time_clock };
}

// Minutes clocked by person and local day, from `from` to `to`, for some
// people (RLS: yourself, or the team's with team or payroll). A missed
// clock-out counts nothing; a shift still open counts to now.
async function clockedByDay(supabase: Supabase, staffIds: string[], from: LocalDate, to: LocalDate, timeZone: string, now: Date): Promise<Map<string, Map<LocalDate, number>>> {
  const { data, error } = await supabase
    .from("time_clock_entries")
    .select("staff_id, clock_in, clock_out, missed_out")
    .in("staff_id", staffIds)
    .gte("clock_in", startOfLocalDay(from, timeZone).toISOString())
    .lt("clock_in", startOfLocalDay(addDays(to, 1), timeZone).toISOString())
    .limit(20000);
  if (error) throw error;
  const out = new Map<string, Map<LocalDate, number>>(staffIds.map((id) => [id, new Map()]));
  for (const r of data) {
    const e = { clockIn: new Date(r.clock_in), clockOut: r.clock_out ? new Date(r.clock_out) : null, missedOut: r.missed_out };
    const days = out.get(r.staff_id)!;
    const day = entryDay(e, timeZone);
    days.set(day, (days.get(day) ?? 0) + entryMinutes(e, now));
  }
  return out;
}

type RolePayRow = { role_id: string; staff_id: string | null; effective_from: string; method: string | null; hourly_rate_cents: number | null };

// How a role paid one person on a day: the role's pay in effect then, with
// their own rate in it (set after the role's) over the role's. Roles not
// in use (`inUse`) pay as no role.
export function rolePayOn(rows: readonly RolePayRow[], staffId: string, dayOf: (iso: string) => LocalDate, inUse: ReadonlySet<string>): RolePayOn {
  const fromOf = (r: RolePayRow) => (r.effective_from === "-infinity" ? null : dayOf(r.effective_from));
  const latest = (list: RolePayRow[], date: LocalDate) => list.filter((r) => fromOf(r) === null || fromOf(r)! <= date).at(-1);
  return (roleId, date) => {
    if (!inUse.has(roleId)) return null;
    const role = latest(rows.filter((r) => r.role_id === roleId && r.staff_id === null), date);
    if (!role?.method) return null;
    const own = latest(rows.filter((r) => r.role_id === roleId && r.staff_id === staffId), date);
    return { method: role.method as PayMethod, hourlyRateCents: own?.hourly_rate_cents ?? role.hourly_rate_cents };
  };
}

// Pay for a period: everyone (owners and managers), or one person (staffId;
// anyone may load their own). Hours count only up to today.
export async function loadPayroll(
  supabase: Supabase,
  businessId: string,
  timeZone: string,
  period: PayPeriod,
  today: LocalDate,
  staffId?: string,
): Promise<PayLine[]> {
  const settings = await loadPaySettings(supabase, businessId);
  const periodOf = (date: LocalDate) => periodContaining(settings.kind, settings.anchor, date);
  const earliest = windowsFrom(period, periodOf);
  const windowStart = startOfLocalDay(earliest, timeZone);
  const from = startOfLocalDay(period.from, timeZone);
  const to = startOfLocalDay(addDays(period.to, 1), timeZone);
  let staffQuery = supabase.from("staff").select("id, first_name, last_name, role, is_active").eq("business_id", businessId);
  if (staffId) staffQuery = staffQuery.eq("id", staffId);
  // Their pay history: who has rates, and who was paid by the hour when.
  let historyQuery = supabase
    .from("staff_compensation_history")
    .select("staff_id, effective_from, hourly_rate_cents")
    .eq("business_id", businessId)
    .lt("effective_from", to.toISOString())
    .order("effective_from");
  if (staffId) historyQuery = historyQuery.eq("staff_id", staffId);
  let rolePeopleQuery = supabase.from("staff_working_roles").select("staff_id").eq("business_id", businessId);
  if (staffId) rolePeopleQuery = rolePeopleQuery.eq("staff_id", staffId);
  const [sales, staff, history, rules, roles, rolePay, rolePeople] = await Promise.all([
    supabase.rpc("payroll_sales", { p_business_id: businessId, p_from: windowStart.toISOString(), p_to: to.toISOString(), p_staff_id: staffId }),
    staffQuery.order("first_name"),
    historyQuery,
    supabase.rpc("commission_rules", { p_business_id: businessId, p_staff_id: staffId }),
    supabase.from("working_roles").select("id, name, archived_at").eq("business_id", businessId),
    supabase
      .from("working_role_pay_history")
      .select("role_id, staff_id, effective_from, method, hourly_rate_cents")
      .eq("business_id", businessId)
      .lt("effective_from", to.toISOString())
      .order("effective_from")
      .order("id"),
    rolePeopleQuery,
  ]);
  if (sales.error) throw sales.error;
  if (staff.error) throw staff.error;
  if (history.error) throw history.error;
  if (rules.error) throw rules.error;
  if (roles.error) throw roles.error;
  if (rolePay.error) throw rolePay.error;
  if (rolePeople.error) throw rolePeople.error;
  const list = sales.data as unknown as PayrollSale[];
  const versions = planVersions(rules.data);
  const dayOf = (iso: string) => toLocal(new Date(iso), timeZone).date;
  const histories = new Map<string, RateHistory>();
  for (const h of history.data) {
    // A change takes effect from the day it's made; the first rates from the start.
    const fromDate = h.effective_from === "-infinity" ? null : dayOf(h.effective_from);
    histories.set(h.staff_id, [...(histories.get(h.staff_id) ?? []), { from: fromDate, hourlyRateCents: h.hourly_rate_cents }]);
  }

  const inUse = new Set(roles.data.filter((r) => !r.archived_at).map((r) => r.id));
  // How each role pays now, for its name on the page.
  const nowPay = new Map<string, PayMethod>();
  for (const r of rolePay.data) if (r.staff_id === null && r.method) nowPay.set(r.role_id, r.method as PayMethod);
  const roleNames: RoleNames = new Map(roles.data.map((r) => [r.id, { name: r.name, method: nowPay.get(r.id) ?? "usual" }]));
  // Hours for anyone paid by the hour, or working a role.
  const hourly = [
    ...new Set([...[...histories.entries()].filter(([, h]) => h.some((x) => x.hourlyRateCents !== null)).map(([id]) => id), ...rolePeople.data.map((r) => r.staff_id)]),
  ];
  const through = period.to < today ? period.to : today;
  const [schedules, clocked] = await Promise.all([
    hourly.length ? loadStaffSchedules(supabase, hourly, period.from, period.to) : new Map(),
    hourly.length && settings.timeClock && period.from <= through ? clockedByDay(supabase, hourly, period.from, through, timeZone, new Date()) : null,
  ]);

  return staff.data
    .map((s) => {
      const tickets = ticketsFor(list, s.id, from, to);
      const schedule = schedules.get(s.id);
      const context = planContext({
        versions,
        dayOf,
        periodOf,
        before: earliest < period.from ? ticketsFor(list, s.id, windowStart, from) : [],
      });
      return {
        active: s.is_active,
        line: payLine(
          { staffId: s.id, name: `${s.first_name} ${s.last_name}`, role: roleLabel(s.role) },
          tickets,
          schedule
            ? hourlyPay(schedule, period.from, through, histories.get(s.id) ?? [], {
                clocked: clocked?.get(s.id) ?? null,
                basis: settings.hours,
                roles: rolePayOn(rolePay.data, s.id, dayOf, inUse),
              })
            : null,
          context,
          roleNames,
        ),
      };
    })
    .filter(({ active, line }) => staffId || line.totalCents !== 0 || line.tickets.length > 0 || (active && histories.has(line.staffId)))
    .map(({ line }) => line);
}

// commission_rules' versions, in our shape.
export function planVersions(data: unknown): PlanVersion[] {
  return ((data ?? []) as { id: string; plan_id: string; name: string; rules: unknown; created_at: string }[]).map((v) => ({
    id: v.id,
    planId: v.plan_id,
    name: v.name,
    rules: parseRules(v.rules),
    createdAt: v.created_at,
  }));
}
