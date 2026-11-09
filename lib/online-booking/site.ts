// What a salon's public booking site shows, loaded with the service role
// (lib/supabase/admin.ts). Only these fields ever leave the server: no
// client records, notes, contact details of staff, or anything internal.

import { loadLevels, type Level } from "@/lib/levels";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { salonLogoUrl, staffPhotoUrl } from "@/lib/branding";
import type { OpeningHours } from "./intro";
import type { StaffLevel } from "@/lib/schedule-forms";
import { formatPhone } from "./contact";
import { DEFAULT_ACCENT, type DepositKind } from "./settings";
import { levelPricesFrom, sortCategories, stylistPrice } from "@/lib/services";

type Admin = SupabaseClient<Database>;

export type SiteService = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  minutes: number;
  // "consultation": shown, but booked by requesting a consultation first.
  mode: "bookable" | "consultation";
  requiresPatchTest: boolean;
  depositKind: DepositKind;
  depositAmount: number;
};

// A service bundle clients can book online: its services in order, the gap
// before each (the first 0) and its whole length.
export type SiteBundle = { id: string; name: string; description: string | null; serviceIds: string[]; gaps: number[]; minutes: number };

export type SiteStylist = {
  id: string;
  firstName: string;
  // "Bridget Callahan"
  displayName: string;
  level: StaffLevel | null;
  color: string | null;
  photoUrl: string | null;
  // "Lived-in color and balayage", a short bio and up to 3 portfolio
  // photos (Settings → Booking page).
  specialty: string | null;
  bio: string | null;
  portfolio: string[];
  // Their price for each service they offer online, in cents.
  prices: Record<string, number>;
};

export type BookingSite = {
  // The salon's stylist levels, for the badges and "Senior stylist".
  levels: Level[];
  business: { id: string; name: string; slug: string; logoUrl: string | null; coverUrl: string | null };
  location: { id: string; name: string; timezone: string; address: string | null; phone: string | null; hours: OpeningHours[] };
  settings: {
    windowDays: number;
    noticeMinutes: number;
    allowNewClients: boolean;
    cancelCutoffHours: number;
    cancellationPolicy: string;
    consultationServiceId: string | null;
    accent: string;
    welcome: string | null;
    // "Find my stylist" is on the site.
    quizOn: boolean;
  };
  // The salon's patch test rules (see lib/scheduling/patch-tests.ts), and
  // the service a patch test is done at, if it can be booked online.
  patchTest: { validDays: number; minHours: number; serviceId: string | null };
  services: SiteService[];
  // Bundles whose services can all be booked online.
  bundles: SiteBundle[];
  // A photo for each category that has one.
  categoryPhotos: Record<string, string>;
  stylists: SiteStylist[];
};

export type SiteLookup =
  | { status: "open"; site: BookingSite }
  // Online booking is off: the page says so, with the salon's phone.
  | { status: "closed"; name: string; logoUrl: string | null; phone: string | null }
  | { status: "missing" };

