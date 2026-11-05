// The real senders behind the outbox: texts through Twilio, email through
// Resend, each one HTTPS request (no SDKs). Only the outbox sender calls
// these (lib/messaging/deliver.ts), and only once the go-live gate is open.
// `fetch` is passed in so tests never reach either service. Results carry
// a short code, never the message or the address.

import type { ResendKeys, TwilioKeys } from "../live.ts";

type Fetch = typeof fetch;

// What came of one send: its id at the provider, or a code, and whether
// it's worth trying again (the provider was busy or unreachable).
export type SendOutcome = { ok: true; id: string } | { ok: false; code: string; retry: boolean };

// A US number as Twilio wants it ("+13125550142"); null if it isn't one.
export function e164(address: string): string | null {
  const digits = address.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9]\d{9}$/.test(ten) ? `+1${ten}` : null;
}

const retryable = (status: number) => status === 429 || status >= 500;

export async function sendText(keys: TwilioKeys, input: { to: string; body: string; statusCallback: string | null }, fetchFn: Fetch = fetch): Promise<SendOutcome> {
  const to = e164(input.to);
  if (!to) return { ok: false, code: "bad_number", retry: false };
  const form = new URLSearchParams({ To: to, Body: input.body });
  if ("messagingServiceSid" in keys.from) form.set("MessagingServiceSid", keys.from.messagingServiceSid);
  else form.set("From", keys.from.number);
  if (input.statusCallback) form.set("StatusCallback", input.statusCallback);
  let res: Response;
  try {
    res = await fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(keys.accountSid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${keys.accountSid}:${keys.authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, code: "unreachable", retry: true };
  }
  const json = (await res.json().catch(() => null)) as { sid?: string; code?: number } | null;
  if (res.ok && json?.sid) return { ok: true, id: json.sid };
  return { ok: false, code: json?.code ? String(json.code) : `http_${res.status}`, retry: retryable(res.status) };
}

// "Maple & Ash" <hello@mail.example.com>, with nothing in the name that
// could break the header.
export function fromHeader(salon: string | null, address: string): string {
  const name = (salon ?? "").replace(/["<>\\\r\n]/g, "").trim().slice(0, 80);
  return name ? `"${name}" <${address}>` : address;
}

export async function sendEmail(
  keys: ResendKeys,
  input: { salon: string | null; to: string; subject: string; text: string; html: string | null; idempotencyKey: string; replyTo?: string | null },
  fetchFn: Fetch = fetch,
): Promise<SendOutcome> {
  const to = input.to.trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) return { ok: false, code: "bad_address", retry: false };
  const payload: Record<string, unknown> = { from: fromHeader(input.salon, keys.fromAddress), to: [to], subject: input.subject, text: input.text };
  if (input.html) payload.html = input.html;
  if (input.replyTo) payload.reply_to = input.replyTo;
  let res: Response;
  try {
    res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${keys.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, code: "unreachable", retry: true };
  }
  const json = (await res.json().catch(() => null)) as { id?: string; name?: string } | null;
  if (res.ok && json?.id) return { ok: true, id: json.id };
  return { ok: false, code: (json?.name ?? `http_${res.status}`).slice(0, 60), retry: retryable(res.status) };
}

// Twilio's status callback: its MessageStatus as ours (null while it's
// still on its way).
export function twilioDelivery(status: string | null): "delivered" | "failed" | null {
  if (status === "delivered") return "delivered";
  if (status === "undelivered" || status === "failed") return "failed";
  return null;
}

// Resend's webhook event type as ours.
export function resendDelivery(type: string | undefined): "delivered" | "bounced" | "complained" | "failed" | null {
  switch (type) {
    case "email.delivered":
      return "delivered";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    case "email.failed":
      return "failed";
    default:
      return null;
  }
}
