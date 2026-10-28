// Ask Denise about the team schedule: "Who's working Thursday night?" and
// "Can I give Nola Friday off?". Our code works out every fact
// (lib/coverage.ts) from the published schedule; Claude only says them.
// Staff go to Claude by first name only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { coverageFlags, DAY_PARTS, timeOffImpact, whoIsWorking, type DayPart } from "@/lib/coverage";
import { loadCoverage, type CoverageWeek } from "@/lib/coverage-load";
import type { Database } from "@/lib/database.types";
import { formatIntervals } from "@/lib/schedule-format";
import { isLocalDate, type LocalDate } from "@/lib/scheduling/time";
import { roleLabel } from "@/lib/staff";

type Supabase = SupabaseClient<Database>;

export const PARTS = Object.keys(DAY_PARTS) as DayPart[];
const LEVEL = { artisan: "Artisan", senior: "Senior", master: "Master" } as const;
const pct = (share: number) => Math.round(share * 100);

// Who's working that day (or that part of it), with their hours; owners and
// managers also get what Denise would flag that day.
export function teamFacts(week: CoverageWeek, date: LocalDate, part: DayPart, say: (d: LocalDate) => string, { flags }: { flags: boolean }) {
  const day = week.days.find((d) => d.date === date);
  if (!day) return { date: say(date), error: "I don't have the schedule for that day." };
  if (!day.open.length) return { date: say(date), salon_open: false, working: [] };
  return {
    date: say(date),
    part_of_day: part,
    salon_open: formatIntervals(day.open),
    working: whoIsWorking(week.people, day, part).map((p) => ({
      first_name: p.firstName,
      role: roleLabel(p.role),
      level: p.level ? LEVEL[p.level] : null,
      hours: formatIntervals(p.hours),
    })),
    ...(flags ? { flags: coverageFlags(week.people, day).map((f) => f.text) } : {}),
  };
}

// What giving someone the day off would leave, for owners and managers.
export function dayOffFacts(week: CoverageWeek, date: LocalDate, firstName: string, say: (d: LocalDate) => string) {
  const matches = week.people.filter((p) => p.firstName.toLowerCase() === firstName.trim().toLowerCase());
  if (matches.length !== 1) return { error: matches.length ? `More than one ${firstName} on the team.` : `Nobody called ${firstName} on the team.`, team: week.people.map((p) => p.firstName) };
  const day = week.days.find((d) => d.date === date);
  if (!day) return { date: say(date), error: "I don't have the schedule for that day." };
  const who = matches[0];
  const impact = timeOffImpact(week.people, day, who.id);
  if (!impact.working) return { first_name: who.firstName, date: say(date), already_off: true };
  return {
    first_name: who.firstName,
    date: say(date),
    already_off: false,
    clients_booked_with_them: impact.clients,
    also_off: impact.alsoOff,
    stylists_left: impact.stylistsLeft,
    masters_left: who.role === "stylist" || impact.mastersLeft ? impact.mastersLeft : null,
    stylists_booked_after_pct: pct(impact.busyShareAfter),
    asked_for_it: day.requests.some((r) => r.staffId === who.id),
    new_gaps_in_cover: impact.newFlags.map((f) => f.text),
  };
}

export function teamKnowledge(supabase: Supabase, location: { id: string; timezone: string }, say: (d: LocalDate) => string, { manager }: { manager: boolean }) {
  const week = (date: LocalDate) => loadCoverage(supabase, location, date, date, { drafts: false });
  return {
    working: async (date: string, part: string) => {
      if (!isLocalDate(date)) return "Give the date as YYYY-MM-DD.";
      if (!PARTS.includes(part as DayPart)) return `Choose a part of the day: ${PARTS.join(", ")}.`;
      return teamFacts(await week(date), date, part as DayPart, say, { flags: manager });
    },
    dayOff: manager
      ? async (date: string, firstName: string) => (isLocalDate(date) ? dayOffFacts(await week(date), date, firstName, say) : "Give the date as YYYY-MM-DD.")
      : null,
  };
}
