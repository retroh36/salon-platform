import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { exportFiles, exportZip } from "@/lib/data-export";
import { todayIn } from "@/lib/scheduling/time";
import { can } from "@/lib/permissions";

// POST /settings/data/export: every file of the salon's data in one zip,
// for owners. Logged before it's handed over (log_data_export).
export async function POST() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "export_data")) return new NextResponse("Only owners and managers can export the salon's data.", { status: 403 });
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const files = await exportFiles(supabase, me.business_id, tz);
  const { zip, counts } = exportZip(files, me.location.business.name, today);
  const { error } = await supabase.rpc("log_data_export", { p_business_id: me.business_id, p_row_counts: counts, p_bytes: zip.length });
  if (error?.code === "42501") return new NextResponse("Only owners and managers can export the salon's data.", { status: 403 });
  if (error) throw error;
  const slug = me.location.business.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "salon";
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${slug}-data-${today}.zip"`,
      "cache-control": "no-store",
    },
  });
}
