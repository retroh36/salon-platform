import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { monthWeeks } from "@/lib/calendar-month";
import { coverageFlags, type CoverageFlag } from "@/lib/coverage";
import { coverageOf, pendingRequests } from "@/lib/coverage-load";
import { topLevel, type Level } from "@/lib/levels";
import { addDays, startOfWeek, type LocalDate } from "@/lib/scheduling/time";
import type { Cell, Shift } from "@/lib/team-schedule";
import { loadWeekGrid, type GridPerson } from "@/lib/team-schedule-load";

type Supabase = SupabaseClient<Database>;

export type MonthGrid = {
  month: string;
  // Whole weeks, Monday to Sunday, covering the month.
  weeks: LocalDate[][];
  people: GridPerson[];
  // Every day of those weeks (the month's first and last weeks reach outside it).
  cells: Cell[];
  open: Record<LocalDate, Shift[]>;
  // Denise's checks, by day (owners and managers only, else empty).
  flags: Record<LocalDate, CoverageFlag[]>;
  // When each week was last published, by its Monday.
  published: Record<LocalDate, { at: string; by: string } | null>;
};

// The month of the team schedule, a week grid at a time (the same
// published hours, drafts, time off and clients as the week), with
// Denise's coverage checks for each day.
export async function loadMonthGrid(supabase: Supabase, location: { id: string; timezone: string }, month: string, { drafts, levels }: { drafts: boolean; levels: Level[] }): Promise<MonthGrid> {
  const weeks = monthWeeks(month);
  const from = weeks[0][0];
  const to = weeks.at(-1)![6];
  const grids = await Promise.all(weeks.map((w) => loadWeekGrid(supabase, location, w[0], { drafts })));
  const people = grids[0].people;
  const flags: Record<LocalDate, CoverageFlag[]> = {};
  if (drafts) {
    const requests = await pendingRequests(supabase, people.map((p) => p.id), from, to);
    const top = topLevel(levels);
    for (const g of grids) {
      const coverage = coverageOf(g, requests);
      for (const day of coverage.days) {
        const found = coverageFlags(coverage.people, day, top);
        if (found.length) flags[day.date] = found;
      }
    }
  }
  return {
    month,
    weeks,
    people,
    cells: grids.flatMap((g) => g.cells),
    open: Object.assign({}, ...grids.map((g) => g.open)),
    flags,
    published: Object.fromEntries(grids.map((g) => [g.week, g.lastPublished])),
  };
}

// Every day's cells from `from` to `to` (whole weeks), drafts included, for
// copying.
export async function loadCells(supabase: Supabase, location: { id: string; timezone: string }, from: LocalDate, to: LocalDate): Promise<Cell[]> {
  const starts: LocalDate[] = [];
  for (let w = startOfWeek(from); w <= to; w = addDays(w, 7)) starts.push(w);
  const grids = await Promise.all(starts.map((w) => loadWeekGrid(supabase, location, w, { drafts: true })));
  return grids.flatMap((g) => g.cells);
}
