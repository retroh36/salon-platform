// Blocked time on a stylist's calendar: lunch, breaks, training, meetings
// and personal time. Pure: expands one-off and repeating blocks into the
// days they fall on, and checks a block against booked clients.
//
// Blocks are local wall-clock time (minutes since midnight) on local dates.
// The booking rules (./booking.ts) treat each occurrence like another
// client: the stylist's busy time can't overlap it.

import { busyDuring, type BookingContext } from "./booking.ts";
import type { LocalDate } from "./time.ts";
import { addDays, datesBetween, fromLocal, isLocalDate, parseTime, weekdayOf } from "./time.ts";

// "event" is an event's hold on its team's time: written only by the event
// (…_event_day.sql), never in the block form, and never moved by Denise.
export type TimeBlockKind = "lunch" | "break" | "training" | "meeting" | "personal" | "event";

export const BLOCK_KINDS: TimeBlockKind[] = ["lunch", "break", "training", "meeting", "personal"];

export const BLOCK_LABELS: Record<TimeBlockKind, string> = {
  lunch: "Lunch",
  break: "Break",
  training: "Training",
  meeting: "Meeting",
  personal: "Personal",
  event: "Event",
};

// Denise may shift these (by up to MAX_BLOCK_SHIFT minutes) to fit a fix;
// training, meetings and personal time stay put.
export const MOVABLE_KINDS: ReadonlySet<TimeBlockKind> = new Set(["lunch", "break"]);
export const MAX_BLOCK_SHIFT = 30;

export type TimeBlock = {
  id: string;
  staffId: string;
  kind: TimeBlockKind;
  note: string | null;
  startMinute: number;
  endMinute: number;
  // One-off: the day. Repeating: the weekdays (1 = Monday) from startsOn
  // until endsOn (if set), less any skipped days.
  onDate: LocalDate | null;
  weekdays: number[] | null;
  startsOn: LocalDate | null;
  endsOn: LocalDate | null;
  skips: LocalDate[];
  // An event's hold on its team's time.
  eventId?: string | null;
};

// One day of a block.
export type BlockOccurrence = {
  blockId: string;
  staffId: string;
  kind: TimeBlockKind;
  note: string | null;
  date: LocalDate;
  start: number;
  end: number;
  repeating: boolean;
};

export function occurrences(block: TimeBlock, from: LocalDate, to: LocalDate): BlockOccurrence[] {
  const base = { blockId: block.id, staffId: block.staffId, kind: block.kind, note: block.note, start: block.startMinute, end: block.endMinute };
  if (block.onDate) return block.onDate >= from && block.onDate <= to ? [{ ...base, date: block.onDate, repeating: false }] : [];
  const first = block.startsOn! > from ? block.startsOn! : from;
  const last = block.endsOn && block.endsOn < to ? block.endsOn : to;
  if (first > last) return [];
  const skipped = new Set(block.skips);
  return datesBetween(first, last)
    .filter((d) => block.weekdays!.includes(weekdayOf(d)) && !skipped.has(d))
    .map((date) => ({ ...base, date, repeating: true }));
}

// An occurrence as instants, for the booking rules. Null if the times
// don't exist that day (a daylight saving gap).
export function occurrenceSpan(o: BlockOccurrence, timeZone: string): { start: Date; end: Date } | null {
  const start = fromLocal(o.date, o.start, timeZone);
  const end = o.end === 24 * 60 ? fromLocal(addDays(o.date, 1), 0, timeZone) : fromLocal(o.date, o.end, timeZone);
  return start && end ? { start, end } : null;
}

// How far ahead a new repeating block is checked against booked clients.
export const CHECK_WEEKS = 8;

// Days a block would land on a client (the stylist's busy time) or another
// of the stylist's blocks. `ignore` leaves out the block's own occurrences.
export function blockClashes(
  list: readonly BlockOccurrence[],
  ctx: BookingContext,
  ignore: { blockId: string; date?: string } | null = null,
): { date: LocalDate; with: "client" | TimeBlockKind }[] {
  const clashes: { date: LocalDate; with: "client" | TimeBlockKind }[] = [];
  for (const o of list) {
    const span = occurrenceSpan(o, ctx.location.timeZone);
    if (!span) continue;
    if (busyDuring(ctx, o.staffId, span.start, span.end).length) {
      clashes.push({ date: o.date, with: "client" });
      continue;
    }
    const other = (ctx.blocks ?? []).find(
      (b) =>
        b.staffId === o.staffId &&
        b.date === o.date &&
        !(ignore && b.blockId === ignore.blockId && (!ignore.date || ignore.date === b.date)) &&
        b.start < span.end &&
        span.start < b.end,
    );
    if (other) clashes.push({ date: o.date, with: other.kind });
  }
  return clashes;
}

export type BlockInput = {
  staffId: string;
  kind: TimeBlockKind;
  note: string | null;
  startMinute: number;
  endMinute: number;
  // One-off on `date`, or repeating on `weekdays` from `date` until `until`.
  date: LocalDate;
  weekdays: number[] | null;
  until: LocalDate | null;
};

export type BlockFormErrors = Partial<Record<"kind" | "times" | "weekdays" | "until" | "note", string>>;

// The block form: "12:00" to "12:30", repeating on some weekdays or not.
export function parseBlockInput(raw: {
  staffId: string;
  kind: string;
  note: string;
  start: string;
  end: string;
  date: string;
  repeat: boolean;
  weekdays: number[];
  until: string;
}): { ok: true; value: BlockInput } | { ok: false; errors: BlockFormErrors } {
  const errors: BlockFormErrors = {};
  if (!BLOCK_KINDS.includes(raw.kind as TimeBlockKind)) errors.kind = "Choose what it's for.";
  const start = parseTime(raw.start);
  const end = parseTime(raw.end);
  if (start === null || end === null || start % 5 || end % 5) errors.times = "Times are on 5-minute marks, e.g. 12:00 to 12:30.";
  else if (end <= start) errors.times = "The end is after the start.";
  const weekdays = raw.repeat ? [...new Set(raw.weekdays)].filter((d) => d >= 1 && d <= 7).sort() : null;
  if (raw.repeat && !weekdays!.length) errors.weekdays = "Choose the days it repeats.";
  const until = raw.repeat && raw.until.trim() ? raw.until.trim() : null;
  if (until && (!isLocalDate(until) || until < raw.date)) errors.until = "The last day is on or after the first.";
  const note = raw.note.trim().slice(0, 300) || null;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { staffId: raw.staffId, kind: raw.kind as TimeBlockKind, note, startMinute: start!, endMinute: end!, date: raw.date, weekdays, until } };
}
