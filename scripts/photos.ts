// npm run photos -- backup | restore [prefix] | verify
//
// The Storage file backup (lib/photo-backup.ts, docs/operations.md): copy
// new and changed files to the backup bucket (the same job runs nightly),
// put back files missing here (all, or under a prefix such as
// "visit-photos/<business id>/"), or check every file has an identical
// copy. Prints counts and paths only, never file contents.

import { createClient } from "@supabase/supabase-js";
import { backupTarget, restorePhotos, runPhotoBackup, verifyPhotoBackup } from "../lib/photo-backup.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to the environment.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(1);
}
const source = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const target = backupTarget(source);
const [command, prefix = ""] = process.argv.slice(2);
console.log(`Backup: ${target.separateProject ? "a separate Supabase project" : "this project"}, bucket ${target.bucket}`);

if (command === "backup") {
  const s = await runPhotoBackup(source, target);
  console.log(`${s.files} files; ${s.copied} copied (${Math.round(s.bytes / 1024)} KB); ${s.kept} deleted here, kept for now; ${s.removed} removed after 30 days`);
} else if (command === "restore") {
  const { restored } = await restorePhotos(source, target, prefix);
  console.log(`Restored ${restored} files${prefix ? ` under ${prefix}` : ""}`);
} else if (command === "verify") {
  const r = await verifyPhotoBackup(source, target);
  console.log(`Checked ${r.checked} files: ${r.missing.length} missing from the backup, ${r.different.length} different`);
  for (const p of [...r.missing, ...r.different]) console.log(`  ${p}`);
  if (r.missing.length || r.different.length) process.exit(1);
} else {
  console.error("Use: npm run photos -- backup | restore [prefix] | verify");
  process.exit(1);
}
