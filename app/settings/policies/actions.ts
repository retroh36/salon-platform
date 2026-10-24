"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { parseFeeRule, parsePolicyForm, type PolicyErrors } from "@/lib/policy";
import { runPolicyCharges } from "@/lib/policy-billing";
import { createAdminClient } from "@/lib/supabase/admin";

export type PolicyResult = { ok: true; message: string } | { ok: false; message: string; errors?: PolicyErrors };

const ONLY_OWNERS = "Only owners can change the policy.";

export async function savePolicy(form: FormData): Promise<PolicyResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || me.role !== "owner") return { ok: false, message: ONLY_OWNERS };
  const parsed = parsePolicyForm(form);
  if (!parsed.ok) return { ok: false, message: "Check the highlighted fields.", errors: parsed.errors };
  const p = parsed.value;
  const { error } = await supabase.rpc("save_policy_settings", {
    p_business_id: me.business_id,
    p: {
      card_required: p.cardRequired,
      card_service_ids: [...p.cardServiceIds],
      card_staff_ids: [...p.cardStaffIds],
      cancel_window_hours: p.windowHours,
      late_cancel_fee_kind: p.lateCancel.kind,
      late_cancel_fee_amount: p.lateCancel.amount,
      no_show_fee_kind: p.noShow.kind,
      no_show_fee_amount: p.noShow.amount,
      long_hold_days: p.longHoldDays,
      repeat_count: p.repeatCount,
      repeat_months: p.repeatMonths,
      repeat_action: p.repeatAction,
      repeat_deposit_percent: p.repeatDepositPercent,
      waive_roles: form.getAll("waive_roles").map(String),
    },
  });
  if (error?.code === "42501") return { ok: false, message: ONLY_OWNERS };
  if (error) throw error;
  revalidatePath("/settings/policies");
  return { ok: true, message: "Saved. New bookings show the updated policy." };
}

export type StaffPolicyInput = { staffId: string; windowHours: string; lateKind: string; lateAmount: string; noShowKind: string; noShowAmount: string };

// A stylist's own, stricter rules ("" for each: the salon's).
export async function saveStaffPolicy(input: StaffPolicyInput): Promise<PolicyResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || me.role !== "owner") return { ok: false, message: ONLY_OWNERS };
  const window = input.windowHours.trim() ? Number(input.windowHours) : null;
  if (window !== null && !(Number.isInteger(window) && window >= 1 && window <= 168)) return { ok: false, message: "Enter a window of 1 to 168 hours, or leave it empty." };
  const late = input.lateKind ? parseFeeRule(input.lateKind, input.lateAmount) : null;
  if (typeof late === "string") return { ok: false, message: `Late cancellation: ${late}` };
  const noShow = input.noShowKind ? parseFeeRule(input.noShowKind, input.noShowAmount) : null;
  if (typeof noShow === "string") return { ok: false, message: `No-show: ${noShow}` };
  const { error } = await supabase.rpc("save_staff_policy", {
    p_staff_id: input.staffId,
    p: {
      cancel_window_hours: window,
      late_cancel_fee_kind: late?.kind ?? null,
      late_cancel_fee_amount: late?.amount ?? null,
      no_show_fee_kind: noShow?.kind ?? null,
      no_show_fee_amount: noShow?.amount ?? null,
    },
  });
  if (error?.code === "42501") return { ok: false, message: ONLY_OWNERS };
  if (error) throw error;
  revalidatePath("/settings/policies");
  return { ok: true, message: window === null && !late && !noShow ? "Back to the salon's rules." : "Saved." };
}

// Charges fees whose grace is over now, rather than at the next run.
export async function chargeDueFeesNow(): Promise<{ ok: boolean; message: string }> {
  const { staff: me } = await getCurrentStaff();
  if (!me || me.role !== "owner") return { ok: false, message: ONLY_OWNERS };
  const s = await runPolicyCharges(createAdminClient(), { businessId: me.business_id });
  revalidatePath("/policy");
  const parts = [`${s.charged} charged`, s.failed && `${s.failed} didn't go through`, s.refunded && `${s.refunded} refunded`].filter(Boolean);
  return { ok: true, message: s.charged || s.failed || s.refunded ? `${parts.join(", ")}.` : "Nothing was due." };
}
