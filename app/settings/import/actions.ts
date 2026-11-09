"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { IMPORT_BATCH, type ImportRow } from "@/lib/client-import";
import { isDemo } from "@/lib/demo";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";

export type BatchResult = { ok: true; importId: string; added: number; skipped: number } | { ok: false; message: string };

// One batch of a file (the browser sends them in turn). A database error
// can quote a row, so only our own messages are passed on.
export async function importBatch(importId: string | null, fileName: string, rows: ImportRow[]): Promise<BatchResult> {
  if (isDemo()) return { ok: false, message: "Importing is off in the demo." };
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers import clients." };
  if (importId && !isUuid(importId)) return { ok: false, message: "Import not found." };
  if (!Array.isArray(rows) || rows.length > IMPORT_BATCH) return { ok: false, message: "That batch is too large." };
  const { data, error } = await supabase.rpc("import_clients", { p_business_id: me!.business_id, p_import_id: importId as string, p_file_name: fileName || "clients.csv", p_rows: rows as never });
  if (error) return { ok: false, message: ["42501", "P0002"].includes(error.code ?? "") ? error.message : "Part of that file didn't import. Anything already added is listed below, and can be undone." };
  const r = data as { import_id: string; added: number; skipped: number };
  revalidatePath("/settings/import");
  return { ok: true, importId: r.import_id, added: r.added, skipped: r.skipped };
}

export async function undoImport(importId: string): Promise<{ ok: boolean; message: string }> {
  if (isDemo()) return { ok: false, message: "Importing is off in the demo." };
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers undo an import." };
  if (!isUuid(importId)) return { ok: false, message: "Import not found." };
  const { data, error } = await supabase.rpc("undo_client_import", { p_import_id: importId });
  if (error) return { ok: false, message: ["42501", "P0002", "22023"].includes(error.code ?? "") ? error.message : "That didn't undo. Try again." };
  const r = data as { removed: number; kept: number };
  revalidatePath("/settings/import");
  return { ok: true, message: `Removed ${r.removed}${r.kept ? `. Kept ${r.kept} who have visits or sales since.` : "."}` };
}
