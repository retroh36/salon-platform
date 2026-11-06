import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { minutesOn, periodContaining } from "@/lib/payroll";
import { loadPaySettings } from "@/lib/payroll-load";
import { minutesOff, periodEndsBetween, ptoStatement, yearStartOf, type PtoPolicy, type PtoStatement, type PtoUse } from "@/lib/pto";
import { hoursOn } from "@/lib/scheduling/availability";
import { loadStaffSchedules } from "@/lib/scheduling/load";
import { addDays, datesBetween, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { entryDay, entryMinutes } from "@/lib/time-clock";
import { loadEntries } from "@/lib/time-clock-load";

type Supabase = SupabaseClient<Database>;

export type TimeOffType = { id: string; name: string; reason: Database["public"]["Enums"]["time_off_reason"]; usesPto: boolean; archived: boolean };

// The salon's types of time off, in order (archived ones last, for time
// off taken under them before).
export async function loadTimeOffTypes(supabase: Supabase, businessId: string): Promise<TimeOffType[]> {
  const { data, error } = await supabase.from("time_off_types").select("id, name, reason, uses_pto, archived_at, position").eq("business_id", businessId).order("position");
  if (error) throw error;
  return data
    .map((t) => ({ id: t.id, name: t.name, reason: t.reason, usesPto: t.uses_pto, archived: t.archived_at !== null }))
    .sort((a, b) => Number(a.archived) - Number(b.archived));
}

export type PolicyRow = Database["public"]["Tables"]["pto_policies"]["Row"];

export const toPolicy = (r: PolicyRow): PtoPolicy => ({
  accrual: r.accrual as PtoPolicy["accrual"],
  yearlyMinutes: r.yearly_minutes,
  prorateFirstYear: r.prorate_first_year,
  earnMinutes: r.earn_minutes,
  perHours: r.per_hours,
  periodMinutes: r.period_minutes,
  yearStartMonth: r.year_start_month,
  carryOver: r.carry_over as PtoPolicy["carryOver"],
  carryMinutes: r.carry_minutes,
  capMinutes: r.cap_minutes,
  trackingFrom: r.tracking_from,
});

// The policy row, as saved (null: never set up).
export async function loadPolicyRow(supabase: Supabase, businessId: string): Promise<PolicyRow | null> {
  const { data, error } = await supabase.from("pto_policies").select("*").eq("business_id", businessId).maybeSingle();
  if (error) throw error;
  return data;
}

export type PersonBalance = {
  staffId: string;
  firstName: string;
  lastName: string;
  role: string;
  startsOn: LocalDate;
  statement: PtoStatement;
  // This PTO year's time off taken (to today) by type, PTO or not.
  takenByType: Map<string, number>;
};

// Everyone's PTO at a location (or one person), as of today: the policy's
// roles, active, each from the later of the tracking date and their first
// day. Hours worked are clocked hours where the salon uses the time clock,
// else scheduled hours. RLS decides what's readable: yourself, or the
// team's with `team` or `payroll`.
export async function loadBalances(
  supabase: Supabase,
  opts: { businessId: string; location: { id: string; timezone: string }; today: LocalDate; staffId?: string },
): Promise<{ policy: PtoPolicy; row: PolicyRow; types: TimeOffType[]; people: PersonBalance[] } | null> {
  const row = await loadPolicyRow(supabase, opts.businessId);
  if (!row?.is_on) return null;
  const policy = toPolicy(row);
  const { today, location } = opts;
  const tz = location.timezone;

  let staffQuery = supabase.from("staff").select("id, first_name, last_name, role, created_at").eq("location_id", location.id).eq("is_active", true).in("role", row.roles).order("first_name");
  if (opts.staffId) staffQuery = staffQuery.eq("id", opts.staffId);
  const [types, staff, business] = await Promise.all([loadTimeOffTypes(supabase, opts.businessId), staffQuery, supabase.from("businesses").select("time_clock").eq("id", opts.businessId).single()]);
  if (staff.error) throw staff.error;
  if (business.error) throw business.error;
  if (!staff.data.length) return { policy, row, types, people: [] };

  const ids = staff.data.map((s) => s.id);
  const from = policy.trackingFrom < today ? policy.trackingFrom : today;
  const to = addDays(today, 366);
  const yearStart = yearStartOf(today, policy.yearStartMonth);
  const [schedules, timeOff, adjustments, entries, pay] = await Promise.all([
    loadStaffSchedules(supabase, ids, from, to),
    supabase.from("staff_time_off").select("id, staff_id, type_id, starts_on, ends_on, start_minute, end_minute, status").in("staff_id", ids).in("status", ["approved", "requested"]).lte("starts_on", to).gte("ends_on", from),
    supabase.from("pto_adjustments").select("staff_id, on_date, minutes, reason").in("staff_id", ids).order("on_date").order("created_at"),
    policy.accrual === "per_hour" && business.data.time_clock ? loadEntries(supabase, location, from, today) : Promise.resolve(null),
    policy.accrual === "per_period" ? loadPaySettings(supabase, opts.businessId) : Promise.resolve(null),
  ]);
  if (timeOff.error) throw timeOff.error;
  if (adjustments.error) throw adjustments.error;
  const typeOf = new Map(types.map((t) => [t.id, t]));
  const now = new Date();

  const people = staff.data.map((s) => {
    const schedule = schedules.get(s.id)!;
    const firstDay = toLocal(new Date(s.created_at), tz).date;
    const startsOn = firstDay > policy.trackingFrom ? firstDay : policy.trackingFrom;

    const worked = new Map<LocalDate, number>();
    if (policy.accrual === "per_hour" && startsOn <= today) {
      if (entries) {
        for (const e of entries.filter((e) => e.staffId === s.id)) worked.set(entryDay(e, tz), (worked.get(entryDay(e, tz)) ?? 0) + entryMinutes(e, now));
      } else {
        for (const d of datesBetween(startsOn, addDays(today, -1))) worked.set(d, minutesOn(schedule, d));
      }
    }

    const uses: PtoUse[] = [];
    const pending: PtoUse[] = [];
    const takenByType = new Map<string, number>();
    for (const t of timeOff.data.filter((t) => t.staff_id === s.id)) {
      const type = t.type_id ? typeOf.get(t.type_id) : undefined;
      const span = { startsOn: t.starts_on, endsOn: t.ends_on, startMinute: t.start_minute, endMinute: t.end_minute };
      for (const d of datesBetween(t.starts_on < startsOn ? startsOn : t.starts_on, t.ends_on)) {
        const minutes = minutesOff(hoursOn(schedule, d), span, d);
        if (!minutes) continue;
        if (t.status === "approved" && type && d >= yearStart && d <= today) takenByType.set(type.id, (takenByType.get(type.id) ?? 0) + minutes);
        if (!type?.usesPto) continue;
        (t.status === "approved" ? uses : pending).push({ date: d, minutes, label: type.name });
      }
    }

    const periodEnds = pay ? periodEndsBetween(startsOn, today, (d) => periodContaining(pay.kind, pay.anchor, d)) : [];
    const statement = ptoStatement(
      policy,
      {
        startsOn,
        worked,
        periodEnds,
        uses: uses.sort((a, b) => a.date.localeCompare(b.date)),
        pending,
        adjustments: adjustments.data.filter((a) => a.staff_id === s.id).map((a) => ({ date: a.on_date, minutes: a.minutes, reason: a.reason })),
      },
      today,
    );
    return { staffId: s.id, firstName: s.first_name, lastName: s.last_name, role: s.role, startsOn, statement, takenByType };
  });
  return { policy, row, types, people };
}

// The PTO a stretch of time off would take from someone, by their hours.
export async function ptoMinutesFor(
  supabase: Supabase,
  staffId: string,
  span: { startsOn: LocalDate; endsOn: LocalDate; startMinute: number | null; endMinute: number | null },
): Promise<number> {
  const schedule = (await loadStaffSchedules(supabase, [staffId], span.startsOn, span.endsOn)).get(staffId)!;
  return datesBetween(span.startsOn, span.endsOn).reduce((n, d) => n + minutesOff(hoursOn(schedule, d), span, d), 0);
}
