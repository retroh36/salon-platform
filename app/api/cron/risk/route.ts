import { scanDay } from "@/lib/denise/scan";
import { todayIn } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";

// Denise's risk check (scheduled in the database after the nightly
// insights, and again early in the morning, docs/operations.md): looks over
// each location's day, so fixes for visits likely to run over are waiting
// when the salon opens (recorded as proposals for staff to approve). Called
// with CRON_SECRET as a bearer token; anything else is refused. Counts only.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: businesses, error } = await admin.from("businesses").select("name, locations(id, timezone)");
  if (error) throw error;
  let locations = 0;
  let risks = 0;
  for (const b of businesses) {
    for (const l of b.locations) {
      const state = await scanDay(admin, { location: { id: l.id, timezone: l.timezone }, salon: b.name, canBook: true }, todayIn(l.timezone), { system: true });
      locations += 1;
      risks += state.conflicts.filter((c) => c.kind === "likely_overrun").length;
    }
  }
  return Response.json({ locations, risks });
}
