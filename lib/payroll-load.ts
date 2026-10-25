// Loading payroll (worked out in ./payroll.ts and ./commission.ts): the
// sales behind each person's pay through payroll_sales (each line with the
// rate and plan version recorded when it was sold), from the start of any
// tier window the period is part of, the plans' rules (commission_rules),
// their pay history, and scheduled hours for anyone paid by the hour.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { roleLabel } from "@/lib/staff";
import { loadStaffSchedules, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, toLocal, type LocalDate } from "@/lib/scheduling/time";
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
  type PayrollSale,
  type PlanVersion,
  type RateHistory,
} from "./payroll";

type Supabase = SupabaseClient<Database>;

export async function loadPaySettings(supabase: Supabase, businessId: string): Promise<{ kind: PayPeriodKind; anchor: LocalDate }> {
  const { data, error } = await supabase.from("businesses").select("pay_period, pay_period_anchor").eq("id", businessId).single();
  if (error) throw error;
  return { kind: data.pay_period as PayPeriodKind, anchor: data.pay_period_anchor };
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
  const [sales, staff, history, rules] = await Promise.all([
    supabase.rpc("payroll_sales", { p_business_id: businessId, p_from: windowStart.toISOString(), p_to: to.toISOString(), p_staff_id: staffId }),
    staffQuery.order("first_name"),
    historyQuery,
    supabase.rpc("commission_rules", { p_business_id: businessId, p_staff_id: staffId }),
  ]);
  if (sales.error) throw sales.error;
  if (staff.error) throw staff.error;
  if (history.error) throw history.error;
  if (rules.error) throw rules.error;
  const list = sales.data as unknown as PayrollSale[];
  const versions = planVersions(rules.data);
  const dayOf = (iso: string) => toLocal(new Date(iso), timeZone).date;
  const histories = new Map<string, RateHistory>();
  for (const h of history.data) {
    // A change takes effect from the day it's made; the first rates from the start.
    const fromDate = h.effective_from === "-infinity" ? null : dayOf(h.effective_from);
    histories.set(h.staff_id, [...(histories.get(h.staff_id) ?? []), { from: fromDate, hourlyRateCents: h.hourly_rate_cents }]);
  }

  const hourly = [...histories.entries()].filter(([, h]) => h.some((x) => x.hourlyRateCents !== null)).map(([id]) => id);
  const through = period.to < today ? period.to : today;
  const schedules = hourly.length ? await loadStaffSchedules(supabase, hourly, period.from, period.to) : new Map();

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
          schedule ? hourlyPay(schedule, period.from, through, histories.get(s.id)!) : null,
          context,
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
