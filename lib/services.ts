import type { Tables } from "@/lib/database.types";
import { STAFF_LEVELS, type StaffLevel } from "@/lib/schedule-forms";

type ServiceTimes = Pick<Tables<"services">, "active_minutes" | "processing_minutes" | "finishing_minutes">;

// Menu order for the standard categories; any others follow alphabetically.
const CATEGORY_ORDER = ["Cuts", "Color", "Highlights", "Balayage", "Blowouts & Styling", "Treatments"];

export const MAX_MINUTES = 8 * 60;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// "$85" for whole dollars, "$85.50" otherwise.
export function formatPrice(cents: number): string {
  const formatted = usd.format(cents / 100);
  return formatted.endsWith(".00") ? formatted.slice(0, -3) : formatted;
}

// For pre-filling a price input: "85" or "85.50".
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

// Parses "85", "85.5", "$1,250.00" into cents. Returns null if not a valid
// non-negative amount with at most two decimals.
export function parsePrice(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [dollars, fraction = ""] = cleaned.split(".");
  return Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
}

// A service's price for each stylist level; a missing level uses the menu
// price.
export type LevelPrices = Partial<Record<StaffLevel, number>>;

// What a stylist charges for a service: their own price, else their level's,
// else the menu price. The database works it out the same way when booking
// (private.stylist_price).
export function stylistPrice(
  service: { price_cents: number; levelPrices?: LevelPrices },
  stylist: { level: StaffLevel | null; customCents: number | null },
): number {
  if (stylist.customCents != null) return stylist.customCents;
  const byLevel = stylist.level ? service.levelPrices?.[stylist.level] : undefined;
  return byLevel ?? service.price_cents;
}

export function levelPricesFrom(rows: readonly { level: StaffLevel; price_cents: number }[]): LevelPrices {
  return Object.fromEntries(rows.map((r) => [r.level, r.price_cents]));
}

// "$85" or "$70–$110".
export function formatPriceRange(prices: readonly number[]): string {
  if (prices.length === 0) return "";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatPrice(min) : `${formatPrice(min)}–${formatPrice(max)}`;
}

// 75 -> "1h 15m", 45 -> "45m", 120 -> "2h".
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function totalMinutes(times: ServiceTimes): number {
  return times.active_minutes + times.processing_minutes + times.finishing_minutes;
}

// "1h 25m" or "1h 25m · 35m processing".
export function formatServiceTime(times: ServiceTimes): string {
  const total = formatMinutes(totalMinutes(times));
  return times.processing_minutes > 0 ? `${total} · ${formatMinutes(times.processing_minutes)} processing` : total;
}

export function sortCategories(categories: Iterable<string>): string[] {
  const rank = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return [...new Set(categories)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function groupByCategory<T extends { category: string; name: string }>(services: readonly T[]) {
  return sortCategories(services.map((s) => s.category)).map((category) => ({
    category,
    services: services.filter((s) => s.category === category).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

// ---------------------------------------------------------------------------
// Form parsing
// ---------------------------------------------------------------------------

export type ServiceInput = {
  name: string;
  category: string;
  description: string;
  active_minutes: number;
  processing_minutes: number;
  finishing_minutes: number;
  price_cents: number;
  // Price per stylist level; null means the default price.
  level_prices: Record<StaffLevel, number | null>;
  // Staff who offer the service; price_cents null means the default price.
  staff: { staff_id: string; price_cents: number | null }[];
};

export type ServiceFormErrors = Partial<
  Record<"name" | "category" | "active_minutes" | "processing_minutes" | "finishing_minutes" | "price_cents", string>
> & { staff?: Record<string, string>; level_prices?: Partial<Record<StaffLevel, string>> };

type FormLike = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

const text = (form: FormLike, name: string) => String(form.get(name) ?? "").trim();

function parseMinutes(value: string, { min }: { min: number }): number | string {
  if (!/^\d+$/.test(value)) return "Enter whole minutes.";
  const n = Number(value);
  if (n < min) return min > 0 ? "Must be at least 5 minutes." : "Can't be negative.";
  if (n % 5 !== 0) return "Use 5-minute steps.";
  if (n > MAX_MINUTES) return `Must be ${MAX_MINUTES / 60} hours or less.`;
  return n;
}

// Form fields: name, category, description, active_minutes,
// processing_minutes, finishing_minutes, price, level_price_<level> (blank =
// default price), staff (repeated staff ids), price_<staffId> (blank = their
// level's price, or the default).
export function parseServiceForm(
  form: FormLike,
): { ok: true; value: ServiceInput } | { ok: false; errors: ServiceFormErrors } {
  const errors: ServiceFormErrors = {};

  const name = text(form, "name");
  if (!name) errors.name = "Enter a name.";
  else if (name.length > 100) errors.name = "Keep it under 100 characters.";

  const category = text(form, "category");
  if (!category) errors.category = "Enter a category.";
  else if (category.length > 50) errors.category = "Keep it under 50 characters.";

  const active = parseMinutes(text(form, "active_minutes"), { min: 5 });
  if (typeof active === "string") errors.active_minutes = active;
  const processing = parseMinutes(text(form, "processing_minutes") || "0", { min: 0 });
  if (typeof processing === "string") errors.processing_minutes = processing;
  const finishing = parseMinutes(text(form, "finishing_minutes") || "0", { min: 0 });
  if (typeof finishing === "string") errors.finishing_minutes = finishing;
  if (processing === 0 && typeof finishing === "number" && finishing > 0) {
    errors.finishing_minutes = "Finishing time only applies after a processing gap.";
  }
  if (
    typeof active === "number" &&
    typeof processing === "number" &&
    typeof finishing === "number" &&
    active + processing + finishing > MAX_MINUTES
  ) {
    errors.active_minutes = `Total time must be ${MAX_MINUTES / 60} hours or less.`;
  }

  const price = parsePrice(text(form, "price"));
  if (price === null) errors.price_cents = "Enter a price like 85 or 85.50.";

  const levelPrices = {} as Record<StaffLevel, number | null>;
  for (const level of STAFF_LEVELS) {
    const raw = text(form, `level_price_${level}`);
    const cents = raw ? parsePrice(raw) : null;
    if (raw && cents === null) errors.level_prices = { ...errors.level_prices, [level]: "Enter a price like 85, or leave blank." };
    levelPrices[level] = cents;
  }

  const staffIds = [...new Set(form.getAll("staff").map(String))];
  const staff: ServiceInput["staff"] = [];
  for (const staffId of staffIds) {
    const raw = text(form, `price_${staffId}`);
    if (!raw) {
      staff.push({ staff_id: staffId, price_cents: null });
      continue;
    }
    const custom = parsePrice(raw);
    if (custom === null) {
      errors.staff = { ...errors.staff, [staffId]: "Enter a price like 85 or 85.50, or leave blank." };
    } else {
      staff.push({ staff_id: staffId, price_cents: custom });
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      category,
      description: text(form, "description"),
      active_minutes: active as number,
      processing_minutes: processing as number,
      finishing_minutes: finishing as number,
      price_cents: price as number,
      level_prices: levelPrices,
      staff,
    },
  };
}
