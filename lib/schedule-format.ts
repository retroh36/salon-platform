import type { TimeOff } from "@/lib/scheduling/availability";
import type { Interval } from "@/lib/scheduling/intervals";
import { formatMinute, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { REASON_LABELS, type TimeOffReason } from "@/lib/schedule-forms";

// [{9am-1pm}, {2pm-6pm}] -> "9am–1pm, 2pm–6pm".
export function formatIntervals(intervals: Interval[]): string {
  return intervals.map((i) => `${formatMinute(i.start)}–${formatMinute(i.end)}`).join(", ");
}

// A moment as the salon's day: 7:30pm in Chicago is still that evening's
// date, though it's the next day in UTC.
export function formatDayAt(iso: string, timeZone: string): string {
  return formatDay(toLocal(new Date(iso), timeZone).date);
}

// "2026-10-27" -> "Tue, Oct 27".
export function formatDay(date: LocalDate, withYear = false): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

// "Vacation · Mon, Nov 2 – Sun, Nov 8" or "Personal · Thu, Oct 29, 2pm–4pm".
export function describeTimeOff(t: TimeOff): string {
  const reason = REASON_LABELS[t.reason as TimeOffReason] ?? "Time off";
  const when =
    t.startsOn === t.endsOn
      ? formatDay(t.startsOn) + (t.startMinute != null && t.endMinute != null ? `, ${formatMinute(t.startMinute)}–${formatMinute(t.endMinute)}` : "")
      : `${formatDay(t.startsOn)} – ${formatDay(t.endsOn)}`;
  return `${reason} · ${when}`;
}

export const STATUS_LABELS = { requested: "Pending", approved: "Approved", declined: "Declined" } as const;

// "2026-10-21" -> "Wednesday, October 21, 2026".
export function formatLongDay(date: LocalDate, withYear = true): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}
