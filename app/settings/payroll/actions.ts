"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { PAY_PERIOD_LABELS, type PayPeriodKind } from "@/lib/payroll";
import { isLocalDate } from "@/lib/scheduling/time";
import { can } from "@/lib/permissions";

export type SettingsResult = { ok: boolean; message: string };

export async function savePayrollSettings(input: { kind: string; anchor: string }): Promise<SettingsResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "payroll")) return { ok: false, message: "Only owners and managers can change payroll settings." };
  if (!(input.kind in PAY_PERIOD_LABELS)) return { ok: false, message: "Choose how often you run payroll." };
  const kind = input.kind as PayPeriodKind;
  const needsAnchor = kind === "weekly" || kind === "biweekly";
  if (needsAnchor && !isLocalDate(input.anchor)) return { ok: false, message: "Pick the first day of a pay period." };
  const { error } = await supabase.rpc("set_payroll_settings", { p_business_id: me.business_id, p_pay_period: kind, p_anchor: needsAnchor ? input.anchor : (null as never) });
  if (error?.code === "42501") return { ok: false, message: "Only owners and managers can change payroll settings." };
  if (error) throw error;
  revalidatePath("/settings/payroll");
  revalidatePath("/payroll");
  return { ok: true, message: "Saved." };
}

// Which hours pay people paid by the hour: owners only, logged by the
// database (set_payroll_hours).
export async function savePayrollHours(basis: string): Promise<SettingsResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || me.role !== "owner") return { ok: false, message: "Only owners choose which hours pay." };
  const { error } = await supabase.rpc("set_payroll_hours", { p_business_id: me.business_id, p_basis: basis });
  if (error?.hint === "no_clock") return { ok: false, message: "Turn on the time clock first, on Settings → Shared devices." };
  if (error?.hint === "basis") return { ok: false, message: "Choose scheduled or clocked hours." };
  if (error?.code === "42501") return { ok: false, message: "Only owners choose which hours pay." };
  if (error) throw error;
  revalidatePath("/settings/payroll");
  revalidatePath("/payroll");
  return { ok: true, message: basis === "clocked" ? "Clocked hours pay from now on, for every period you open." : "Scheduled hours pay from now on, for every period you open." };
}
