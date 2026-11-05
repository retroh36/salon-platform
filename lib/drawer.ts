// The cash drawer through the day (`drawer_counts`, migration
// …_cash_drawer.sql): what it should hold at each count, worked out the
// same way as `count_drawer` (the database decides; this is for showing),
// and the cash that came in and went out between two counts, for looking
// into a difference. Pure.

export type DrawerCount = { id: string; kind: "open" | "mid" | "close"; expectedCents: number; countedCents: number; at: string; by: string | null; note: string | null };
export type CashMove = { at: string; amountCents: number; saleId: string; saleNumber: number; by: string | null };

// What the drawer should hold at `at`: the opening count (else what the
// opening should have been) plus the day's cash so far.
export function expectedAt(openingExpectedCents: number, opening: DrawerCount | null, moves: readonly CashMove[], at: string): number {
  const start = opening?.countedCents ?? openingExpectedCents;
  return start + moves.filter((m) => m.at < at).reduce((sum, m) => sum + m.amountCents, 0);
}

// The cash between the count before this one (or the start of the day) and
// this one: what to look at when it's off.
export function movesBefore(count: DrawerCount, counts: readonly DrawerCount[], moves: readonly CashMove[]): CashMove[] {
  const earlier = counts.filter((c) => c.at < count.at).map((c) => c.at);
  const since = earlier.length ? earlier.reduce((a, b) => (a > b ? a : b)) : "";
  return moves.filter((m) => m.at >= since && m.at < count.at);
}

// "$12 short", "$5 over" or "matches".
export function differenceText(diffCents: number, format: (cents: number) => string): string {
  return diffCents === 0 ? "matches" : `${format(Math.abs(diffCents))} ${diffCents > 0 ? "over" : "short"}`;
}

export const COUNT_LABELS: Record<DrawerCount["kind"], string> = { open: "Opening count", mid: "Count during the day", close: "Close-out" };
