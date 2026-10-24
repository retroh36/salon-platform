import { runAutomations } from "@/lib/automations-run";
import { createAdminClient } from "@/lib/supabase/admin";

// The hourly automations run (scheduled in the database,
// docs/operations.md): rebook reminders, win-back, birthdays and review
// requests that are due, for every salon, during its sending hours. Called
// with CRON_SECRET as a bearer token; anything else is refused. Counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  return Response.json(await runAutomations(createAdminClient()));
}
