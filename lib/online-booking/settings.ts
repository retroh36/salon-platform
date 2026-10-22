// The salon's online booking rules and look, as set on Settings → Online
// booking, and the sums the booking site shows (prices and deposits).

import { contrast, isHexColor } from "@/lib/color";
import { parsePrice } from "@/lib/services";

export type OnlineMode = "bookable" | "consultation" | "off";
export type DepositKind = "none" | "fixed" | "percent";

export const ONLINE_MODE_LABELS: Record<OnlineMode, string> = {
  bookable: "Bookable online",
  consultation: "Consultation first",
  off: "Not online",
};

// The booking site's color when the salon hasn't chosen one (Maestra navy).
export const DEFAULT_ACCENT = "#17273b";

// A deposit for one service at the price it's booked at. A fixed deposit is
// never more than the price.
export function depositFor(kind: DepositKind, amount: number, priceCents: number): number {
  if (kind === "fixed") return Math.min(amount, priceCents);
  if (kind === "percent") return Math.round((priceCents * amount) / 100);
  return 0;
}

// "$50 deposit" or "25% deposit".
export function describeDeposit(kind: DepositKind, amount: number): string | null {
  if (kind === "fixed") return `$${(amount / 100).toFixed(amount % 100 ? 2 : 0)} deposit`;
  if (kind === "percent") return `${amount}% deposit`;
  return null;
}

// The site's buttons are white text on the accent color: it must pass WCAG AA.
export function accentReadable(hex: string): boolean {
  return isHexColor(hex) && contrast("#ffffff", hex) >= 4.5;
}

// A salon's booking address: lowercase words joined by hyphens.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

export type BookingSettingsInput = {
  enabled: boolean;
  slug: string;
  window_days: number;
  notice_minutes: number;
  allow_new_clients: boolean;
  cancel_cutoff_hours: number;
  cancellation_policy: string;
  consultation_service_id: string | null;
  accent_color: string | null;
  welcome: string | null;
};

export type BookingSettingsErrors = Partial<Record<keyof BookingSettingsInput, string>>;

type FormLike = { get(name: string): FormDataEntryValue | null };
const text = (form: FormLike, name: string) => String(form.get(name) ?? "").trim();

function wholeNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

// Fields: enabled (checkbox), slug, window_days, notice_hours,
// allow_new_clients (checkbox), cancel_cutoff_hours, cancellation_policy,
// consultation_service_id ("" = none), accent_color ("" = default), welcome.
export function parseBookingSettings(
  form: FormLike,
): { ok: true; value: BookingSettingsInput } | { ok: false; errors: BookingSettingsErrors } {
  const errors: BookingSettingsErrors = {};

  const slug = text(form, "slug").toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 60) {
    errors.slug = "Use 3 to 60 lowercase letters, numbers and single hyphens.";
  }

  const window = wholeNumber(text(form, "window_days"), 1, 365);
  if (window === null) errors.window_days = "Enter 1 to 365 days.";
  const noticeHours = wholeNumber(text(form, "notice_hours"), 0, 168);
  if (noticeHours === null) errors.notice_minutes = "Enter 0 to 168 hours.";
  const cutoff = wholeNumber(text(form, "cancel_cutoff_hours"), 0, 168);
  if (cutoff === null) errors.cancel_cutoff_hours = "Enter 0 to 168 hours.";

  const policy = text(form, "cancellation_policy");
  if (policy.length > 2000) errors.cancellation_policy = "Keep it under 2,000 characters.";
  const welcome = text(form, "welcome");
  if (welcome.length > 280) errors.welcome = "Keep it under 280 characters.";

  const accent = text(form, "accent_color").toLowerCase();
  if (accent && !accentReadable(accent)) errors.accent_color = "Choose a darker color: white text on it must be easy to read.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      enabled: form.get("enabled") !== null,
      slug,
      window_days: window!,
      notice_minutes: noticeHours! * 60,
      allow_new_clients: form.get("allow_new_clients") !== null,
      cancel_cutoff_hours: cutoff!,
      cancellation_policy: policy,
      consultation_service_id: text(form, "consultation_service_id") || null,
      accent_color: accent || null,
      welcome: welcome || null,
    },
  };
}

export type ServiceOnlineInput = { online_booking: OnlineMode; deposit_kind: DepositKind; deposit_amount: number };

// One service's row: mode, deposit_kind, deposit (dollars or percent).
export function parseServiceOnline(mode: string, kind: string, amount: string): { ok: true; value: ServiceOnlineInput } | { ok: false; error: string } {
  if (!["bookable", "consultation", "off"].includes(mode)) return { ok: false, error: "Choose how it's booked online." };
  if (kind === "none" || kind === "") return { ok: true, value: { online_booking: mode as OnlineMode, deposit_kind: "none", deposit_amount: 0 } };
  if (kind === "fixed") {
    const cents = parsePrice(amount);
    if (cents === null || cents === 0) return { ok: false, error: "Enter a deposit like 50." };
    return { ok: true, value: { online_booking: mode as OnlineMode, deposit_kind: "fixed", deposit_amount: cents } };
  }
  if (kind === "percent") {
    const pct = wholeNumber(amount.replace(/%$/, "").trim(), 1, 100);
    if (pct === null) return { ok: false, error: "Enter a percentage from 1 to 100." };
    return { ok: true, value: { online_booking: mode as OnlineMode, deposit_kind: "percent", deposit_amount: pct } };
  }
  return { ok: false, error: "Choose a deposit type." };
}
