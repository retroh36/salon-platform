// Ask Denise about time off and PTO: "How much PTO do I have?", "Who's off
// next week?", "How many sick days has Nola taken this year?". Our code
// works out every number (lib/pto.ts, lib/pto-load.ts); Claude only says
// them. Everyone can ask about themselves; owners and managers (who manage
// the team or run payroll) about anyone. People go to Claude by first
// name, and time off by its type and dates, never its note.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatPto, yearStartOf, type PtoStatement } from "@/lib/pto";
import { loadBalances, loadPolicyRow, loadTimeOffDays, toPolicy, type TimeOffStretch } from "@/lib/pto-load";
import { formatMinute, isLocalDate, daysBetween, type LocalDate } from "@/lib/scheduling/time";

type Supabase = SupabaseClient<Database>;
type Say = (d: LocalDate) => string;

// The longest stretch "who's off" looks at.
export const MAX_OFF_DAYS = 62;

const typeName = (s: TimeOffStretch) => s.type?.name ?? "Time off";
const partOf = (s: TimeOffStretch) => (s.startMinute === null ? null : `${formatMinute(s.startMinute)}–${formatMinute(s.endMinute ?? 1440)}`);

// A stretch as Denise says it: "Sat, Nov 14" or "Sat, Nov 14 to Tue, Nov 17",
// with the hours for part of a day.
function when(s: TimeOffStretch, say: Say): string {
  const days = s.startsOn === s.endsOn ? say(s.startsOn) : `${say(s.startsOn)} to ${say(s.endsOn)}`;
  const part = partOf(s);
  return part ? `${days}, ${part}` : days;
}

// Time off taken by type: whole working days, part days and hours.
export function takenByType(stretches: readonly TimeOffStretch[]) {
  const byType = new Map<string, { type: string; uses_pto: boolean; days: number; part_days: number; minutes: number }>();
  for (const s of stretches) {
    const key = s.type?.id ?? "none";
    const row = byType.get(key) ?? { type: typeName(s), uses_pto: s.type?.usesPto ?? false, days: 0, part_days: 0, minutes: 0 };
    for (const d of s.days) {
      if (s.startMinute === null) row.days += 1;
      else row.part_days += 1;
      row.minutes += d.minutes;
    }
    byType.set(key, row);
  }
  return [...byType.values()].filter((r) => r.minutes > 0).map(({ minutes, ...r }) => ({ ...r, hours: formatPto(minutes) }));
}

// One person's PTO and time off: the balance when the salon tracks PTO,
// time off taken since `since` (to today) by type, and what's coming up.
export function ptoFacts(
  person: { firstName: string },
  statement: PtoStatement | null,
  stretches: readonly TimeOffStretch[],
  { since, today, say }: { since: LocalDate; today: LocalDate; say: Say },
) {
  const past = stretches.map((s) => ({ ...s, days: s.days.filter((d) => d.date >= since && d.date <= today) }));
  const ahead = stretches.filter((s) => s.endsOn > today);
  return {
    first_name: person.firstName,
    pto: statement
      ? {
          balance: formatPto(statement.balance),
          left_to_ask_for: formatPto(statement.available),
          booked_ahead: formatPto(statement.booked),
          waiting_for_a_decision: formatPto(statement.pending),
          earned_this_pto_year: formatPto(statement.earnedThisYear),
          used_this_pto_year: formatPto(statement.usedThisYear),
          carried_in: formatPto(statement.carriedIn),
          pto_year_started: say(statement.yearStart),
        }
      : "The salon doesn't track PTO in Maestra.",
    time_off_taken_since: say(since),
    taken_by_type: past.filter((s) => s.status === "approved").length ? takenByType(past.filter((s) => s.status === "approved")) : [],
    coming_up: ahead.map((s) => ({ type: typeName(s), when: when(s, say), status: s.status === "approved" ? "approved" : "asked for, waiting" })),
  };
}

// Who's off between two days: each person's time off there, approved, and
// (for owners and managers) asked for.
export function offFacts(stretches: readonly TimeOffStretch[], { from, to, say }: { from: LocalDate; to: LocalDate; say: Say }) {
  const off = stretches.filter((s) => s.days.length);
  return {
    from: say(from),
    to: say(to),
    off: off.map((s) => ({
      first_name: s.firstName,
      type: typeName(s),
      when: when(s, say),
      working_days_off_in_range: s.days.length,
      status: s.status === "approved" ? "approved" : "asked for, waiting",
    })),
    ...(off.length ? {} : { note: "Nobody has time off then." }),
  };
}

export function ptoKnowledge(
  supabase: Supabase,
  me: { staffId: string; businessId: string; location: { id: string; timezone: string }; today: LocalDate },
  say: Say,
  { everyone }: { everyone: boolean },
) {
  const { today } = me;
  // Who a first name is: anyone at the location for owners and managers,
  // else only the person asking.
  async function personFor(firstName: string | null): Promise<{ id: string; firstName: string } | { error: string }> {
    const { data, error } = await supabase.from("staff").select("id, first_name").eq("location_id", me.location.id).eq("is_active", true);
    if (error) throw error;
    const self = data.find((s) => s.id === me.staffId);
    const name = firstName?.trim().toLowerCase();
    if (!name || name === self?.first_name.toLowerCase()) return self ? { id: self.id, firstName: self.first_name } : { error: "I couldn't find you on the team." };
    if (!everyone) return { error: "I can only tell you about your own time off and PTO. Owners and managers can see everyone's." };
    const matches = data.filter((s) => s.first_name.toLowerCase() === name);
    if (matches.length !== 1) return { error: matches.length ? `More than one ${firstName} on the team.` : `Nobody called ${firstName} on the team.` };
    return { id: matches[0].id, firstName: matches[0].first_name };
  }

  return {
    async balance(firstName: string | null) {
      const who = await personFor(firstName);
      if ("error" in who) return who;
      const row = await loadPolicyRow(supabase, me.businessId);
      // "This year" is the PTO year where the salon tracks it, else the
      // calendar year.
      const since = row?.is_on ? yearStartOf(today, toPolicy(row).yearStartMonth) : `${today.slice(0, 4)}-01-01`;
      const [balances, stretches] = await Promise.all([
        row?.is_on ? loadBalances(supabase, { businessId: me.businessId, location: me.location, today, staffId: who.id }) : null,
        loadTimeOffDays(supabase, { businessId: me.businessId, locationId: me.location.id, from: since, to: `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`, staffId: who.id, pending: true }),
      ]);
      const statement = balances?.people.find((p) => p.staffId === who.id)?.statement ?? null;
      return { ...ptoFacts(who, statement, stretches, { since, today, say }), ...(row?.is_on && !statement ? { note: `${who.firstName} isn't on the salon's PTO policy.` } : {}) };
    },
    async off(from: string, to: string) {
      if (!isLocalDate(from) || !isLocalDate(to)) return "Give the dates as YYYY-MM-DD.";
      if (to < from) return "The last day is before the first.";
      if (daysBetween(from, to) > MAX_OFF_DAYS) return `Ask about ${MAX_OFF_DAYS} days or fewer at a time.`;
      const stretches = await loadTimeOffDays(supabase, { businessId: me.businessId, locationId: me.location.id, from, to, pending: everyone, ...(everyone ? {} : { staffId: me.staffId }) });
      return { ...offFacts(stretches, { from, to, say }), ...(everyone ? {} : { only_yours: "You can see your own time off here. Owners and managers see everyone's; who_is_working shows who's in on a day." }) };
    },
  };
}
