import { createAdminClient } from "@/lib/supabase/admin";
import { validStripeSignature } from "@/lib/webhooks";

// Stripe's Connect webhook: a salon's account changing (it can now take
// payments, or needs more details) or the salon disconnecting Maestra
// from its Stripe dashboard. Only requests signed with STRIPE_WEBHOOK_SECRET
// are read; anything else about a payment is in Stripe's own dashboard.
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Stripe isn't connected", { status: 503 });
  const body = await request.text();
  if (!validStripeSignature(secret, body, request.headers.get("stripe-signature"))) return new Response("Not allowed", { status: 403 });
  let event: { type?: string; account?: string; data?: { object?: { id?: string; charges_enabled?: boolean; details_submitted?: boolean } } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Not JSON", { status: 400 });
  }
  const admin = createAdminClient();
  if (event.type === "account.updated" && event.data?.object?.id) {
    const o = event.data.object;
    const { error } = await admin.rpc("stripe_account_updated", { p_account_id: o.id!, p_charges_enabled: !!o.charges_enabled, p_details_submitted: !!o.details_submitted });
    if (error) throw error;
  } else if (event.type === "account.application.deauthorized" && event.account) {
    const { data: b } = await admin.from("businesses").select("id").eq("stripe_account_id", event.account).maybeSingle();
    if (b) {
      const { error } = await admin.rpc("set_stripe_account", { p_business_id: b.id, p_account_id: null as never, p_charges_enabled: false, p_details_submitted: false });
      if (error) throw error;
    }
  }
  return new Response(null, { status: 204 });
}
