import { NextResponse } from "next/server";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { csvTable } from "@/lib/csv";
import { loadBalances } from "@/lib/pto-load";
import { todayIn } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";

// /scheduling/balances/export: everyone's PTO as CSV, a row per person in
// hours, with time off taken this PTO year by type. Owners and managers.
export async function GET() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return new NextResponse("Only owners and managers can export balances.", { status: 403 });
  const today = todayIn(me.location.timezone);
  const pto = await loadBalances(supabase, { businessId: me.business_id, location: me.location, today });
  if (!pto) return new NextResponse("PTO isn't tracked.", { status: 404 });
  const hours = (m: number) => (Math.round((m / 60) * 100) / 100).toFixed(2);
  const csv = csvTable(
    ["Name", "Role", "PTO year from", "Carried over", "Earned this year", "Used this year", "Balance", "Booked", "Waiting", "Left to ask for", ...pto.types.map((t) => `Taken: ${t.name}`)],
    pto.people.map((p) => [
      fullName({ first_name: p.firstName, last_name: p.lastName }),
      p.role,
      p.statement.yearStart,
      hours(p.statement.carriedIn),
      hours(p.statement.earnedThisYear),
      hours(p.statement.usedThisYear),
      hours(p.statement.balance),
      hours(p.statement.booked),
      hours(p.statement.pending),
      hours(p.statement.available),
      ...pto.types.map((t) => hours(p.takenByType.get(t.id) ?? 0)),
    ]),
  );
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="pto-balances-${today}.csv"`,
      "cache-control": "no-store",
    },
  });
}
