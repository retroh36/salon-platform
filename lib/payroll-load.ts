// Loading payroll (worked out in ./payroll.ts): the sales behind each
// person's pay through payroll_sales, their rates, and scheduled hours for
// anyone paid by the hour.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { roleLabel } from "@/lib/staff";
import { loadStaffSchedules, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, type LocalDate } from "@/lib/scheduling/time";
import { payLine, scheduledMinutes, ticketsFor, type PayLine, type PayPeriod, type PayPeriodKind, type PayrollSale } from "./payroll";

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
  const from = startOfLocalDay(period.from, timeZone);
  const to = startOfLocalDay(addDays(period.to, 1), timeZone);
  let staffQuery = supabase.from("staff").select("id, first_name, last_name, role, is_active").eq("business_id", businessId);
  if (staffId) staffQuery = staffQuery.eq("id", staffId);
  let compQuery = supabase.from("staff_compensation").select("staff_id, service_commission_pct, retail_commission_pct, hourly_rate_cents").eq("business_id", businessId);
  if (staffId) compQuery = compQuery.eq("staff_id", staffId);
  const [sales, staff, comp] = await Promise.all([
    supabase.rpc("payroll_sales", { p_business_id: businessId, p_from: from.toISOString(), p_to: to.toISOString(), p_staff_id: staffId }),
    staffQuery.order("first_name"),
    compQuery,
  ]);
  if (sales.error) throw sales.error;
  if (staff.error) throw staff.error;
  if (comp.error) throw comp.error;
  const list = sales.data as unknown as PayrollSale[];
  const rates = new Map(comp.data.map((c) => [c.staff_id, c]));

  const hourly = comp.data.filter((c) => c.hourly_rate_cents !== null).map((c) => c.staff_id);
  const through = period.to < today ? period.to : today;
  const schedules = hourly.length ? await loadStaffSchedules(supabase, hourly, period.from, period.to) : new Map();

  return staff.data
    .map((s) => {
      const r = rates.get(s.id);
      const tickets = ticketsFor(list, s.id, from, to);
      const schedule = schedules.get(s.id);
      return {
        active: s.is_active,
        line: payLine(
          { staffId: s.id, name: `${s.first_name} ${s.last_name}`, role: roleLabel(s.role) },
          { servicePct: Number(r?.service_commission_pct ?? 0), retailPct: Number(r?.retail_commission_pct ?? 0), hourlyRateCents: r?.hourly_rate_cents ?? null },
          tickets,
          schedule ? scheduledMinutes(schedule, period.from, through) : null,
        ),
      };
    })
    .filter(({ active, line }) => staffId || line.totalCents !== 0 || line.tickets.length > 0 || (active && rates.has(line.staffId)))
    .map(({ line }) => line);
}
