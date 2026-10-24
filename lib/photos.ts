// Before and after photos (pure helpers, unit-tested; the shrinking runs in
// the browser). Photos live in the private `visit-photos` bucket and are
// never sent to the AI.

export const PHOTO_BUCKET = "visit-photos";
export const PHOTO_KINDS = ["before", "after"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];
export const PHOTO_KIND_LABELS: Record<PhotoKind, string> = { before: "Before", after: "After" };

// Photos are shrunk to this many pixels on the long side before upload.
export const PHOTO_MAX_SIDE = 2000;
// What the server accepts after shrinking (server actions take up to 3 MB).
export const PHOTO_MAX_BYTES = 2_500_000;
// Signed links last an hour.
export const PHOTO_URL_SECONDS = 3600;

export type PhotoType = { ext: "jpg" | "png" | "webp"; contentType: string };

// What a file really is, from its first bytes (never the name or the
// browser's say-so).
export function sniffImage(bytes: Uint8Array): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", contentType: "image/jpeg" };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return { ext: "png", contentType: "image/png" };
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", contentType: "image/webp" };
  return null;
}

// <business>/<client>/<photo id>.<ext>: one folder per salon, then client.
export const photoPath = (businessId: string, clientId: string, photoId: string, ext: PhotoType["ext"]) => `${businessId}/${clientId}/${photoId}.${ext}`;

// The size to draw at so the long side is at most `max`, never enlarged.
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Shrinks a photo in the browser and re-encodes it as JPEG, which also
// drops its metadata (where it was taken, the device). Upright, as the
// camera meant it.
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const size = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that photo"))), "image/jpeg", 0.85));
}

export type PhotoView = {
  id: string;
  kind: PhotoKind;
  url: string;
  takenOn: string;
  stylist: string | null;
  marketingOk: boolean;
  appointmentId: string;
  // Whoever added it, or a manager, may remove it.
  canDelete: boolean;
};

// The gallery: visits newest first, before photos ahead of after.
export function byVisit<T extends { appointmentId: string; takenOn: string; kind: PhotoKind }>(photos: readonly T[]): { appointmentId: string; takenOn: string; photos: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const p of photos) groups.set(p.appointmentId, [...(groups.get(p.appointmentId) ?? []), p]);
  return [...groups.entries()]
    .map(([appointmentId, list]) => ({
      appointmentId,
      takenOn: list.reduce((d, p) => (p.takenOn < d ? p.takenOn : d), list[0].takenOn),
      photos: [...list].sort((a, b) => PHOTO_KINDS.indexOf(a.kind) - PHOTO_KINDS.indexOf(b.kind)),
    }))
    .sort((a, b) => b.takenOn.localeCompare(a.takenOn));
}
