"use server";

import { revalidatePath } from "next/cache";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { familyProblem } from "@/lib/families";
import { isUuid } from "@/lib/ids";

export type FamilyResult = { ok: true; message: string } | { ok: false; message: string };

const NOT_ALLOWED = "Only owners, managers and front desk can change families.";

// Creates or changes a family: its name, exactly these members and who
// usually pays (save_family checks it all).
export async function saveFamily(input: { familyId: string | null; name: string; clientIds: string[]; payerId: string | null }): Promise<FamilyResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  const ids = input.clientIds.filter(isUuid);
  if ((input.familyId && !isUuid(input.familyId)) || (input.payerId && !isUuid(input.payerId))) return { ok: false, message: "That family no longer exists." };
  const { error } = await supabase.rpc("save_family", {
    p_business_id: me.business_id,
    p_family_id: input.familyId as string,
    p_name: input.name.slice(0, 80),
    p_client_ids: ids,
    p_payer_client_id: input.payerId as string,
  });
  if (error) return { ok: false, message: familyProblem(error) };
  for (const id of ids) revalidatePath(`/clients/${id}`);
  return { ok: true, message: "Family saved." };
}

// Unlinks everyone; each keeps their own profile.
export async function deleteFamily(familyId: string, clientIds: string[]): Promise<FamilyResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(familyId)) return { ok: false, message: "That family no longer exists." };
  const { error } = await supabase.rpc("delete_family", { p_family_id: familyId });
  if (error) return { ok: false, message: familyProblem(error) };
  for (const id of clientIds.filter(isUuid)) revalidatePath(`/clients/${id}`);
  return { ok: true, message: "Family removed. Everyone keeps their own profile." };
}
