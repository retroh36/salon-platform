import { parseDollars } from "@/lib/checkout";
import { validateIntervals, type Interval, type IntervalError } from "@/lib/scheduling/intervals";
import { addDays, isLocalDate, parseTime, WEEKDAYS, type LocalDate, type Weekday } from "@/lib/scheduling/time";

type FormLike = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };
const text = (form: FormLike, name: string) => String(form.get(name) ?? "").trim();

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

const INTERVAL_MESSAGES: Record<IntervalError, string> = {
  invalid_time: "Enter times between midnight and midnight.",
  not_five_minute_steps: "Use 5-minute steps.",
  start_not_before_end: "Each start time must be before its end time.",
  overlapping: "Shifts can't overlap.",
};

// Rows of start/end time inputs (`start_<key>` / `end_<key>`, repeated, in
// order). Fully blank rows are ignored.
function parseRows(form: FormLike, key: string): { intervals: Interval[] } | { error: string } {
  const starts = form.getAll(`start_${key}`).map((v) => String(v).trim());
  const ends = form.getAll(`end_${key}`).map((v) => String(v).trim());
  const intervals: Interval[] = [];

  for (let i = 0; i < Math.max(starts.length, ends.length); i++) {
    const [s, e] = [starts[i] ?? "", ends[i] ?? ""];
    if (!s && !e) continue;
    const start = parseTime(s);
    const end = parseTime(e);
    if (start === null || end === null) return { error: "Enter a start and end time." };
    intervals.push({ start, end });
  }

  const problem = validateIntervals(intervals);
  return problem ? { error: INTERVAL_MESSAGES[problem] } : { intervals };
}

export type WeeklyHoursRow = { weekday: Weekday; start_minute: number; end_minute: number };

// Weekly hours (staff or location): fields start_<weekday> / end_<weekday>.
export function parseWeeklyHoursForm(
  form: FormLike,
): { ok: true; hours: WeeklyHoursRow[] } | { ok: false; errors: Partial<Record<Weekday, string>> } {
  const hours: WeeklyHoursRow[] = [];
  const errors: Partial<Record<Weekday, string>> = {};

  for (const weekday of WEEKDAYS) {
    const result = parseRows(form, String(weekday));
    if ("error" in result) errors[weekday] = result.error;
    else hours.push(...result.intervals.map((i) => ({ weekday, start_minute: i.start, end_minute: i.end })));
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, hours };
}

export const TIME_OFF_REASONS = ["vacation", "sick", "personal", "other"] as const;
export type TimeOffReason = (typeof TIME_OFF_REASONS)[number];

export const REASON_LABELS: Record<TimeOffReason, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  other: "Other",
};

export type TimeOffInput = {
  starts_on: LocalDate;
  ends_on: LocalDate;
  start_minute: number | null;
  end_minute: number | null;
  reason: TimeOffReason;
  note: string | null;
};

export type TimeOffErrors = Partial<Record<"starts_on" | "ends_on" | "times" | "reason" | "note", string>>;

// Fields: starts_on, ends_on (blank = same day), part_day (checkbox),
// start_time, end_time, reason, note. Requests must not start in the past;
// managers can record past time off (e.g. a sick day yesterday).
export function parseTimeOffForm(
  form: FormLike,
  { today, allowPast }: { today: LocalDate; allowPast: boolean },
): { ok: true; value: TimeOffInput } | { ok: false; errors: TimeOffErrors } {
  const errors: TimeOffErrors = {};

  const starts_on = text(form, "starts_on");
  const ends_on = text(form, "ends_on") || starts_on;
  if (!isLocalDate(starts_on)) errors.starts_on = "Choose a date.";
  else if (!allowPast && starts_on < today) errors.starts_on = "Time off can't start in the past.";
  if (!isLocalDate(ends_on)) errors.ends_on = "Choose a date.";
  else if (isLocalDate(starts_on) && ends_on < starts_on) errors.ends_on = "The last day can't be before the first.";
  else if (isLocalDate(starts_on) && ends_on > addDays(starts_on, 366)) errors.ends_on = "Keep it to a year or less.";

  let start_minute: number | null = null;
  let end_minute: number | null = null;
  if (form.get("part_day")) {
    start_minute = parseTime(text(form, "start_time"));
    end_minute = parseTime(text(form, "end_time"));
    if (start_minute === null || end_minute === null) errors.times = "Enter a start and end time.";
    else if (start_minute >= end_minute) errors.times = "The start time must be before the end time.";
    else if (start_minute % 5 !== 0 || end_minute % 5 !== 0) errors.times = "Use 5-minute steps.";
    else if (starts_on !== ends_on) errors.times = "Part-day time off is for a single day.";
  }

  const reason = text(form, "reason") as TimeOffReason;
  if (!TIME_OFF_REASONS.includes(reason)) errors.reason = "Choose a reason.";

  const note = text(form, "note");
  if (note.length > 500) errors.note = "Keep it under 500 characters.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { starts_on, ends_on, start_minute, end_minute, reason, note: note || null } };
}

// Stylist levels, from newest to most experienced. Each has its own color
// (gold, silver, bronze: the --color-level-* tokens) and can have its own
// price for a service.
export const STAFF_LEVELS = ["artisan", "senior", "master"] as const;
export type StaffLevel = (typeof STAFF_LEVELS)[number];

export const LEVEL_LABELS: Record<StaffLevel, string> = { artisan: "Artisan", senior: "Senior", master: "Master" };

export type CompensationInput = { level: StaffLevel | null; service_commission_pct: number; retail_commission_pct: number; hourly_rate_cents: number | null };
export type CompensationErrors = Partial<Record<"level" | "service_commission_pct" | "retail_commission_pct" | "hourly_rate_cents", string>>;

function parsePercent(value: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const n = Number(value);
  return n <= 100 ? n : null;
}

// Fields: level ("" = none), service_commission_pct, retail_commission_pct.
export function parseCompensationForm(
  form: FormLike,
): { ok: true; value: CompensationInput } | { ok: false; errors: CompensationErrors } {
  const errors: CompensationErrors = {};

  const levelText = text(form, "level");
  const level = levelText === "" ? null : (levelText as StaffLevel);
  if (level !== null && !STAFF_LEVELS.includes(level)) errors.level = "Choose a level.";

  const service = parsePercent(text(form, "service_commission_pct") || "0");
  if (service === null) errors.service_commission_pct = "Enter a percentage from 0 to 100.";
  const retail = parsePercent(text(form, "retail_commission_pct") || "0");
  if (retail === null) errors.retail_commission_pct = "Enter a percentage from 0 to 100.";
  // Blank: not paid by the hour.
  const hourlyText = text(form, "hourly_rate");
  const hourly = hourlyText === "" ? null : parseDollars(hourlyText);
  if (hourlyText !== "" && (hourly === null || hourly > 100000)) errors.hourly_rate_cents = "Enter an hourly rate up to $1,000, or leave it empty.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { level, service_commission_pct: service!, retail_commission_pct: retail!, hourly_rate_cents: hourly } };
}
