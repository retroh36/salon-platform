import { resendDelivery } from "@/lib/messaging/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import { validSvixSignature } from "@/lib/webhooks";

// Resend's webhook for the emails we sent: delivered, bounced, marked as
// spam or failed. A bounce or a spam complaint stops email to that address
// (email_suppressions), and a complaint turns off that client's offers by
// email. Only requests signed with RESEND_WEBHOOK_SECRET are read. Never
// logs the address.
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response("Email isn't connected", { status: 503 });
  const body = await request.text();
  const headers = { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") };
  if (!validSvixSignature(secret, body, headers)) return new Response("Not allowed", { status: 403 });
  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Not JSON", { status: 400 });
  }
  const status = resendDelivery(event.type);
  if (status && event.data?.email_id) {
    const { error } = await createAdminClient().rpc("outbox_delivery_update", {
      p_provider: "resend",
      p_provider_id: event.data.email_id,
      p_status: status,
      p_error: (status === "bounced" ? "bounced" : status === "complained" ? "complained" : null) as never,
    });
    if (error) throw error;
  }
  return new Response(null, { status: 204 });
}
