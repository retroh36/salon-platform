// When a booking is refused (a clash, outside hours, blocked time, no free
// chair), Denise says why in a sentence and offers the nearest times that
// work: the same stylist a little later or earlier, or someone else at the
// same time. Every option passes the booking rules (findOpenings). Pure.

import type { BookingContext, BookingProblem } from "@/lib/scheduling/booking";
import { findOpenings } from "@/lib/scheduling/openings";
import { formatMinute, toLocal, type LocalDate } from "@/lib/scheduling/time";

export type BookingIdea = { staffId: string; startMinute: number; label: string };
export type BookingIdeas = { line: number; text: string; options: BookingIdea[] };

const BLOCK_WORDS: Record<string, string> = { lunch: "lunch", break: "break", training: "training", meeting: "a meeting", personal: "personal time" };

// Why the line can't go there, in Denise's words.
function why(ctx: BookingContext, problems: readonly BookingProblem[], stylist: string, date: LocalDate): string {
  const tz = ctx.location.timeZone;
  for (const p of problems) {
    if (p.code === "staff_double_booked") {
      const other = ctx.booked.find((b) => b.id === p.conflictWith);
      const when = other ? toLocal(other.start, tz) : null;
      return when && when.date === date ? `That clashes with ${stylist}'s ${formatMinute(when.minute)} client.` : `${stylist} already has a client then.`;
    }
    if (p.code === "staff_blocked") return `That's during ${stylist}'s ${BLOCK_WORDS[p.kind] ?? "blocked time"}.`;
    if (p.code === "staff_unavailable") return `${stylist} isn't working then.`;
    if (p.code === "resource_in_use" || p.code === "no_free_resource") return "No chair is free then.";
    if (p.code === "room_needed") return "No room is free then.";
  }
  return "That time doesn't work.";
}

// Ideas for the first line the rules refused, when it's about time (not a
// missing service or a patch test).
export function bookingIdeas(
  ctx: BookingContext,
  date: LocalDate,
  lines: readonly { serviceId: string; staffId: string; startMinute: number }[],
  problems: readonly (readonly BookingProblem[])[],
  names: ReadonlyMap<string, string>,
  notBefore?: Date,
): BookingIdeas | null {
  const TIME = new Set(["staff_double_booked", "staff_blocked", "staff_unavailable", "resource_in_use", "no_free_resource", "room_needed"]);
  const line = problems.findIndex((p) => p.some((x) => TIME.has(x.code)));
  if (line < 0) return null;
  const { serviceId, staffId, startMinute } = lines[line];
  const name = (id: string) => names.get(id) ?? "Another stylist";
  const text = why(ctx, problems[line], name(staffId), date);

  const all = findOpenings(ctx, { serviceId, date, notBefore, limit: 500, step: 15 });
  const sameStylist = all
    .filter((o) => o.staffId === staffId)
    .sort((a, b) => Math.abs(a.startMinute - startMinute) - Math.abs(b.startMinute - startMinute) || a.startMinute - b.startMinute)
    .slice(0, 2);
  const sameTime = all.filter((o) => o.staffId !== staffId && o.startMinute === startMinute).slice(0, 2);
  const options = [...sameStylist, ...sameTime].map((o) => ({ staffId: o.staffId, startMinute: o.startMinute, label: `${name(o.staffId)} at ${formatMinute(o.startMinute)}` }));
  return {
    line,
    text: options.length ? `${text} Here's what's free:` : `${text} I couldn't find a free time for this that day. You could try another day, or a shorter service.`,
    options,
  };
}
