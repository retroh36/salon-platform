import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { payrollCsv, requestedPeriod } from "@/lib/payroll";
import { loadPayroll, loadPaySettings } from "@/lib/payroll-load";
import { todayIn } from "@/lib/scheduling/time";
import { tipItems, tipsCsv } from "@/lib/tips";

// /payroll/export?from=…&to=…: the period's pay as CSV, a row per person
// (with their average tip), or with &detail=tips every tip, for the salon's
// payroll provider. Owners and managers.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || (me.role !== "owner" && me.role !== "manager")) return new NextResponse("Only owners and managers can export payroll.", { status: 403 });
  const today = todayIn(me.location.timezone);
  const settings = await loadPaySettings(supabase, me.business_id);
  const period = requestedPeriod({ from: url.searchParams.get("from"), to: url.searchParams.get("to") }, settings.kind, settings.anchor, today);
  const lines = await loadPayroll(supabase, me.business_id, me.location.timezone, period, today);
  // ?detail=tips: every tip, a row each.
  const tips = url.searchParams.get("detail") === "tips";
  const csv = tips ? tipsCsv(lines.map((l) => ({ name: l.name, items: tipItems(l.tickets, me.location.timezone) })), period) : payrollCsv(lines, period);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${tips ? "tips" : "payroll"}-${period.from}-to-${period.to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
