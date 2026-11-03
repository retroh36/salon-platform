// The booking site's intro and steps, worded by our code: opening hours as
// a few lines, the map link, a service's price, and where the client is in
// the booking. Pure, so it's unit-tested (tests/unit/booking-intro.test.ts).

import { formatPrice } from "@/lib/services";
import { formatMinute } from "@/lib/scheduling/time";

// ISO weekday (1 = Monday) and local minutes, as location_hours stores them.
export type OpeningHours = { weekday: number; start: number; end: number };

const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const span = (h: { start: number; end: number }) => `${formatMinute(h.start)}–${formatMinute(h.end)}`;

// One day's hours: "9am–7pm", "9am–1pm, 2pm–6pm", or "Closed".
export function dayHours(hours: readonly OpeningHours[], weekday: number): string {
  const today = hours.filter((h) => h.weekday === weekday).sort((a, b) => a.start - b.start);
  return today.length ? today.map(span).join(", ") : "Closed";
}

// The week from Monday, with days in a row that keep the same hours
// together: [{ days: "Tue–Fri", hours: "9am–7pm" }, { days: "Sat", … }].
export function hoursRows(hours: readonly OpeningHours[]): { days: string; hours: string }[] {
  const rows: { from: number; to: number; hours: string }[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const text = dayHours(hours, weekday);
    const last = rows.at(-1);
    if (last && last.hours === text && last.to === weekday - 1) last.to = weekday;
    else rows.push({ from: weekday, to: weekday, hours: text });
  }
  return rows.map((r) => ({
    days: r.from === r.to ? SHORT_DAYS[r.from - 1] : `${SHORT_DAYS[r.from - 1]}${r.to - r.from === 1 ? ", " : "–"}${SHORT_DAYS[r.to - 1]}`,
    hours: r.hours,
  }));
}

// "Open today 9am–7pm", or "Closed today".
export function todayLine(hours: readonly OpeningHours[], weekday: number): string {
  const text = dayHours(hours, weekday);
  return text === "Closed" ? "Closed today" : `Open today ${text}`;
}

// A map search for the salon (no key, nothing loaded until it's tapped).
export function mapLink(name: string, address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${address}`)}`;
}

// A service's price on the menu: "$145", or "From $70" when it depends on
// the stylist's level.
export function fromPrice(prices: readonly number[]): string {
  if (!prices.length) return "";
  const low = Math.min(...prices);
  return low === Math.max(...prices) ? formatPrice(low) : `From ${formatPrice(low)}`;
}

// Where they are in the booking: "Stylist · Step 2 of 5".
export const STEP_NAMES = ["Services", "Stylist", "Time", "Your details", "Review"] as const;
export function stepLabel(index: number): string {
  return `${STEP_NAMES[index]} · Step ${index + 1} of ${STEP_NAMES.length}`;
}
