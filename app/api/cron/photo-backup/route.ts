import { backupTarget, runPhotoBackup } from "@/lib/photo-backup";
import { createAdminClient } from "@/lib/supabase/admin";

// The nightly copy of Storage files (photos, logos) to the backup bucket
// (docs/operations.md). Called by the database's scheduler with
// CRON_SECRET as a bearer token; anything else is refused. Counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  const admin = createAdminClient();
  return Response.json(await runPhotoBackup(admin, backupTarget(admin)));
}
