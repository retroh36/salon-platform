// The two brands: Maestra, the product (login, browser tab, loading screen,
// platform emails, "Powered by Maestra"), and the salon's own (its name and
// logo, at the top of the sidebar and on messages to its clients). See
// docs/brand.md.

export const PRODUCT_NAME = "Maestra";

// Salon logos: the public `salon-logos` bucket, under the business id.
export const LOGO_BUCKET = "salon-logos";
export const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function salonLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${LOGO_BUCKET}/${path}`;
}

// The fallback mark: the salon name's first letter.
export function salonInitial(name: string): string {
  return name.trim()[0]?.toUpperCase() ?? "S";
}
