// What a salon's public booking site shows, loaded with the service role
// (lib/supabase/admin.ts). Only these fields ever leave the server: no
// client records, notes, contact details of staff, or anything internal.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { salonLogoUrl, staffPhotoUrl } from "@/lib/branding";
import type { StaffLevel } from "@/lib/schedule-forms";
import { formatPhone } from "./contact";
import { DEFAULT_ACCENT, type DepositKind } from "./settings";
import { levelPricesFrom, sortCategories, stylistPrice } from "@/lib/services";
import { firstLetter } from "@/lib/initial";

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

export type SiteStylist = {
  id: string;
  firstName: string;
  // "Bridget C."
  displayName: string;
  level: StaffLevel | null;
  color: string | null;
  photoUrl: string | null;
  // Their price for each service they offer online, in cents.
  prices: Record<string, number>;
};

export type BookingSite = {
  business: { id: string; name: string; slug: string; logoUrl: string | null };
  location: { id: string; name: string; timezone: string; address: string | null; phone: string | null };
  settings: {
    windowDays: number;
    noticeMinutes: number;
    allowNewClients: boolean;
    cancelCutoffHours: number;
    cancellationPolicy: string;
    consultationServiceId: string | null;
    accent: string;
    welcome: string | null;
  };
  // The salon's patch test rules (see lib/scheduling/patch-tests.ts).
  patchTest: { validDays: number; minHours: number };
  services: SiteService[];
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

  const [{ data: services, error: serviceError }, { data: staff, error: staffError }] = await Promise.all([
    admin
      .from("services")
      .select("id, name, category, description, duration_minutes, price_cents, online_booking, requires_patch_test, deposit_kind, deposit_amount, service_level_prices(level, price_cents)")
      .eq("business_id", business.id)
      .is("archived_at", null)
      .neq("online_booking", "off"),
    admin
      .from("staff")
      .select("id, first_name, last_name, level, color, photo_path, staff_services(service_id, price_cents)")
      .eq("location_id", loc.id)
      .eq("role", "stylist")
      .eq("is_active", true)
      .order("first_name"),
  ]);
  if (serviceError) throw serviceError;
  if (staffError) throw staffError;

  const byId = new Map(services.map((s) => [s.id, { price_cents: s.price_cents, levelPrices: levelPricesFrom(s.service_level_prices) }]));
  const stylists: SiteStylist[] = staff
    .map((s) => ({
      id: s.id,
      firstName: s.first_name,
      displayName: s.last_name ? `${s.first_name} ${firstLetter(s.last_name)}.` : s.first_name,
      level: s.level,
      color: s.color,
      photoUrl: staffPhotoUrl(s.photo_path),
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

  const consultation = siteServices.find((s) => s.id === settings.consultation_service_id && s.mode === "bookable");
  const address = [loc.address_line1, [loc.city, loc.region].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null;
  const digits = loc.phone?.replace(/\D/g, "") ?? "";

  return {
    status: "open",
    site: {
      business: { id: business.id, name: business.name, slug: business.slug!, logoUrl },
      location: { id: loc.id, name: loc.name, timezone: loc.timezone, address, phone: digits.length === 10 ? formatPhone(digits) : loc.phone },
      settings: {
        windowDays: settings.window_days,
        noticeMinutes: settings.notice_minutes,
        allowNewClients: settings.allow_new_clients,
        cancelCutoffHours: settings.cancel_cutoff_hours,
        cancellationPolicy: settings.cancellation_policy,
        consultationServiceId: consultation?.id ?? null,
        accent: settings.accent_color ?? DEFAULT_ACCENT,
        welcome: settings.welcome,
      },
      patchTest: { validDays: business.patch_test_valid_days, minHours: business.patch_test_min_hours },
      services: siteServices,
      stylists,
    },
  };
}

// The stylists who can be booked for all of these services online (for
// "no preference", anyone who offers each one).
export function stylistsFor(site: BookingSite, serviceIds: readonly string[]): SiteStylist[] {
  return site.stylists.filter((s) => serviceIds.every((id) => id in s.prices));
}
