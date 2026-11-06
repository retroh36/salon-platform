import { createAdminClient } from "@/lib/supabase/admin";
import { runReminders } from "@/lib/reminders-run";

// Appointment reminders (scheduled in the database every 15 minutes,
// docs/operations.md): a fixed message to each client their salon's chosen
// time before a visit, into the outbox, which holds it until the salon
// goes live with texts and email. Called with CRON_SECRET as a bearer
// token; anything else is refused. Counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  return Response.json(await runReminders(createAdminClient()));
}
