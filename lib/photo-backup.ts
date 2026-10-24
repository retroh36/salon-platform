// Backing up the files in Storage (docs/operations.md): database backups
// don't include them, and before and after photos can't be replaced. Every
// night, new and changed files in the salon buckets are copied to a private
// backup bucket, ideally in a separate Supabase project
// (PHOTO_BACKUP_SUPABASE_URL and PHOTO_BACKUP_SECRET_KEY), else the
// `photo-backups` bucket in this one. A file deleted here stays in the
// backup for 30 days (so a mistake can be undone), then goes too (so a
// client's photo, once removed, doesn't live on). Service role only; runs
// under plain Node too (npm run photos:backup), so relative .ts imports.

import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const PHOTO_BUCKETS = ["visit-photos", "staff-photos", "salon-logos"] as const;
export const BACKUP_BUCKET = "photo-backups";
export const KEEP_DELETED_DAYS = 30;
const MANIFEST = "_manifest.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;
export type Target = { client: Client; bucket: string; separateProject: boolean };
export type StoredFile = { path: string; size: number; updatedAt: string; contentType: string | null };

// Where backups go: a separate project if one's set up, else this one.
export function backupTarget(source: Client, env: Record<string, string | undefined> = process.env): Target {
  const url = env.PHOTO_BACKUP_SUPABASE_URL;
  const key = env.PHOTO_BACKUP_SECRET_KEY;
  if (url && key) return { client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), bucket: env.PHOTO_BACKUP_BUCKET || BACKUP_BUCKET, separateProject: true };
  return { client: source, bucket: BACKUP_BUCKET, separateProject: false };
}

// Every file under a folder of a bucket, a page at a time, folders opened.
export async function listFiles(client: Client, bucket: string, prefix = ""): Promise<StoredFile[]> {
  const out: StoredFile[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) out.push(...(await listFiles(client, bucket, path)));
      else out.push({ path, size: Number(item.metadata?.size ?? 0), updatedAt: item.updated_at ?? item.created_at ?? "", contentType: (item.metadata?.mimetype as string) ?? null });
    }
    if (data.length < 1000) break;
  }
  return out;
}

async function copy(from: Client, fromBucket: string, fromPath: string, to: Client, toBucket: string, toPath: string, contentType: string | null) {
  const { data, error } = await from.storage.from(fromBucket).download(fromPath);
  if (error) throw error;
  const { error: upError } = await to.storage.from(toBucket).upload(toPath, data, { upsert: true, contentType: contentType ?? data.type ?? "application/octet-stream" });
  if (upError) throw upError;
  return data.size;
}

type Manifest = { missingSince: Record<string, string> };

async function readManifest(t: Target): Promise<Manifest> {
  const { data } = await t.client.storage.from(t.bucket).download(MANIFEST);
  if (!data) return { missingSince: {} };
  try {
    return JSON.parse(await data.text()) as Manifest;
  } catch {
    return { missingSince: {} };
  }
}

export type BackupSummary = { files: number; copied: number; bytes: number; kept: number; removed: number };

export async function runPhotoBackup(source: Client, target: Target, now = new Date()): Promise<BackupSummary> {
  const summary: BackupSummary = { files: 0, copied: 0, bytes: 0, kept: 0, removed: 0 };
  const backedUp = new Map((await listFiles(target.client, target.bucket)).filter((f) => f.path !== MANIFEST).map((f) => [f.path, f]));
  const present = new Set<string>();
  for (const bucket of PHOTO_BUCKETS) {
    for (const f of await listFiles(source, bucket)) {
      const path = `${bucket}/${f.path}`;
      present.add(path);
      summary.files += 1;
      const copyOf = backedUp.get(path);
      // New, or changed since (a different size, or written after the copy).
      if (!copyOf || copyOf.size !== f.size || copyOf.updatedAt < f.updatedAt) {
        summary.bytes += await copy(source, bucket, f.path, target.client, target.bucket, path, f.contentType);
        summary.copied += 1;
      }
    }
  }
  // Deleted here: kept for a while, then removed from the backup too.
  const manifest = await readManifest(target);
  const missingSince: Record<string, string> = {};
  const expired: string[] = [];
  for (const path of backedUp.keys()) {
    if (present.has(path)) continue;
    const since = manifest.missingSince[path] ?? now.toISOString();
    if (now.getTime() - Date.parse(since) >= KEEP_DELETED_DAYS * 86_400_000) expired.push(path);
    else missingSince[path] = since;
  }
  if (expired.length) {
    const { error } = await target.client.storage.from(target.bucket).remove(expired);
    if (error) throw error;
  }
  summary.removed = expired.length;
  summary.kept = Object.keys(missingSince).length;
  const { error } = await target.client.storage
    .from(target.bucket)
    .upload(MANIFEST, new Blob([JSON.stringify({ missingSince, lastRun: now.toISOString() })], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw error;
  return summary;
}

// Puts back whatever's in the backup but missing here (all buckets, or
// only paths under a prefix like "visit-photos/<business>/").
export async function restorePhotos(source: Client, target: Target, prefix = ""): Promise<{ restored: number }> {
  const existing = new Set<string>();
  for (const bucket of PHOTO_BUCKETS) for (const f of await listFiles(source, bucket)) existing.add(`${bucket}/${f.path}`);
  let restored = 0;
  for (const f of await listFiles(target.client, target.bucket)) {
    if (f.path === MANIFEST || existing.has(f.path) || !f.path.startsWith(prefix)) continue;
    const [bucket, ...rest] = f.path.split("/");
    if (!(PHOTO_BUCKETS as readonly string[]).includes(bucket)) continue;
    await copy(target.client, target.bucket, f.path, source, bucket, rest.join("/"), f.contentType);
    restored += 1;
  }
  return { restored };
}

const sha256 = async (blob: Blob) => createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex");

// Every file here has a copy in the backup with the same bytes.
export async function verifyPhotoBackup(source: Client, target: Target): Promise<{ checked: number; missing: string[]; different: string[] }> {
  const result = { checked: 0, missing: [] as string[], different: [] as string[] };
  for (const bucket of PHOTO_BUCKETS) {
    for (const f of await listFiles(source, bucket)) {
      const path = `${bucket}/${f.path}`;
      result.checked += 1;
      const [{ data: here }, { data: there }] = await Promise.all([source.storage.from(bucket).download(f.path), target.client.storage.from(target.bucket).download(path)]);
      if (!there) result.missing.push(path);
      else if (!here || (await sha256(here)) !== (await sha256(there))) result.different.push(path);
    }
  }
  return result;
}
