"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { payProblem, roleProblem, type RoleDraft, type RolePay } from "@/lib/working-roles";

export type RoleResult = { ok: true; message: string; id: string } | { ok: false; message: string };

// Saves a role (id null adds one): its name, whether it's online and its
// services; with `pay` (those who run payroll), how it pays.
export async function saveRole(id: string | null, draft: RoleDraft, position: number, pay: RolePay | null, others: { name: string }[]): Promise<RoleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "settings")) return { ok: false, message: "Only owners and managers can change working roles." };
  const problem = roleProblem(draft, others) ?? (pay ? payProblem(pay) : null);
  if (problem) return { ok: false, message: problem };
  const { data: saved, error } = await supabase.rpc("save_working_role", {
    p_business_id: me.business_id,
    p_role_id: id ?? null!,
    p_name: draft.name.trim(),
    p_online: draft.online,
    p_service_ids: draft.serviceIds,
    p_position: position,
  });
  if (error?.code === "23505") return { ok: false, message: `There's already a role called ${draft.name.trim()}.` };
  if (error) return { ok: false, message: "That didn't save. Try again." };
  if (pay && can(me, "payroll")) {
    const { error: payError } = await supabase.rpc("save_working_role_pay", {
      p_role_id: saved,
      p_method: pay.method,
      p_hourly_rate_cents: pay.method === "hourly" ? pay.hourlyRateCents! : null!,
      p_commission_pct: pay.method === "commission" ? pay.commissionPct! : null!,
    });
    if (payError) return { ok: false, message: "The role saved, but its pay didn't. Try again." };
  }
  revalidatePath("/settings/roles");
  return { ok: true, message: "Saved.", id: saved };
}

// Takes a role out of use; shifts already given it keep it as history.
export async function archiveRole(id: string, draft: RoleDraft): Promise<RoleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "settings")) return { ok: false, message: "Only owners and managers can change working roles." };
  const { error } = await supabase.rpc("save_working_role", {
    p_business_id: me.business_id,
    p_role_id: id,
    p_name: draft.name.trim(),
    p_online: draft.online,
    p_service_ids: draft.serviceIds,
    p_archive: true,
  });
  if (error) return { ok: false, message: "That didn't work. Try again." };
  revalidatePath("/settings/roles");
  return { ok: true, message: "Removed.", id };
}
