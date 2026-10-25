import { runEventBilling } from "@/lib/events/billing";
import { createAdminClient } from "@/lib/supabase/admin";

// Events' payments (scheduled in the database hourly at :45,
// docs/operations.md): reminders, scheduled payments and balances that are
// due, charged to the card on file, and receipts, in each salon's sending
// hours. Called with CRON_SECRET as a bearer token; anything else is
// refused. Counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  return Response.json(await runEventBilling(createAdminClient()));
}
