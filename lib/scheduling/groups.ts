// Group bookings: several clients' visits booked together, at the same time
// with different stylists or staggered. Pure, over a BookingContext; each
// guest's visit is checked against the booking rules and the guests before
// them (./series.ts checkVisitOn), so two guests never get one stylist or
// chair at once.

import type { BookingProblem } from "./booking.ts";
import type { BookingContext } from "./booking.ts";
import { checkVisitOn, type VisitLine } from "./series.ts";
import type { LocalDate } from "./time.ts";

export const MAX_GUESTS = 12;

// Start times for the guests: all together (every = 0), or each `every`
// minutes after the one before.
export function staggered(first: number, count: number, every: number): number[] {
  return Array.from({ length: count }, (_, i) => first + i * every);
}

export type GroupCheck = { ok: boolean; problems: BookingProblem[][][] };

// Whether every guest's visit fits on the date, together.
export function checkGroup(ctx: BookingContext, guests: readonly (readonly VisitLine[])[], date: LocalDate): GroupCheck {
  const all = guests.flat();
  const check = checkVisitOn(ctx, all, date);
  const problems: BookingProblem[][][] = [];
  let n = 0;
  for (const g of guests) {
    problems.push(check.problems.slice(n, n + g.length));
    n += g.length;
  }
  return { ok: check.ok, problems };
}
