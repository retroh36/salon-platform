import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseReconcileRange, paymentsCsv, reconcileCsv } from "@/lib/reconcile";
import { loadReconcile } from "@/lib/reconcile-load";
import { TENDER_LABELS } from "@/lib/reports";
import { formatMinute, toLocal, todayIn } from "@/lib/scheduling/time";

// /reports/reconcile/export?from=…&to=…: a row per day for the bookkeeper,
// or with &detail=payments every payment. The `reports` permission.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "reports")) return new NextResponse("Only owners and managers can export this.", { status: 403 });
  const tz = me.location.timezone;
  const range = parseReconcileRange(Object.fromEntries(url.searchParams), todayIn(tz));
  const { days, lines } = await loadReconcile(supabase, me.business_id, me.location, range);
  const detail = url.searchParams.get("detail") === "payments";
  const csv = detail ? paymentsCsv(lines, TENDER_LABELS, (iso) => formatMinute(toLocal(new Date(iso), tz).minute)) : reconcileCsv(days);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${detail ? "payments" : "reconcile"}-${range.from}-to-${range.to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
