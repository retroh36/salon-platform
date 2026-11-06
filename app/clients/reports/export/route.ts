import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { decodeReport, readReport, reportCsvRows, REPORT_LIMIT } from "@/lib/client-reports";
import { knownOf, loadReportMenu, runClientReport } from "@/lib/client-reports-load";
import { csvTable } from "@/lib/csv";
import { can } from "@/lib/permissions";
import { isFrontOfHouse } from "@/lib/staff";
import { todayIn } from "@/lib/scheduling/time";

const REFUSED = "Downloading client lists is for those who can export the salon's data.";

// POST /clients/reports/export: the report on screen as a CSV, with the
// page's columns, for those with export_data. Logged before it's handed
// over (log_data_export), like the salon's data download.
export async function POST(request: Request) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "export_data")) return new NextResponse(REFUSED, { status: 403 });
  const form = await request.formData();
  const menu = await loadReportMenu(supabase, me.business_id);
  const { report } = readReport(decodeReport(String(form.get("r") ?? "")), knownOf(menu));
  const today = todayIn(me.location.timezone);
  const spend = isFrontOfHouse(me.role);
  const { rows } = await runClientReport(supabase, { businessId: me.business_id, timezone: me.location.timezone, today }, report, { spend, limit: REPORT_LIMIT });
  const table = reportCsvRows(rows, spend);
  const csv = csvTable(table.header, table.rows);
  const { error } = await supabase.rpc("log_data_export", { p_business_id: me.business_id, p_row_counts: { client_report: rows.length }, p_bytes: Buffer.byteLength(csv) });
  if (error?.code === "42501") return new NextResponse(REFUSED, { status: 403 });
  if (error) throw error;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="client-report-${today}.csv"`,
      "cache-control": "no-store",
    },
  });
}
