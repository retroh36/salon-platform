"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentStaff } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { isUuid } from "@/lib/ids";
import { formatDay } from "@/lib/schedule-format";
import { patternHours } from "@/lib/scheduling/availability";
import { loadStaffSchedules } from "@/lib/scheduling/load";
import { addDays, daysBetween, fromLocal, isLocalDate, startOfWeek, todayIn, WEEKDAYS, type LocalDate, type Weekday } from "@/lib/scheduling/time";
import { outPanelHref, outside, sameShifts, shiftProblem, sortShifts, type DayEdit, type Shift } from "@/lib/team-schedule";
import { loadWeekGrid } from "@/lib/team-schedule-load";
import { copyForward, copyPerson, MAX_COPY_DAYS, MAX_COPY_WEEKS } from "@/lib/schedule-month";
import { loadCells } from "@/lib/schedule-month-load";

type Supabase = Awaited<ReturnType<typeof getCurrentStaff>>["supabase"];

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
  return saveDrafts(supabase, me.location.id, days);
}

async function saveDrafts(supabase: Supabase, locationId: string, days: DayEdit[], message?: string): Promise<ScheduleResult> {
  const { error } = await supabase.rpc("save_schedule_drafts", {
    p_location_id: locationId,
    p_days: days.map((d) => ({ staff_id: d.staffId, on_date: d.date, shifts: sortShifts(d.shifts) })) as unknown as Json,
  });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.hint === "not_their_role") return { ok: false, message: ROLE_GONE };
  if (error?.code === "22023") return { ok: false, message: error.message };
  if (error) throw error;
  return done(message);
}

const ROLE_GONE = "One of those roles isn't theirs any more. Reload the page and choose again.";

const daysText = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

// Copies a week's shifts onto the weeks after it, for everyone or one
// person, into the draft.
export async function copyWeekForward(sourceWeek: LocalDate, weeks: number, staffId: string | null): Promise<ScheduleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isLocalDate(sourceWeek) || !Number.isInteger(weeks) || weeks < 1 || weeks > MAX_COPY_WEEKS || (staffId !== null && !isUuid(staffId))) {
    return { ok: false, message: "That copy isn't possible." };
  }
  const start = startOfWeek(sourceWeek);
  const cells = await loadCells(supabase, me.location, start, addDays(start, 7 * weeks + 6));
  const edits = copyForward(cells, start, weeks, todayIn(me.location.timezone), staffId);
  if (!edits.length) return { ok: true, message: "Those weeks already match." };
  return saveDrafts(supabase, me.location.id, edits, `Copied to ${daysText(edits.length)} in the draft. Publish to make it live.`);
}

// Gives one person another's shifts for a stretch of days, into the draft.
export async function copyFromPerson(fromId: string, toId: string, from: LocalDate, to: LocalDate): Promise<ScheduleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(fromId) || !isUuid(toId) || fromId === toId || !isLocalDate(from) || !isLocalDate(to) || to < from || daysBetween(from, to) >= MAX_COPY_DAYS) {
    return { ok: false, message: "Choose someone else and up to three months of days." };
  }
  const cells = await loadCells(supabase, me.location, from, to);
  if (!cells.some((c) => c.staffId === fromId) || !cells.some((c) => c.staffId === toId)) return { ok: false, message: "They aren't on this team." };
  const edits = copyPerson(cells, fromId, toId, from, to, todayIn(me.location.timezone));
  if (!edits.length) return { ok: true, message: "Those days already match." };
  return saveDrafts(supabase, me.location.id, edits, `Copied to ${daysText(edits.length)} in the draft. Publish to make it live.`);
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
  return publishWeeks([week]);
}

