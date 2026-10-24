import { runMembershipBilling } from "@/lib/memberships-billing";
import { createAdminClient } from "@/lib/supabase/admin";

// The nightly membership run (vercel.json): renewals due today, retries of
// failed payments, and pauses and cancellations that start. Vercel sends
// CRON_SECRET as a bearer token; anything else is refused. Responds with
// counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  return Response.json(await runMembershipBilling(createAdminClient()));
}
