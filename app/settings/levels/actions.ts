"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { levelProblems, loadLevels, type Level, type LevelDraft } from "@/lib/levels";
import { can } from "@/lib/permissions";

// On success, the levels as saved (new ones with their keys).
export type LevelsResult = { ok: true; message: string; levels: Level[] } | { ok: false; message: string };

// Saves the whole list in its order (most senior first). A level someone
// is still on can't be removed; the database says who's in the way.
export async function saveLevels(drafts: LevelDraft[]): Promise<LevelsResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "settings")) return { ok: false, message: "Only owners and managers can change levels." };
  const problem = levelProblems(drafts);
  if (problem) return { ok: false, message: problem };
  const { error } = await supabase.rpc("save_staff_levels", {
    p_business_id: me.business_id,
    p_levels: drafts.map((d) => ({ key: d.key, name: d.name.trim(), color: d.color, symbol: d.symbol })),
  });
  if (error?.hint === "in_use") return { ok: false, message: `${error.message}.` };
  if (error?.code === "23505") return { ok: false, message: "Two levels have the same name." };
  if (error && ["22023", "42501", "P0002"].includes(error.code ?? "")) return { ok: false, message: `${error.message}.` };
  if (error) return { ok: false, message: "That didn't save. Try again." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved.", levels: await loadLevels(supabase, me.business_id) };
}
