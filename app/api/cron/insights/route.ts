import { computeInsights } from "@/lib/insights/compute";
import { createAdminClient } from "@/lib/supabase/admin";

// The nightly insights job (scheduled in the database, docs/operations.md):
// recalculates what Denise has learned for every salon. Called with
// CRON_SECRET as a bearer token; anything else is refused. Counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: businesses, error } = await admin.from("businesses").select("id");
  if (error) throw error;
  let durations = 0;
  let clients = 0;
  for (const b of businesses) {
    const counts = await computeInsights(admin, b.id);
    durations += counts.durations;
    clients += counts.clients;
  }
  return Response.json({ salons: businesses.length, durations, clients });
}
