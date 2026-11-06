import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { DRAFT_FEATURE } from "@/lib/coverage";
import type { MonthDraft } from "./denise-schedule";

type Supabase = SupabaseClient<Database>;

// Denise's latest month draft: waiting, or applied in the last day (for Undo).
export async function loadMonthDraft(supabase: Supabase, locationId: string): Promise<MonthDraft | null> {
  const { data, error } = await supabase
    .from("ai_actions")
    .select("id, status, summary, reason, proposal, decided_at")
    .eq("location_id", locationId)
    .eq("feature", DRAFT_FEATURE)
    .in("status", ["proposed", "approved"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data[0];
  if (!row || (row.status === "approved" && Date.parse(row.decided_at ?? "") < Date.now() - 86_400_000)) return null;
  const proposal = row.proposal as { filled?: string[]; left?: string[] };
  return { id: row.id, status: row.status as MonthDraft["status"], summary: row.summary, reason: row.reason, filled: proposal.filled ?? [], left: proposal.left ?? [] };
}
