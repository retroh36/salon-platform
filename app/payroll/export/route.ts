import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { payrollCsv, requestedPeriod } from "@/lib/payroll";
import { loadPayroll, loadPaySettings } from "@/lib/payroll-load";
import { todayIn } from "@/lib/scheduling/time";

// /payroll/export?from=…&to=…: the period's pay as CSV, a row per person,
// for the salon's payroll provider. Owners and managers.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || (me.role !== "owner" && me.role !== "manager")) return new NextResponse("Only owners and managers can export payroll.", { status: 403 });
  const today = todayIn(me.location.timezone);
  const settings = await loadPaySettings(supabase, me.business_id);
  const period = requestedPeriod({ from: url.searchParams.get("from"), to: url.searchParams.get("to") }, settings.kind, settings.anchor, today);
  const lines = await loadPayroll(supabase, me.business_id, me.location.timezone, period, today);
  return new NextResponse(payrollCsv(lines, period), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payroll-${period.from}-to-${period.to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
