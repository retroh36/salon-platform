// Texts coming in from the text provider (Twilio's webhook shape): its
// signature, checked with our auth token (pure, unit-tested), and what we
// do with a keyword. The
// signature is base64 HMAC-SHA1 of the full URL followed by each posted
// field's name and value, sorted by name.

import { createHmac, timingSafeEqual } from "node:crypto";
import { KEYWORD_REPLIES, keywordOf } from "./consent.ts";

export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// "+1 (312) 555-0142" -> "3125550142" (US numbers; else null).
export function inboundDigits(from: string): string | null {
  const digits = from.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^\d{10}$/.test(ten) ? ten : null;
}

// A text from a client: STOP, START or HELP is recorded (sms_keyword, which
// logs the consent change) and answered with our fixed reply; anything
// else gets no reply (texts to clients come from staff, never Denise).
export async function handleInboundText(
  admin: { rpc: (fn: "sms_keyword", args: { p_phone_digits: string; p_body: string }) => PromiseLike<{ data: unknown; error: unknown }> },
  digits: string,
  body: string,
): Promise<string | null> {
  if (!keywordOf(body)) return null;
  const { data, error } = await admin.rpc("sms_keyword", { p_phone_digits: digits, p_body: body });
  if (error) throw error;
  return data === "stop" || data === "start" || data === "help" ? KEYWORD_REPLIES[data] : null;
}

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

// The reply, in the text provider's response format.
export const replyXml = (reply: string | null) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response>${reply ? `<Message>${escapeXml(reply)}</Message>` : ""}</Response>`;
