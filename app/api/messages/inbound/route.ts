import { siteUrl } from "@/lib/branding";
import { handleInboundText, inboundDigits, replyXml, validSignature } from "@/lib/messaging/inbound";
import { createAdminClient } from "@/lib/supabase/admin";

// Texts clients send to Maestra's numbers (the text provider's webhook).
// Only requests signed with TWILIO_AUTH_TOKEN are read; until texts are
// connected (no token) it's off. STOP, START and HELP are honored at once.
// Never logs the number or the text.
export async function POST(request: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return new Response("Texts aren't connected", { status: 503 });
  const form = await request.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  if (!validSignature(token, `${siteUrl()}/api/messages/inbound`, params, request.headers.get("x-twilio-signature"))) {
    return new Response("Not allowed", { status: 403 });
  }
  const digits = inboundDigits(params.From ?? "");
  const reply = digits ? await handleInboundText(createAdminClient(), digits, params.Body ?? "") : null;
  return new Response(replyXml(reply), { headers: { "content-type": "text/xml" } });
}
