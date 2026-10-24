// The Storage half of the backup drill (scripts/backup-drill.sh): with a
// file of its own (never a real photo), checks that the backup copies it
// byte for byte, keeps it after it's deleted here, restores it, and drops
// it from the backup 30 days after a deletion; then that every real file
// has an identical copy. Cleans up after itself. Prints counts only.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { KEEP_DELETED_DAYS, backupTarget, restorePhotos, runPhotoBackup, verifyPhotoBackup } from "../lib/photo-backup.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to the environment.
}
const source = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const target = backupTarget(source);
const path = `_backup-drill/${randomUUID()}.jpg`;
const backupPath = `visit-photos/${path}`;
const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2048)]);
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const fail = (why: string) => {
  console.error(`Photo backup drill FAILED: ${why}`);
  process.exitCode = 1;
};

try {
  const up = await source.storage.from("visit-photos").upload(path, bytes, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  await runPhotoBackup(source, target);
  const copy = await target.client.storage.from(target.bucket).download(backupPath);
  if (!copy.data || hash(Buffer.from(await copy.data.arrayBuffer())) !== hash(bytes)) fail("the copy isn't identical");

  // Deleted here: still in the backup, and restored from it.
  await source.storage.from("visit-photos").remove([path]);
  await runPhotoBackup(source, target);
  if (!(await target.client.storage.from(target.bucket).download(backupPath)).data) fail("a deleted file left the backup straight away");
  const { restored } = await restorePhotos(source, target, "visit-photos/_backup-drill/");
  const back = await source.storage.from("visit-photos").download(path);
  if (restored < 1 || !back.data || hash(Buffer.from(await back.data.arrayBuffer())) !== hash(bytes)) fail("the restored file isn't identical");

  // Deleted for good: gone from the backup after the keeping period.
  await source.storage.from("visit-photos").remove([path]);
  await runPhotoBackup(source, target);
  await runPhotoBackup(source, target, new Date(Date.now() + (KEEP_DELETED_DAYS + 1) * 86_400_000));
  if ((await target.client.storage.from(target.bucket).download(backupPath)).data) fail(`a deleted file was still in the backup after ${KEEP_DELETED_DAYS} days`);

  // Every real file has an identical copy.
  await runPhotoBackup(source, target);
  const v = await verifyPhotoBackup(source, target);
  if (v.missing.length || v.different.length) fail(`${v.missing.length} files missing from the backup, ${v.different.length} different`);
  if (!process.exitCode) console.log(`Photo backup drill passed: copied, kept after deletion, restored byte for byte, dropped after ${KEEP_DELETED_DAYS} days; ${v.checked} files checked against the backup (${target.separateProject ? "a separate project" : "this project's photo-backups bucket"}).`);
} finally {
  await source.storage.from("visit-photos").remove([path]);
  await target.client.storage.from(target.bucket).remove([backupPath]);
}
