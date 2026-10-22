import { computeInsights } from "@/lib/insights/compute";
import { createAdminClient } from "@/lib/supabase/admin";

// The nightly job (vercel.json): recalculates what Denise has learned for
// every salon. Vercel sends CRON_SECRET as a bearer token; anything else is
// refused. Responds with counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: businesses, error } = await admin.from("businesses").select("id");
  if (error) throw error;
  const results = [];
  for (const b of businesses) results.push(await computeInsights(admin, b.id));
  return Response.json({ salons: results.length, durations: results.reduce((s, r) => s + r.durations, 0), clients: results.reduce((s, r) => s + r.clients, 0) });
}
