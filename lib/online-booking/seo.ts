// How a salon's booking site shows up in Google and when it's shared: its
// title and description, the canonical link, and structured data
// (schema.org HairSalon with the address, hours, services and a Book
// action). seoFor is pure (unit-tested); loadSeo reads only what the site
// already shows, with the service role.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadSite } from "./site";

type Admin = SupabaseClient<Database>;

export type SeoInfo = {
  name: string;
  slug: string;
  logoUrl: string | null;
  welcome: string | null;
  address: { line1: string | null; line2: string | null; city: string | null; region: string | null; postalCode: string | null; country: string | null };
  phone: string | null;
  // Opening hours: ISO weekday (1 = Monday) and local minutes.
  hours: { weekday: number; start: number; end: number }[];
  // Each service bookable online, from its lowest price.
  services: { name: string; category: string; fromCents: number }[];
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const money = (cents: number) => (cents / 100).toFixed(2);

export function seoFor(info: SeoInfo, baseUrl: string) {
  const url = `${baseUrl}/book/${info.slug}`;
  const place = [info.address.city, info.address.region].filter(Boolean).join(", ");
  const title = place ? `Book online at ${info.name} · ${place}` : `Book online at ${info.name}`;
  const categories = [...new Set(info.services.map((s) => s.category))].slice(0, 3).map((c) => c.toLowerCase());
  const offer = categories.length ? `${categories.join(", ").replace(/, ([^,]*)$/, " and $1")}` : "appointments";
  // Their welcome line, if they have one, then what and where.
  const welcome = info.welcome?.trim().replace(/([^.!?])$/, "$1.");
  const description = [welcome, `Book ${offer} at ${info.name}${place ? ` in ${place}` : ""}. Choose your service, stylist and time online, any time.`]
    .filter(Boolean)
    .join(" ")
    .slice(0, 300);
  const prices = info.services.map((s) => s.fromCents).filter((c) => c > 0);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HairSalon",
    name: info.name,
    url,
    ...(info.logoUrl ? { image: info.logoUrl, logo: info.logoUrl } : {}),
    ...(info.phone ? { telephone: info.phone } : {}),
    ...(info.address.line1 || info.address.city
      ? {
          address: {
            "@type": "PostalAddress",
            ...(info.address.line1 ? { streetAddress: [info.address.line1, info.address.line2].filter(Boolean).join(", ") } : {}),
            ...(info.address.city ? { addressLocality: info.address.city } : {}),
            ...(info.address.region ? { addressRegion: info.address.region } : {}),
            ...(info.address.postalCode ? { postalCode: info.address.postalCode } : {}),
            addressCountry: info.address.country || "US",
          },
        }
      : {}),
    ...(info.hours.length
      ? {
          openingHoursSpecification: [...info.hours]
            .sort((a, b) => a.weekday - b.weekday || a.start - b.start)
            .map((h) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: `https://schema.org/${DAYS[h.weekday - 1]}`, opens: hhmm(h.start), closes: hhmm(h.end) })),
        }
      : {}),
    ...(prices.length ? { priceRange: `$${Math.round(Math.min(...prices) / 100)}–$${Math.round(Math.max(...prices) / 100)}` } : {}),
    ...(info.services.length
      ? {
          hasOfferCatalog: {
            "@type": "OfferCatalog",
            name: "Services",
            itemListElement: info.services.slice(0, 30).map((s) => ({
              "@type": "Offer",
              itemOffered: { "@type": "Service", name: s.name, category: s.category },
              ...(s.fromCents > 0 ? { priceSpecification: { "@type": "PriceSpecification", minPrice: money(s.fromCents), priceCurrency: "USD" } } : {}),
            })),
          },
        }
      : {}),
    potentialAction: {
      "@type": "ReserveAction",
      target: { "@type": "EntryPoint", urlTemplate: url, actionPlatform: ["https://schema.org/DesktopWebPlatform", "https://schema.org/MobileWebPlatform"] },
      result: { "@type": "Reservation", name: "Appointment" },
    },
  };
  return { url, title, description, jsonLd };
}

// JSON for a <script type="application/ld+json">: "<" escaped so nothing
// in a salon's text can close the tag.
export const jsonLdText = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

export async function loadSeo(admin: Admin, slug: string): Promise<SeoInfo | null> {
  const found = await loadSite(admin, slug);
  if (found.status !== "open") return null;
  const { site } = found;
  const [{ data: loc, error }, { data: hours, error: hoursError }] = await Promise.all([
    admin.from("locations").select("address_line1, address_line2, city, region, postal_code, country").eq("id", site.location.id).single(),
    admin.from("location_hours").select("weekday, start_minute, end_minute").eq("location_id", site.location.id),
  ]);
  if (error) throw error;
  if (hoursError) throw hoursError;
  return {
    name: site.business.name,
    slug: site.business.slug,
    logoUrl: site.business.logoUrl,
    welcome: site.settings.welcome,
    address: { line1: loc.address_line1, line2: loc.address_line2, city: loc.city, region: loc.region, postalCode: loc.postal_code, country: loc.country },
    phone: site.location.phone,
    hours: hours.map((h) => ({ weekday: h.weekday, start: h.start_minute, end: h.end_minute })),
    services: site.services.map((s) => ({
      name: s.name,
      category: s.category,
      fromCents: Math.min(...site.stylists.flatMap((st) => (s.id in st.prices ? [st.prices[s.id]] : [])), Infinity),
    })).map((s) => ({ ...s, fromCents: Number.isFinite(s.fromCents) ? s.fromCents : 0 })),
  };
}
