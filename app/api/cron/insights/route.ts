import { computeInsights } from "@/lib/insights/compute";
import { scanDay } from "@/lib/denise/scan";
import { todayIn } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";

// The nightly job (vercel.json): recalculates what Denise has learned for
// every salon, then runs her risk check on each location's day, so fixes
// for visits likely to run over are waiting in the morning (recorded as
// proposals for staff to approve). Vercel sends CRON_SECRET as a bearer
// token; anything else is refused. Responds with counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: businesses, error } = await admin.from("businesses").select("id, name, locations(id, timezone)");
  if (error) throw error;
  let durations = 0;
  let clients = 0;
  let risks = 0;
  for (const b of businesses) {
    const counts = await computeInsights(admin, b.id);
    durations += counts.durations;
    clients += counts.clients;
    for (const l of b.locations) {
      const state = await scanDay(admin, { location: { id: l.id, timezone: l.timezone }, salon: b.name, canBook: true }, todayIn(l.timezone), { system: true });
      risks += state.conflicts.filter((c) => c.kind === "likely_overrun").length;
    }
  }
  return Response.json({ salons: businesses.length, durations, clients, risks });
}
