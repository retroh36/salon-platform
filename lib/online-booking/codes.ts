// One-time codes: a client proves a phone number or email is theirs. Codes
// go to the outbox (shown at /dev/outbox until texts and emails are
// connected). A confirmed code gives the browser a session secret, valid
// for 30 minutes, that the booking is made with.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { newCode, newSecret, sha256 } from "./security";

type Admin = SupabaseClient<Database>;
export type Channel = "sms" | "email";

const CODE_MINUTES = 10;
const SESSION_MINUTES = 30;
const MAX_ATTEMPTS = 5;

export async function sendCode(admin: Admin, business: { id: string; name: string }, channel: Channel, destination: string): Promise<string> {
  const id = crypto.randomUUID();
  const code = newCode();
  const { error } = await admin.from("online_verifications").insert({
    id,
    business_id: business.id,
    channel,
    destination,
    code_hash: sha256(`${id}:${code}`),
    expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
  });
  if (error) throw error;
  const body = `${business.name}: your booking code is ${code}. It expires in ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this message.`;
  const { error: outboxError } = await admin.from("outbox_messages").insert({
    business_id: business.id,
    channel,
    to_address: destination,
    subject: channel === "email" ? `Your ${business.name} booking code` : null,
    body,
  });
  if (outboxError) throw outboxError;
  return id;
}

export type VerifyResult = { ok: true; session: string } | { ok: false; error: "wrong" | "expired" | "too_many" };

export async function verifyCode(admin: Admin, businessId: string, verificationId: string, code: string): Promise<VerifyResult> {
  const { data, error } = await admin
    .from("online_verifications")
    .select("id, code_hash, attempts, expires_at, verified_at")
    .eq("id", verificationId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.verified_at || new Date(data.expires_at) < new Date()) return { ok: false, error: "expired" };
  if (data.attempts >= MAX_ATTEMPTS) return { ok: false, error: "too_many" };

  if (sha256(`${data.id}:${code.trim()}`) !== data.code_hash) {
    await admin.from("online_verifications").update({ attempts: data.attempts + 1 }).eq("id", data.id);
    return { ok: false, error: data.attempts + 1 >= MAX_ATTEMPTS ? "too_many" : "wrong" };
  }
  const session = newSecret();
  const { error: updateError } = await admin
    .from("online_verifications")
    .update({ verified_at: new Date().toISOString(), session_hash: sha256(session) })
    .eq("id", data.id)
    .is("verified_at", null);
  if (updateError) throw updateError;
  return { ok: true, session };
}

// Who a session secret belongs to, if it's still valid.
export async function sessionContact(admin: Admin, businessId: string, session: string): Promise<{ channel: Channel; destination: string } | null> {
  if (!session) return null;
  const { data, error } = await admin
    .from("online_verifications")
    .select("channel, destination, verified_at")
    .eq("business_id", businessId)
    .eq("session_hash", sha256(session))
    .maybeSingle();
  if (error) throw error;
  if (!data?.verified_at || Date.now() - new Date(data.verified_at).getTime() > SESSION_MINUTES * 60_000) return null;
  return { channel: data.channel as Channel, destination: data.destination };
}
