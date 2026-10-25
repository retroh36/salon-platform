import type { LocalDate } from "@/lib/scheduling/time";

// "Sat, Jun 14, 2027" (the year only when it isn't this one).
export function formatEventDay(date: LocalDate, thisYear = new Date().getUTCFullYear()): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: d.getUTCFullYear() === thisYear ? undefined : "numeric", timeZone: "UTC" });
}
