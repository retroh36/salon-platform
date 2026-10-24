"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { parsePlanForm, type PlanForm } from "@/lib/memberships";
import { runMembershipBilling, type BillingSummary } from "@/lib/memberships-billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";

export type SaveResult = { ok: true; message: string; id: string } | { ok: false; message: string };

export async function savePlan(id: string | null, form: PlanForm): Promise<SaveResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers can set up memberships." };
  const parsed = parsePlanForm(form);
  if (!parsed.ok) return parsed;
  const { data, error } = await supabase.rpc("save_membership_plan", { p_business_id: me.business_id, p_plan_id: id && isUuid(id) ? id : (null as never), p_input: parsed.plan as never });
  if (error?.code === "23505") return { ok: false, message: "There's already a membership with that name." };
  if (error) return { ok: false, message: ["22023", "42501", "P0002"].includes(error.code ?? "") ? error.message : "That didn't save. Try again." };
  revalidatePath("/settings/memberships");
  return { ok: true, message: "Saved. Changes apply to new members; existing members keep the price and terms they joined on.", id: data };
}

// Renewals and retries due now, for this salon (the nightly job does the
// same for every salon).
export async function runRenewals(): Promise<{ ok: true; summary: BillingSummary } | { ok: false; message: string }> {
  const { staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers can run renewals." };
  const summary = await runMembershipBilling(createAdminClient(), { businessId: me.business_id });
  revalidatePath("/settings/memberships");
  revalidatePath("/dashboard");
  return { ok: true, summary };
}
