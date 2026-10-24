import { runPolicyCharges } from "@/lib/policy-billing";
import { createAdminClient } from "@/lib/supabase/admin";

// The policy's fees (scheduled in the database every 15 minutes,
// docs/operations.md): late-cancel and no-show fees past their grace
// charged to the card on file, receipts, and refunds of waived fees and
// deposits. Called with CRON_SECRET as a bearer token; anything else is
// refused. Counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  return Response.json(await runPolicyCharges(createAdminClient()));
}
