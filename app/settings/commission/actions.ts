"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { parsePlanInput, rulesJson, type PlanInput } from "@/lib/commission";
import { can } from "@/lib/permissions";

export type PlanResult = { ok: boolean; message: string };

const NOT_ALLOWED = "Only people who run payroll can change commission plans.";
const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

function done(message: string): PlanResult {
  revalidatePath("/settings/commission");
  revalidatePath("/payroll");
  revalidatePath("/my-day");
  return { ok: true, message };
}

export async function saveCommissionPlan(planId: string | null, input: PlanInput): Promise<PlanResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "payroll")) return { ok: false, message: NOT_ALLOWED };
  if (planId !== null && !isUuid(planId)) return { ok: false, message: "That plan isn't here any more." };
  const parsed = parsePlanInput(input);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const { error } = await supabase.rpc("save_commission_plan", {
    p_business_id: me.business_id,
    p_plan_id: planId as string,
    p_name: parsed.name,
    p_rules: rulesJson(parsed.rules),
    p_default: parsed.isDefault,
  });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "22023" || error?.code === "P0002") return { ok: false, message: `${error.message}.` };
  if (error) throw error;
  return done(planId ? "Saved. Sales from now on use the new rates; past pay stays as it was." : "Plan added.");
}

export async function archiveCommissionPlan(planId: string): Promise<PlanResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "payroll") || !isUuid(planId)) return { ok: false, message: NOT_ALLOWED };
  const { error } = await supabase.rpc("archive_commission_plan", { p_plan_id: planId });
  if (error?.code === "55000") return { ok: false, message: "Move everyone off this plan first." };
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error) throw error;
  return done("Plan removed. Past pay on it stays as it was.");
}

// Someone's plan, or their own rates (planId null).
export async function setStaffPlan(staffId: string, planId: string | null): Promise<PlanResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "payroll") || !isUuid(staffId) || (planId !== null && !isUuid(planId))) return { ok: false, message: NOT_ALLOWED };
  const { error } = await supabase.rpc("set_staff_commission_plan", { p_staff_id: staffId, p_plan_id: planId as string });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "22023") return { ok: false, message: `${error.message}.` };
  if (error) throw error;
  revalidatePath("/schedule");
  return done("Saved. Their sales from now on are paid on it.");
}
