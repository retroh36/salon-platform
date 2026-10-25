// Denise's ideas for open time (pure, unit-tested; our code works out
// every one, never Claude): gaps of an hour or more in the next hours a
// last-minute special covers, each with regulars who'd fit it (their usual
// stylist first, then anyone whose usual services the stylist does), who
// are due or overdue with nothing booked, said yes to offers, and haven't
// had an offer or reminder from us this week. Staff send the message (a
// fixed template, lib/promotions.ts specialMessage).

import type { Channel } from "./messaging/consent.ts";
import type { PromoRule } from "./promotions.ts";
import type { LocalDate } from "./scheduling/time.ts";

export type Gap = { staffId: string; date: LocalDate; start: number; end: number; startsAt: number };

export type Regular = {
  clientId: string;
  firstName: string;
  preferredStaffId: string | null;
  usualServiceIds: string[];
  overdueDays: number;
  // How an offer reaches them (null: it can't).
  channel: Channel | null;
  // An offer or reminder from us in the last week.
  offeredRecently: boolean;
};

export type OpeningIdea = { gap: Gap; clients: Regular[] };

export const IDEA_CLIENTS = 3;

export function openingIdeas(
  gaps: readonly Gap[],
  regulars: readonly Regular[],
  special: PromoRule | null,
  offers: (staffId: string) => ReadonlySet<string>,
  now: number,
  limit = IDEA_CLIENTS,
): OpeningIdea[] {
  const hours = special?.hoursAhead ?? 48;
  const reachable = regulars.filter((r) => r.channel && !r.offeredRecently).sort((a, b) => b.overdueDays - a.overdueDays);
  const used = new Set<string>();
  return gaps
    .filter((g) => g.startsAt > now && g.startsAt - now <= hours * 3_600_000)
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((gap) => {
      const does = offers(gap.staffId);
      const fits = (r: Regular) => r.usualServiceIds.length > 0 && r.usualServiceIds.every((id) => does.has(id));
      const theirs = reachable.filter((r) => !used.has(r.clientId) && r.preferredStaffId === gap.staffId && fits(r));
      const others = reachable.filter((r) => !used.has(r.clientId) && r.preferredStaffId !== gap.staffId && fits(r));
      const clients = [...theirs, ...others].slice(0, limit);
      for (const c of clients) used.add(c.clientId);
      return { gap, clients };
    })
    .filter((i) => i.clients.length > 0);
}

// "today at 2:00pm", "tomorrow at 10:30am".
export function whenText(date: LocalDate, minute: number, today: LocalDate, tomorrow: LocalDate, formatDay: (d: LocalDate) => string): string {
  const h = Math.floor(minute / 60);
  const time = `${((h + 11) % 12) + 1}:${String(minute % 60).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
  return `${date === today ? "today" : date === tomorrow ? "tomorrow" : formatDay(date)} at ${time}`;
}