export async function loadSite(admin: Admin, slug: string): Promise<SiteLookup> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return { status: "missing" };
  const { data: business, error } = await admin
    .from("businesses")
    .select("id, name, slug, logo_path, patch_test_valid_days, patch_test_min_hours, online_booking_settings(*), locations(id, name, timezone, address_line1, city, region, phone, created_at)")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!business) return { status: "missing" };

  // The salon's first location. (Several locations would add a step.)
  const loc = [...business.locations].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  const settings = business.online_booking_settings;
  const logoUrl = salonLogoUrl(business.logo_path);
  if (!loc || !settings?.enabled) return { status: "closed", name: business.name, logoUrl, phone: loc?.phone ?? null };

  const [{ data: services, error: serviceError }, { data: staff, error: staffError }, { data: hours, error: hoursError }, { data: photos, error: photoError }, levels, { data: bundleRows, error: bundleError }] = await Promise.all([
    admin
      .from("services")
      .select("id, name, category, description, duration_minutes, price_cents, online_booking, requires_patch_test, deposit_kind, deposit_amount, service_level_prices(level, price_cents)")
      .eq("business_id", business.id)
      .is("archived_at", null)
      .neq("online_booking", "off"),
    admin
      .from("staff")
      .select("id, first_name, last_name, level, color, photo_path, specialty, bio, portfolio_paths, staff_services(service_id, price_cents)")
      .eq("location_id", loc.id)
      .eq("role", "stylist")
      .eq("is_active", true)
      .order("first_name"),
    admin.from("location_hours").select("weekday, start_minute, end_minute").eq("location_id", loc.id),
    admin.from("service_category_photos").select("category, photo_path").eq("business_id", business.id),
    loadLevels(admin, business.id),
    admin.from("service_bundles").select("id, name, description, position, parts:service_bundle_parts(position, service_id, gap_minutes)").eq("business_id", business.id).eq("online", true).is("archived_at", null).order("position"),
  ]);
  if (bundleError) throw bundleError;
  if (serviceError) throw serviceError;
  if (staffError) throw staffError;
  if (hoursError) throw hoursError;
  if (photoError) throw photoError;

  const byId = new Map(services.map((s) => [s.id, { price_cents: s.price_cents, levelPrices: levelPricesFrom(s.service_level_prices) }]));
  const stylists: SiteStylist[] = staff
    .map((s) => ({
      id: s.id,
      firstName: s.first_name,
      displayName: [s.first_name, s.last_name].filter(Boolean).join(" "),
      level: s.level,
      color: s.color,
      photoUrl: staffPhotoUrl(s.photo_path),
      specialty: s.specialty?.trim() || null,
      bio: s.bio?.trim() || null,
      portfolio: s.portfolio_paths.map(staffPhotoUrl).filter((u): u is string => Boolean(u)),
      prices: Object.fromEntries(
        s.staff_services
          .filter((ss) => byId.has(ss.service_id))
          .map((ss) => [ss.service_id, stylistPrice(byId.get(ss.service_id)!, { level: s.level, customCents: ss.price_cents })]),
      ),
    }))
    .filter((s) => Object.keys(s.prices).length > 0);

  const offered = new Set(stylists.flatMap((s) => Object.keys(s.prices)));
  const order = sortCategories(services.map((s) => s.category));
  const siteServices: SiteService[] = services
    .filter((s) => offered.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      description: s.description,
      minutes: s.duration_minutes ?? 0,
      mode: s.online_booking as "bookable" | "consultation",
      requiresPatchTest: s.requires_patch_test,
      depositKind: s.deposit_kind,
      depositAmount: s.deposit_amount,
    }))
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name));

  const bookable = new Map(siteServices.filter((s) => s.mode === "bookable").map((s) => [s.id, s]));
  const bundles: SiteBundle[] = bundleRows.flatMap((b) => {
    const parts = [...b.parts].sort((x, y) => x.position - y.position);
    if (parts.length < 2 || !parts.every((p) => bookable.has(p.service_id))) return [];
    const gaps = parts.map((p, n) => (n === 0 ? 0 : p.gap_minutes));
    return [
      {
        id: b.id,
        name: b.name,
        description: b.description,
        serviceIds: parts.map((p) => p.service_id),
        gaps,
        minutes: parts.reduce((sum, p, n) => sum + gaps[n] + bookable.get(p.service_id)!.minutes, 0),
      },
    ];
  });

  const consultation = siteServices.find((s) => s.id === settings.consultation_service_id && s.mode === "bookable");
  const address = [loc.address_line1, [loc.city, loc.region].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null;
  const digits = loc.phone?.replace(/\D/g, "") ?? "";

  return {
    status: "open",
    site: {
      levels,
      business: { id: business.id, name: business.name, slug: business.slug!, logoUrl, coverUrl: salonLogoUrl(settings.cover_path) },
      location: {
        id: loc.id,
        name: loc.name,
        timezone: loc.timezone,
        address,
        phone: digits.length === 10 ? formatPhone(digits) : loc.phone,
        hours: hours.map((h) => ({ weekday: h.weekday, start: h.start_minute, end: h.end_minute })),
      },
      settings: {
        windowDays: settings.window_days,
        noticeMinutes: settings.notice_minutes,
        allowNewClients: settings.allow_new_clients,
        quizOn: settings.quiz_on,
        cancelCutoffHours: settings.cancel_cutoff_hours,
        cancellationPolicy: settings.cancellation_policy,
        consultationServiceId: consultation?.id ?? null,
        accent: settings.accent_color ?? DEFAULT_ACCENT,
        welcome: settings.welcome,
      },
      patchTest: {
        validDays: business.patch_test_valid_days,
        minHours: business.patch_test_min_hours,
        serviceId: siteServices.find((s) => s.id === settings.patch_test_service_id && s.mode === "bookable")?.id ?? null,
      },
      services: siteServices,
      bundles,
      categoryPhotos: Object.fromEntries(photos.filter((p) => siteServices.some((x) => x.category === p.category)).map((p) => [p.category, salonLogoUrl(p.photo_path)!])),
      stylists,
    },
  };
}

// The stylists who can be booked for all of these services online (for
// "no preference", anyone who offers each one).
export function stylistsFor(site: BookingSite, serviceIds: readonly string[]): SiteStylist[] {
  return site.stylists.filter((s) => serviceIds.every((id) => id in s.prices));
}
