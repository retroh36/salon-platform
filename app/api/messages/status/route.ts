import { siteUrl } from "@/lib/branding";
import { validSignature } from "@/lib/messaging/inbound";
import { twilioDelivery } from "@/lib/messaging/providers";
import { createAdminClient } from "@/lib/supabase/admin";

// Twilio's status callback for each text we sent: delivered, or failed
// with its error code (21610 means the number replied STOP, recorded as a
// STOP). Only requests signed with TWILIO_AUTH_TOKEN are read. Never logs
// the number.
export async function POST(request: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return new Response("Texts aren't connected", { status: 503 });
  const form = await request.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  if (!validSignature(token, `${siteUrl()}/api/messages/status`, params, request.headers.get("x-twilio-signature"))) {
    return new Response("Not allowed", { status: 403 });
  }
  const status = twilioDelivery(params.MessageStatus ?? null);
  if (status && params.MessageSid) {
    const { error } = await createAdminClient().rpc("outbox_delivery_update", {
      p_provider: "twilio",
      p_provider_id: params.MessageSid,
      p_status: status,
      p_error: (params.ErrorCode || null) as never,
    });
    if (error) throw error;
  }
  return new Response(null, { status: 204 });
}
