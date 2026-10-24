// Local dates and wall-clock times at a location.
//
// Schedules are stored as local wall-clock time: a date ("YYYY-MM-DD") and
// minutes since midnight (0-1440). Instants (appointments) are UTC Dates.
// These helpers convert between the two using an IANA timezone.

export type LocalDate = string; // "YYYY-MM-DD"
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: 1 = Monday ... 7 = Sunday

export const MINUTES_PER_DAY = 24 * 60;
export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(date: LocalDate): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function toLocalDate(utcMs: number): LocalDate {
  return new Date(utcMs).toISOString().slice(0, 10);
}

export function isLocalDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function weekdayOf(date: LocalDate): Weekday {
  const [y, m, d] = parseDate(date);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return (day === 0 ? 7 : day) as Weekday;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = parseDate(date);
  return toLocalDate(Date.UTC(y, m - 1, d + days));
}

// Whole days from one date to another (negative when `to` is earlier).
export function daysBetween(from: LocalDate, to: LocalDate): number {
  const [a, b] = [parseDate(from), parseDate(to)].map(([y, m, d]) => Date.UTC(y, m - 1, d));
  return Math.round((b - a) / 86_400_000);
}

// The Monday of the week containing date.
export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, 1 - weekdayOf(date));
}

// Inclusive list of dates from start to end.
export function datesBetween(start: LocalDate, end: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  return dates;
}

// "09:30" -> 570. Accepts "24:00" (end of day). Returns null if invalid.
export function parseTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

// 570 -> "09:30", for time inputs.
export function minuteToTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

// 570 -> "9:30am", 780 -> "1pm", 1440 -> "midnight".
export function formatMinute(minute: number): string {
  if (minute === 0 || minute === MINUTES_PER_DAY) return "midnight";
  if (minute === 12 * 60) return "noon";
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

// The wall-clock date and minute at the location for an instant.
export function toLocal(instant: Date, timeZone: string): { date: LocalDate; minute: number } {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

// Offset of the timezone from UTC at an instant, in minutes (Chicago in
// summer: -300).
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

// The instant for a wall-clock time at the location. When clocks go back
// and the time happens twice, returns the first. When clocks go forward and
// the time doesn't exist (e.g. 2:30am on the spring change), returns null.
export function fromLocal(date: LocalDate, minute: number, timeZone: string): Date | null {
  const [y, m, d] = parseDate(date);
  const wallMs = Date.UTC(y, m - 1, d, 0, minute);

  // Offsets in effect around this wall time; try the earlier instant first.
  const candidates = [
    ...new Set([offsetMinutes(wallMs - 12 * 3_600_000, timeZone), offsetMinutes(wallMs + 12 * 3_600_000, timeZone)]),
  ]
    .map((offset) => wallMs - offset * 60_000)
    .sort((a, b) => a - b);

  for (const utcMs of candidates) {
    const local = toLocal(new Date(utcMs), timeZone);
    if (local.date === date && local.minute === minute) return new Date(utcMs);
  }
  return null;
}

// Today's date at the location.
export function todayIn(timeZone: string, now = new Date()): LocalDate {
  return toLocal(now, timeZone).date;
}

// A start moved by whole days and minutes in local time (so a 2pm visit
// stays at 2pm across daylight saving); null if that time doesn't exist.
export function shiftStart(start: Date, timeZone: string, days: number, minutes: number): Date | null {
  const local = toLocal(start, timeZone);
  const minute = local.minute + minutes;
  if (minute < 0 || minute >= 24 * 60) return null;
  return fromLocal(addDays(local.date, days), minute, timeZone);
}
