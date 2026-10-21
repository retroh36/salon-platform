import { normalizePhone } from "../../../clients.ts";
import { MINUTES_PER_DAY } from "../../../scheduling/time.ts";
import type { IssueLog } from "../issues.ts";
import type { PhorestLocalTime } from "../types.ts";

export function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t === "" ? null : t;
}

export function cents(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function email(value: unknown, log: IssueLog, entity: string): string | null {
  const t = text(value);
  if (!t) return null;
  if (!EMAIL.test(t)) {
    log.add(entity, "email", "dropped", "not a valid email address");
    return null;
  }
  return t.toLowerCase();
}

// US numbers are formatted like the rest of the app; anything else is kept
// as written (it's still searchable by its digits).
export function phone(value: unknown, log: IssueLog, entity: string): string | null {
  const t = text(value);
  if (!t) return null;
  const normalized = normalizePhone(t);
  if (normalized) return normalized;
  log.add(entity, "phone", "review", "not a 10-digit US number; kept as written");
  return t;
}

// "09:30", "09:30:00", "09:30:00.000", or the documented LocalTime object.
// Returns minutes since midnight, or null.
export function localTimeToMinutes(value: PhorestLocalTime | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
    return h * 60 + min;
  }
  if (typeof value.millisOfDay === "number") return Math.floor(value.millisOfDay / 60_000);
  if (typeof value.hourOfDay === "number") return value.hourOfDay * 60 + (value.minuteOfHour ?? 0);
  return null;
}

// Our schedules use 5-minute steps.
export function toFiveMinutes(minutes: number, direction: "down" | "up" | "nearest" = "nearest"): number {
  const f = direction === "down" ? Math.floor : direction === "up" ? Math.ceil : Math.round;
  return Math.min(MINUTES_PER_DAY, Math.max(0, f(minutes / 5) * 5));
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isoDateTime(value: unknown): string | null {
  const t = text(value);
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
