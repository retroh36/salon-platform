import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { CoverageDay, CoveragePerson } from "@/lib/coverage";
import { addDays, startOfWeek, type LocalDate } from "@/lib/scheduling/time";
import { cellKey, shown } from "@/lib/team-schedule";
import { loadWeekGrid, type WeekGrid } from "@/lib/team-schedule-load";

type Supabase = SupabaseClient<Database>;

export type CoverageWeek = { people: CoveragePerson[]; days: (CoverageDay & { weekStart: LocalDate })[] };

// The week grid as Denise's checks read it: each day's hours (drafts
// included when the grid has them), time off, clients, lent chairs, and
// time off still waiting for an answer.
export function coverageOf(grid: WeekGrid, requests: { staff_id: string; starts_on: string; ends_on: string; start_minute: number | null; end_minute: number | null }[]): CoverageWeek {
  const people: CoveragePerson[] = grid.people.map((p) => ({ id: p.id, firstName: p.firstName, role: p.role, level: p.level, chair: p.chair }));
  const days = grid.dates.map((date) => ({
    date,
    weekStart: grid.week,
    open: grid.open[date] ?? [],
    cells: grid.cells
      .filter((c) => c.date === date)
      .map((c) => ({
        staffId: c.staffId,
        shifts: shown(c),
        draft: c.draft != null,
        timeOff: c.timeOff,
        clients: new Set(c.booked.map((b) => b.appointmentId)).size,
        bookedMinutes: c.booked.reduce((n, b) => n + b.end - b.start, 0),
        lentChair: grid.lentChairs[cellKey(c.staffId, date)] ?? null,
      })),
    requests: requests
      .filter((r) => r.starts_on <= date && r.ends_on >= date)
      .map((r) => ({ staffId: r.staff_id, startMinute: r.start_minute, endMinute: r.end_minute })),
  }));
  return { people, days };
}

async function pendingRequests(supabase: Supabase, staffIds: string[], from: LocalDate, to: LocalDate) {
  const { data, error } = await supabase
    .from("staff_time_off")
    .select("staff_id, starts_on, ends_on, start_minute, end_minute")
    .in("staff_id", staffIds)
    .eq("status", "requested")
    .lte("starts_on", to)
    .gte("ends_on", from);
  if (error) throw error;
  return data;
}

// The weeks from `from` to `to`, with or without drafts (drafts: owners and
// managers only, by RLS).
export async function loadCoverage(supabase: Supabase, location: { id: string; timezone: string }, from: LocalDate, to: LocalDate, { drafts }: { drafts: boolean }): Promise<CoverageWeek> {
  const weeks: LocalDate[] = [];
  for (let w = startOfWeek(from); w <= to; w = addDays(w, 7)) weeks.push(w);
  const grids = await Promise.all(weeks.map((w) => loadWeekGrid(supabase, location, w, { drafts })));
  const requests = await pendingRequests(supabase, grids[0].people.map((p) => p.id), from, to);
  const all = grids.map((g) => coverageOf(g, requests));
  return { people: all[0].people, days: all.flatMap((w) => w.days).filter((d) => d.date >= from && d.date <= to) };
}

// One week, from a grid already loaded for the Scheduling page.
export async function coverageForGrid(supabase: Supabase, grid: WeekGrid): Promise<CoverageWeek> {
  return coverageOf(grid, await pendingRequests(supabase, grid.people.map((p) => p.id), grid.week, addDays(grid.week, 6)));
}
