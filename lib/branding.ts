// The two brands: Maestra, the product (login, browser tab, loading screen,
// platform emails, "Powered by Maestra"), and the salon's own (its name and
// logo, at the top of the sidebar and on messages to its clients). See
// docs/brand.md.

export const PRODUCT_NAME = "Maestra";
export const TAGLINE = "Your salon’s brain. Meet Denise.";
// Maestra's navy, for the browser theme color and the app icon.
export const BRAND_NAVY = "#17273b";

// Where the app lives, for absolute links in previews: NEXT_PUBLIC_SITE_URL,
// else the Vercel production URL, else local.
export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

// Salon logos: the public `salon-logos` bucket, under the business id.
export const LOGO_BUCKET = "salon-logos";
export const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function salonLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${LOGO_BUCKET}/${path}`;
}

// Stylist photos (for the booking site): the public `staff-photos` bucket.
export function staffPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/staff-photos/${path}`;
}

// The fallback mark: the salon name's first letter.
export function salonInitial(name: string): string {
  return name.trim()[0]?.toUpperCase() ?? "S";
}

// A location as the sidebar's salon card shows it, under the salon's name:
// without the words it shares with the salon ("Maple & Ash Downtown" at
// "Maple & Ash Hair Studio" is "Downtown"), when they share at least two
// words or the salon's whole name; else in full ("Maple Street").
export function locationLabel(businessName: string, locationName: string): string {
  const salon = businessName.trim().split(/\s+/);
  const words = locationName.trim().split(/\s+/);
  let shared = 0;
  while (shared < words.length && words[shared].toLowerCase() === salon[shared]?.toLowerCase()) shared++;
  const sharesName = shared >= 2 || (shared > 0 && shared === salon.length);
  return sharesName && shared < words.length ? words.slice(shared).join(" ") : locationName.trim();
}
