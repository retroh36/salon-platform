"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { siteUrl } from "@/lib/branding";
import { stripeKeys, stripeUsable } from "@/lib/live";
import { PAYMENT_COLUMNS, paymentsStatus } from "@/lib/payments";
import { syncStripeAccount } from "@/lib/payments/connect";
import { createAccount, onboardingLink } from "@/lib/payments/stripe";
import { can } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export type PaymentsResult = { ok: true; message: string; url?: string } | { ok: false; message: string };

const NOT_OWNER: PaymentsResult = { ok: false, message: "Only owners connect payments or go live." };

// Connect with Stripe (owners): the salon's own Standard account, made once,
// then Stripe's onboarding, which comes back to Settings → Payments.
export async function connectStripe(): Promise<PaymentsResult> {
  const { staff: me } = await getCurrentStaff();
  if (!me || !can(me, "billing")) return NOT_OWNER;
  const keys = stripeKeys();
  const usable = stripeUsable(keys);
  if (!keys || !usable.open) return { ok: false, message: usable.open ? "Stripe isn't set up on Maestra yet." : usable.reason };
  const admin = createAdminClient();
  const { data: b } = await admin.from("businesses").select("stripe_account_id").eq("id", me.business_id).single();
  let account = b?.stripe_account_id ?? null;
  if (!account) {
    const made = await createAccount(keys, me.business_id);
    if (!made.ok) return { ok: false, message: "Stripe didn't create the account. Try again in a minute." };
    account = made.data.id;
    const { error } = await admin.rpc("set_stripe_account", { p_business_id: me.business_id, p_account_id: account, p_charges_enabled: made.data.chargesEnabled, p_details_submitted: made.data.detailsSubmitted, p_staff_id: me.id });
    if (error) return { ok: false, message: "That didn't save. Try again." };
  }
  const link = await onboardingLink(keys, account, `${siteUrl()}/settings/payments?stripe=back`, `${siteUrl()}/settings/payments?stripe=again`);
  if (!link.ok) return { ok: false, message: "Stripe didn't open its setup. Try again in a minute." };
  return { ok: true, message: "Opening Stripe…", url: link.data };
}

// What Stripe says about the account now (back from onboarding, or Check
// again).
export async function refreshStripe(): Promise<PaymentsResult> {
  const { staff: me } = await getCurrentStaff();
  if (!me || !can(me, "settings")) return { ok: false, message: "Only those who can change settings can check this." };
  const synced = await syncStripeAccount(me.business_id);
  revalidatePath("/settings/payments");
  return synced ? { ok: true, message: synced } : { ok: false, message: "Stripe couldn't be reached. Try again in a minute." };
}

// Disconnect (owners): Maestra stops using the account and live payments
// go off. Cards already saved stay with Stripe, on the salon's account.
export async function disconnectStripe(): Promise<PaymentsResult> {
  const { staff: me } = await getCurrentStaff();
  if (!me || !can(me, "billing")) return NOT_OWNER;
  const { error } = await createAdminClient().rpc("set_stripe_account", { p_business_id: me.business_id, p_account_id: null as never, p_charges_enabled: false, p_details_submitted: false, p_staff_id: me.id });
  if (error) return { ok: false, message: "That didn't save. Try again." };
  revalidatePath("/settings/payments");
  return { ok: true, message: "Disconnected. Only test cards work now." };
}

// Go live with real card payments (owners): only on the production site,
// with Stripe's live keys and the salon's account ready.
export async function setPaymentsLive(on: boolean): Promise<PaymentsResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "billing")) return NOT_OWNER;
  if (on) {
    const { data: b } = await supabase.from("businesses").select(PAYMENT_COLUMNS).eq("id", me.business_id).single();
    const why = b ? paymentsStatus(b).cantGoLive : "Sign in again.";
    if (why) return { ok: false, message: why };
  }
  const { error } = await supabase.rpc("set_go_live", { p_kind: "payments", p_on: on });
  if (error) return { ok: false, message: error.code === "42501" ? NOT_OWNER.message : "That didn't save. Try again." };
  revalidatePath("/settings/payments");
  return { ok: true, message: on ? "You're live: clients' cards are charged for real." : "Turned off: only test cards work again." };
}
