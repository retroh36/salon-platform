// The outbox sender (service role): every minute, and straight after a
// queued message is written (/api/cron/messages). Messages are queued only
// for salons that turned on "Go live" (Settings → Messages); this sends
// them through Twilio or Resend, and only when the go-live gate is open
// (lib/live.ts), so the demo and staging never send one, whatever's in the
// database or the keys. A number that replied STOP or an address that
// bounced is never sent to. Counts only, never addresses or text.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { siteUrl } from "@/lib/branding";
import { liveGate, resendKeys, twilioKeys } from "@/lib/live";
import { sendEmail, sendText, type SendOutcome } from "./providers";

type Env = Record<string, string | undefined>;

// Tries for one message before it's left as failed.
export const MAX_ATTEMPTS = 3;

export type DeliveryCounts = { sent: number; failed: number; suppressed: number; retrying: number; held: number; skipped?: string };

export async function deliverOutbox(admin: SupabaseClient<Database>, env: Env = process.env, fetchFn: typeof fetch = fetch, limit = 50): Promise<DeliveryCounts> {
  const counts: DeliveryCounts = { sent: 0, failed: 0, suppressed: 0, retrying: 0, held: 0 };
  const gate = liveGate(env);
  if (!gate.open) return { ...counts, skipped: gate.reason };
  const twilio = twilioKeys(env);
  const resend = resendKeys(env);

  const { data: messages, error } = await admin.rpc("claim_outbox_messages", { p_limit: limit });
  if (error) throw error;
  if (!messages?.length) return counts;

  const digitsOf = (to: string) => to.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const phones = messages.filter((m) => m.channel === "sms").map((m) => digitsOf(m.to_address));
  const emails = messages.filter((m) => m.channel === "email").map((m) => m.to_address.trim().toLowerCase());
  const [stopped, bounced] = await Promise.all([
    phones.length ? admin.from("sms_suppressions").select("phone_digits").in("phone_digits", phones) : { data: [] },
    emails.length ? admin.from("email_suppressions").select("email").in("email", emails) : { data: [] },
  ]);
  const stoppedSet = new Set((stopped.data ?? []).map((r) => r.phone_digits));
  const bouncedSet = new Set((bounced.data ?? []).map((r) => r.email));
  const statusCallback = `${siteUrl()}/api/messages/status`;

  for (const m of messages) {
    let outcome: SendOutcome | "suppressed";
    if (m.channel === "sms") {
      if (stoppedSet.has(digitsOf(m.to_address))) outcome = "suppressed";
      else if (!twilio) outcome = { ok: false, code: "not_connected", retry: false };
      else outcome = await sendText(twilio, { to: m.to_address, body: m.body, statusCallback }, fetchFn);
    } else {
      if (bouncedSet.has(m.to_address.trim().toLowerCase())) outcome = "suppressed";
      else if (!resend) outcome = { ok: false, code: "not_connected", retry: false };
      else outcome = await sendEmail(resend, { salon: m.salon, to: m.to_address, subject: m.subject ?? m.salon ?? "A message from the salon", text: m.body, html: m.html, idempotencyKey: `outbox-${m.id}` }, fetchFn);
    }
    const provider = m.channel === "sms" ? "twilio" : "resend";
    let status: "sent" | "queued" | "held" | "failed" | "suppressed";
    if (outcome === "suppressed") status = "suppressed";
    else if (outcome.ok) status = "sent";
    // That channel isn't connected: it stays in the outbox, as before.
    else if (outcome.code === "not_connected") status = "held";
    else status = outcome.retry && m.attempts < MAX_ATTEMPTS ? "queued" : "failed";
    const { error: recordError } = await admin.rpc("record_outbox_result", {
      p_id: m.id,
      p_status: status,
      p_provider: (outcome !== "suppressed" && outcome.ok ? provider : null) as never,
      p_provider_id: (outcome !== "suppressed" && outcome.ok ? outcome.id : null) as never,
      p_error: (outcome === "suppressed" ? "suppressed" : outcome.ok ? null : outcome.code) as never,
    });
    if (recordError) throw recordError;
    if (status === "sent") counts.sent++;
    else if (status === "queued") counts.retrying++;
    else if (status === "suppressed") counts.suppressed++;
    else if (status === "held") counts.held++;
    else counts.failed++;
  }
  return counts;
}
