// Layout for the day-view calendar: the time range shown, colors for
// service categories, and how overlapping blocks sit in a column. Display
// only; whether a booking is allowed is decided in lib/scheduling/booking.ts.

import { subtractIntervals, type Interval } from "@/lib/scheduling/intervals";
import { MINUTES_PER_DAY } from "@/lib/scheduling/time";

export type ServiceFamily = "color" | "cut" | "finish" | "treatment" | "other";

// Families share a calendar color: peach for color work, lavender for cuts,
// green for glosses, blow-dries and styling, blue for treatments.
export const FAMILY_LABELS: Record<ServiceFamily, string> = {
  color: "Color",
  cut: "Cuts",
  finish: "Gloss & blowouts",
  treatment: "Treatments",
  other: "Other",
};

export const FAMILIES: ServiceFamily[] = ["color", "cut", "finish", "treatment", "other"];

// A salon names its own categories, so this goes by keywords. A gloss or
// toner counts as finishing even when it's filed under Color.
export function serviceFamily(category: string, serviceName = ""): ServiceFamily {
  if (/gloss|toner/i.test(serviceName)) return "finish";
  const text = category.toLowerCase();
  if (/colou?r|highlight|lowlight|balayage|foil|bleach/.test(text)) return "color";
  if (/cut|fade|barber|trim|beard/.test(text)) return "cut";
  if (/blow|styl|updo|finish|gloss/.test(text)) return "finish";
  if (/treat|mask|keratin|condition|scalp|smooth/.test(text)) return "treatment";
  return "other";
}

// The hours to draw: the salon's opening hours that day (or `fallback`, e.g.
// the week's hours, when closed), stretched to fit any appointments, in
// whole hours.
export function gridRange(open: readonly Interval[], fallback: readonly Interval[], items: readonly Interval[]): Interval {
  const base = open.length ? open : fallback;
  const all = [...base, ...items];
  if (all.length === 0) return { start: 9 * 60, end: 17 * 60 };
  const start = Math.min(...all.map((i) => i.start));
  const end = Math.max(...all.map((i) => i.end));
  return { start: Math.floor(start / 60) * 60, end: Math.min(MINUTES_PER_DAY, Math.ceil(end / 60) * 60) };
}

// Parts of the range when the stylist can't be booked.
export function offHours(range: Interval, bookable: readonly Interval[]): Interval[] {
  return subtractIntervals([range], bookable);
}

// Hours to label on the time axis.
export function hourMarks(range: Interval): number[] {
  const marks: number[] = [];
  for (let m = Math.ceil(range.start / 60) * 60; m < range.end; m += 60) marks.push(m);
  return marks;
}

// Lanes for blocks that overlap in a column (a client booked into another's
// processing gap, or a clash), so nothing covers anything else. Blocks that
// overlap, directly or through others, form a group; within it each block
// takes the first lane free at its start. Longer blocks go first when two
// start together, so the main appointment keeps lane 0.
export function layoutColumn<T extends Interval>(blocks: readonly T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const result: (T & { lane: number; lanes: number })[] = [];
  let group: (T & { lane: number; lanes: number })[] = [];
  let groupEnd = -Infinity;
  const laneEnds: number[] = [];

  const closeGroup = () => {
    const lanes = Math.max(1, ...group.map((b) => b.lane + 1));
    for (const b of group) b.lanes = lanes;
    result.push(...group);
    group = [];
    laneEnds.length = 0;
  };

  for (const block of sorted) {
    if (block.start >= groupEnd) {
      closeGroup();
      groupEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = block.end;
    groupEnd = Math.max(groupEnd, block.end);
    group.push({ ...block, lane, lanes: 1 });
  }
  closeGroup();
  return result;
}

// Where a lane sits across the column, in percent. The first lane (the main
// appointment) stays wide; the others share a narrow strip on the right.
export function laneBox(lane: number, lanes: number): { left: number; width: number } {
  if (lanes <= 1) return { left: 0, width: 100 };
  const narrow = lanes === 2 ? 40 : 60 / (lanes - 1);
  const main = 100 - narrow * (lanes - 1);
  return lane === 0 ? { left: 0, width: main } : { left: main + narrow * (lane - 1), width: narrow };
}

// A stylist's day at a glance, for their column header: "3 visits ·
// 4h 15m booked", or "No bookings". Counts each visit once however many
// services they do on it, and the time they're booked for (processing
// included, since the client is theirs).
export function bookedSummary(items: readonly { appointmentId: string; minutes: number }[]): string {
  if (items.length === 0) return "No bookings";
  const visits = new Set(items.map((i) => i.appointmentId)).size;
  const minutes = items.reduce((sum, i) => sum + i.minutes, 0);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const time = h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
  return `${visits} ${visits === 1 ? "visit" : "visits"} · ${time} booked`;
}

// Shorter forms of a booked summary for a narrow header, longest first:
// "7 visits · 6h 10m booked", "7 visits · 6h 10m", "7 · 6h 10m".
export function summaryVariants(summary: string): string[] {
  const short = summary.replace(/ booked$/, "");
  return [...new Set([summary, short, short.replace(/ visits? · /, " · ")])];
}

// Working hours on one line for a column header: "9–1, 2–6", "10–7",
// "1:30–5:30" (the full "9am–1pm, 2pm–6pm" is on hover).
export function compactHours(intervals: readonly Interval[]): string {
  const at = (minute: number) => {
    const h = Math.floor(minute / 60) % 12 || 12;
    const m = minute % 60;
    return m ? `${h}:${String(m).padStart(2, "0")}` : String(h);
  };
  return intervals.map((i) => `${at(i.start)}–${at(i.end)}`).join(", ");
}

// How tall the calendar draws time, per person (staff.calendar_zoom), in px
// per minute: Comfortable is 40px a quarter hour, easy to read and tap on an
// iPad.
export const ZOOMS = ["compact", "comfortable", "detailed"] as const;
export type CalendarZoom = (typeof ZOOMS)[number];
export const ZOOM_PX_PER_MINUTE: Record<CalendarZoom, number> = { compact: 2, comfortable: 40 / 15, detailed: 4 };
export const ZOOM_LABELS: Record<CalendarZoom, string> = { compact: "Compact", comfortable: "Comfortable", detailed: "Detailed" };

export const isZoom = (z: unknown): z is CalendarZoom => (ZOOMS as readonly unknown[]).includes(z);

// Time-column labels: every quarter hour inside the range, hours marked.
export function quarterMarks(range: Interval): { minute: number; hour: boolean }[] {
  const marks: { minute: number; hour: boolean }[] = [];
  for (let m = Math.ceil(range.start / 15) * 15; m < range.end; m += 15) marks.push({ minute: m, hour: m % 60 === 0 });
  return marks;
}
