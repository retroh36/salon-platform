"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { runMembershipBilling } from "@/lib/memberships-billing";
import { currentProvider } from "@/lib/payments";
import { canTakePayments } from "@/lib/sales";
import { createAdminClient } from "@/lib/supabase/admin";

export type MembershipResult = { ok: true; message: string } | { ok: false; message: string };

const NOT_ALLOWED = "Only the front desk, managers and owners can change memberships.";

async function session(membershipId: string) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canTakePayments(me.role) || !isUuid(membershipId)) return null;
  // Their own login decides what they can see (RLS): another salon's
  // membership isn't there.
  const { data } = await supabase.from("client_memberships").select("id, client_id, business_id").eq("id", membershipId).maybeSingle();
  return data ? { supabase, me, membership: data } : null;
}

const done = (clientId: string, message: string): MembershipResult => {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { ok: true, message };
};

const failed = (error: { code?: string; message: string }): MembershipResult => ({
  ok: false,
  message: ["22023", "42501", "55000"].includes(error.code ?? "") ? error.message : "That didn't work. Try again.",
});

// A payment that's due now (a card updated while it was past due, or back
// from a pause) is charged straight away, through the same billing job.
async function billNow(membershipId: string) {
  const summary = await runMembershipBilling(createAdminClient(), { membershipId });
  return summary.renewed ? " The payment went through." : summary.failed ? " The payment didn't go through." : "";
}

export async function pauseMembership(membershipId: string, periods: number): Promise<MembershipResult> {
  const s = await session(membershipId);
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const { error } = await s.supabase.rpc("pause_membership", { p_membership_id: membershipId, p_periods: periods });
  if (error) return failed(error);
  return done(s.membership.client_id, "Paused from the end of this period.");
}

export async function resumeMembership(membershipId: string): Promise<MembershipResult> {
  const s = await session(membershipId);
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const { error } = await s.supabase.rpc("resume_membership", { p_membership_id: membershipId });
  if (error) return failed(error);
  return done(s.membership.client_id, `Back on.${await billNow(membershipId)}`);
}

export async function cancelMembership(membershipId: string, reason: string, now: boolean): Promise<MembershipResult> {
  const s = await session(membershipId);
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const { data: on, error } = await s.supabase.rpc("cancel_membership", { p_membership_id: membershipId, p_reason: reason, p_now: now });
  if (error) return failed(error);
  return done(s.membership.client_id, now ? "Ended now." : `Ends ${on}. No more payments after that.`);
}

export async function keepMembership(membershipId: string): Promise<MembershipResult> {
  const s = await session(membershipId);
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const { error } = await s.supabase.rpc("keep_membership", { p_membership_id: membershipId });
  if (error) return failed(error);
  return done(s.membership.client_id, "Kept. It renews as usual.");
}

// The card it renews on (in test mode, one of the provider's test cards).
export async function updateMembershipCard(membershipId: string, cardRef: string): Promise<MembershipResult> {
  const s = await session(membershipId);
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const provider = currentProvider();
  const card = provider.testCards.find((c) => c.ref === cardRef);
  if (!card) return { ok: false, message: "Choose a card." };
  const { error } = await s.supabase.rpc("update_membership_card", { p_membership_id: membershipId, p_provider: provider.id, p_ref: card.ref, p_label: card.label });
  if (error) return failed(error);
  return done(s.membership.client_id, `Card updated to ${card.label}.${await billNow(membershipId)}`);
}

// Try a failed payment again now.
export async function retryMembershipPayment(membershipId: string): Promise<MembershipResult> {
  const s = await session(membershipId);
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const { error } = await s.supabase.rpc("retry_membership_payment", { p_membership_id: membershipId });
  if (error) return failed(error);
  const result = await billNow(membershipId);
  return done(s.membership.client_id, result.trim() || "Tried again.");
}
