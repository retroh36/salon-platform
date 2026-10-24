import { runAutomations } from "@/lib/automations-run";
import { createAdminClient } from "@/lib/supabase/admin";

// The hourly automations run (vercel.json): rebook reminders, win-back,
// birthdays and review requests that are due, for every salon, during
// sending hours. Vercel sends CRON_SECRET as a bearer token; anything else
// is refused. Responds with counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  return Response.json(await runAutomations(createAdminClient()));
}