// Publishes each of these weeks that has changes (the month view's
// Publish month), as one publish a week.
export async function publishWeeks(weeks: LocalDate[]): Promise<PublishResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!Array.isArray(weeks) || weeks.length < 1 || weeks.length > 6 || !weeks.every(isLocalDate)) return { ok: false, message: "That week isn't on the schedule." };
  const starts = [...new Set(weeks.map(startOfWeek))];
  const grids = await Promise.all(starts.map((w) => loadWeekGrid(supabase, me.location, w, { drafts: true })));
  const changed = grids.flatMap((g) => g.cells).filter((c) => c.draft && !sameShifts(c.draft, c.live));
  for (const g of grids) {
    // A week with nothing changed is published too when it's the only one
    // (it records who published it); in a month, only the changed weeks.
    if (starts.length > 1 && !changed.some((c) => c.date >= g.week && c.date <= addDays(g.week, 6))) continue;
    const { error } = await supabase.rpc("publish_schedule_week", { p_location_id: me.location.id, p_week_start: g.week });
    if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
    if (error) throw error;
  }

  const names = new Map(grids[0].people.map((p) => [p.id, p.firstName]));
  const moves = changed
    .filter((c) => outside(c, c.draft!).some((b) => !outside(c, c.live).includes(b)))
    .map((c) => ({ label: `Move ${names.get(c.staffId)}'s clients on ${formatDay(c.date)}`, href: outPanelHref({ staffId: c.staffId, date: c.date, before: c.live, after: c.draft! }) }));
  const people = new Set(changed.map((c) => c.staffId)).size;
  done();
  return {
    ok: true,
    message: changed.length ? `Published. ${people} ${people === 1 ? "person" : "people"} told about their new hours.` : "Published. Nothing had changed.",
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
      WEEKDAYS.flatMap((d) => sortShifts(w[d] ?? []).map((s) => ({ cycle_week: n, weekday: d, start_minute: s.start, end_minute: s.end, role_id: s.role ?? null }))),
    ) as unknown as Json,
  });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.hint === "not_their_role") return { ok: false, message: ROLE_GONE };
  if (error?.code === "22023" || error?.code === "23P01") return { ok: false, message: "Shifts on one day can't overlap." };
  if (error) throw error;
  done();
  return { ok: true, message: "Pattern saved. The weeks ahead follow it." };
}

// A manager's change to someone's clocked hours: add a punch (entryId null),
// change one or remove it, always with a reason. Times are the location's
// wall clock on `date` ("HH:MM"); an end before the start is the next day.
export type TimeEntryInput = { entryId: string | null; staffId: string; date: LocalDate; clockIn: string; clockOut: string | null; reason: string; remove?: boolean };

export async function saveTimeEntry(input: TimeEntryInput): Promise<ScheduleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { ok: false, message: NOT_ALLOWED };
  const minute = (t: string | null) => (t && /^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);
  const start = minute(input.clockIn);
  const end = minute(input.clockOut);
  if ((input.entryId !== null && !isUuid(input.entryId)) || !isUuid(input.staffId) || !isLocalDate(input.date) || (!input.remove && start === null)) {
    return { ok: false, message: "Check the times." };
  }
  if ((input.reason ?? "").trim().length < 3) return { ok: false, message: "Say why you're changing it." };
  const tz = me.location.timezone;
  const clockIn = start === null ? null : fromLocal(input.date, start, tz);
  const clockOut = end === null ? null : fromLocal(end > start! ? input.date : addDays(input.date, 1), end, tz);
  const { error } = await supabase.rpc("save_time_entry", {
    p_business_id: me.business_id,
    p_entry_id: input.entryId as string,
    p_staff_id: input.staffId,
    p_clock_in: clockIn?.toISOString() as string,
    p_clock_out: clockOut?.toISOString() as string,
    p_reason: input.reason.trim().slice(0, 300),
    p_remove: input.remove ?? false,
  });
  if (error?.code === "42501") return { ok: false, message: error.message.includes("owner") ? "Only owners can change an owner's hours." : "Only managers can change clocked hours." };
  if (error?.hint === "overlap") return { ok: false, message: "That overlaps another punch that day." };
  if (error?.hint === "times") return { ok: false, message: "Check the times: they can't be in the future, and a shift is 18 hours at most." };
  if (error) throw error;
  done();
  return { ok: true, message: input.remove ? "Punch removed." : input.entryId ? "Hours changed." : "Punch added." };
}
