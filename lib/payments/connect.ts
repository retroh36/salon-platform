import { stripeKeys, stripeUsable } from "@/lib/live";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountStatus } from "./stripe";

// What Stripe says about a salon's connected account, saved on the salon
// (back from Stripe's setup, or Check again). Never a server action: the
// caller has already checked who's asking. Returns words for the page, or
// null when Stripe isn't set up or couldn't be reached.
export async function syncStripeAccount(businessId: string): Promise<string | null> {
  const keys = stripeKeys();
  if (!keys || !stripeUsable(keys).open) return null;
  const admin = createAdminClient();
  const { data: b } = await admin.from("businesses").select("stripe_account_id").eq("id", businessId).single();
  if (!b?.stripe_account_id) return null;
  const status = await accountStatus(keys, b.stripe_account_id);
  if (!status.ok) return null;
  await admin.rpc("set_stripe_account", { p_business_id: businessId, p_account_id: b.stripe_account_id, p_charges_enabled: status.data.chargesEnabled, p_details_submitted: status.data.detailsSubmitted });
  return status.data.chargesEnabled ? "Your Stripe account is ready to take payments." : "Stripe still needs a few details. Tap Finish setting up Stripe.";
}
