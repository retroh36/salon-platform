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
