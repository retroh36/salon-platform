"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentStaff } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { isUuid } from "@/lib/ids";
import { formatDay } from "@/lib/schedule-format";
import { patternHours } from "@/lib/scheduling/availability";
import { loadStaffSchedules } from "@/lib/scheduling/load";
import { addDays, isLocalDate, startOfWeek, todayIn, WEEKDAYS, type LocalDate, type Weekday } from "@/lib/scheduling/time";
import { outPanelHref, outside, sameShifts, shiftProblem, sortShifts, type DayEdit, type Shift } from "@/lib/team-schedule";
import { loadWeekGrid } from "@/lib/team-schedule-load";

export type ScheduleResult = { ok: true; message?: string } | { ok: false; message: string };

const NOT_ALLOWED = "Only owners and managers can change the schedule.";

function done(message?: string): ScheduleResult {
  revalidatePath("/scheduling", "layout");
  revalidatePath("/schedule", "layout");
  revalidatePath("/my-day");
  return { ok: true, message };
}

// Saves whole days to the week's draft (nothing changes for anyone until
// the week is published).
export async function saveDays(days: DayEdit[]): Promise<ScheduleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!Array.isArray(days) || days.length > 400) return { ok: false, message: "That's too many days at once." };
  for (const d of days) {
    if (!isUuid(d.staffId) || !isLocalDate(d.date) || !Array.isArray(d.shifts)) return { ok: false, message: "That day isn't on the schedule." };
    const problem = shiftProblem(d.shifts);
    if (problem) return { ok: false, message: problem };
  }
  const { error } = await supabase.rpc("save_schedule_drafts", {
    p_location_id: me.location.id,
    p_days: days.map((d) => ({ staff_id: d.staffId, on_date: d.date, shifts: sortShifts(d.shifts) })) as unknown as Json,
  });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "22023") return { ok: false, message: error.message };
  if (error) throw error;
  return done();
}

export async function discardWeek(week: LocalDate): Promise<ScheduleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isLocalDate(week)) return { ok: false, message: "That week isn't on the schedule." };
  const { error } = await supabase.rpc("discard_schedule_drafts", { p_location_id: me.location.id, p_week_start: startOfWeek(week) });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error) throw error;
  return done("Changes discarded.");
}

export type PublishResult = { ok: true; message: string; moves: { label: string; href: string }[] } | { ok: false; message: string };

// Publishes the week: the changes go live and everyone whose hours changed
// gets a notice. Days that now leave clients outside someone's hours come
// back as links to the Mark out panel, to move them.
export async function publishWeek(week: LocalDate): Promise<PublishResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isLocalDate(week)) return { ok: false, message: "That week isn't on the schedule." };
  const start = startOfWeek(week);
  const grid = await loadWeekGrid(supabase, me.location, start, { drafts: true });
  const { data, error } = await supabase.rpc("publish_schedule_week", { p_location_id: me.location.id, p_week_start: start });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error) throw error;
  const result = data as { days_changed: number; people_notified: number };

  const names = new Map(grid.people.map((p) => [p.id, p.firstName]));
  const moves = grid.cells
    .filter((c) => c.draft && outside(c, c.draft).some((b) => !outside(c, c.live).includes(b)))
    .map((c) => ({ label: `Move ${names.get(c.staffId)}'s clients on ${formatDay(c.date)}`, href: outPanelHref({ staffId: c.staffId, date: c.date, before: c.live, after: c.draft! }) }));
  const people = result.people_notified;
  done();
  return {
    ok: true,
    message: result.days_changed ? `Published. ${people} ${people === 1 ? "person" : "people"} told about their new hours.` : "Published. Nothing had changed.",
    moves,
  };
}

// A repeating pattern from the pattern editor: weeks[n][weekday] is that
// week's shifts.
export type PatternInput = { staffId: string; startsOn: LocalDate; weeks: Partial<Record<Weekday, Shift[]>>[] };

export type PatternResult =
  | { ok: true; message: string }
  | { ok: false; message: string; affected?: { label: string; href: string }[] };

// How far ahead a new pattern is checked for clients it would leave
// outside someone's hours.
const IMPACT_WEEKS = 8;

// Saves someone's repeating pattern. It applies to every day without a
// change of its own, so clients already booked outside the new hours are
// listed first (unless `anyway`), with links to move them.
export async function savePattern(input: PatternInput, anyway = false): Promise<PatternResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: NOT_ALLOWED };
  const weeks = input.weeks;
  if (!isUuid(input.staffId) || !Array.isArray(weeks) || weeks.length < 1 || weeks.length > 4 || !isLocalDate(input.startsOn)) {
    return { ok: false, message: "That pattern can't be saved." };
  }
  for (const w of weeks) {
    for (const d of WEEKDAYS) {
      const problem = shiftProblem(w[d] ?? []);
      if (problem) return { ok: false, message: problem };
    }
  }

  if (!anyway) {
    const today = todayIn(me.location.timezone);
    const end = addDays(today, IMPACT_WEEKS * 7);
    const [grids, schedules] = await Promise.all([
      Promise.all(Array.from({ length: IMPACT_WEEKS + 1 }, (_, n) => loadWeekGrid(supabase, me.location, addDays(startOfWeek(today), n * 7), { drafts: false }))),
      loadStaffSchedules(supabase, [input.staffId], today, end),
    ]);
    const schedule = schedules.get(input.staffId)!;
    const next = { weekly: weeks[0], cycle: weeks.length > 1 ? { startsOn: input.startsOn, weeks } : null };
    const affected = grids
      .flatMap((g) => g.cells)
      .filter((c) => c.staffId === input.staffId && c.date >= today && c.date <= end && schedule.overrides[c.date] === undefined)
      .flatMap((c) => {
        const after = patternHours(next, c.date);
        if (sameShifts(after, c.live)) return [];
        const left = outside(c, after).filter((b) => !outside(c, c.live).includes(b));
        return left.length ? [{ label: `${formatDay(c.date)}: ${left.map((b) => b.client).join(", ")}`, href: outPanelHref({ staffId: c.staffId, date: c.date, before: c.live, after }) }] : [];
      });
    if (affected.length) {
      return { ok: false, message: "Some clients are booked outside the new hours. Move them, or save anyway and move them later.", affected };
    }
  }

  const { error } = await supabase.rpc("set_staff_pattern", {
    p_staff_id: input.staffId,
    p_weeks: weeks.length,
    p_starts_on: input.startsOn,
    p_hours: weeks.flatMap((w, n) =>
      WEEKDAYS.flatMap((d) => sortShifts(w[d] ?? []).map((s) => ({ cycle_week: n, weekday: d, start_minute: s.start, end_minute: s.end }))),
    ) as unknown as Json,
  });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "22023" || error?.code === "23P01") return { ok: false, message: "Shifts on one day can't overlap." };
  if (error) throw error;
  done();
  return { ok: true, message: "Pattern saved. The weeks ahead follow it." };
}
