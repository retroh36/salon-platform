import { createAdminClient } from "@/lib/supabase/admin";
import { runClockReminders } from "@/lib/time-clock-load";

// Reminders to clock in or out (scheduled in the database every five
// minutes, docs/operations.md): an app notice once per shift for anyone
// who hasn't clocked in 10 minutes into it, or is still clocked in 10
// minutes after it ended. Called with CRON_SECRET as a bearer token;
// anything else is refused. Counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  return Response.json({ reminders: await runClockReminders(createAdminClient()) });
}
