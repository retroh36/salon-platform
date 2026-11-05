import { deliverOutbox } from "@/lib/messaging/deliver";
import { createAdminClient } from "@/lib/supabase/admin";

// Sends queued texts and emails (lib/messaging/deliver.ts): every minute,
// and called by the database as soon as one is queued. Sends nothing off
// the production site. Called with CRON_SECRET as a bearer token; anything
// else is refused. Counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  return Response.json(await deliverOutbox(createAdminClient()));
}
