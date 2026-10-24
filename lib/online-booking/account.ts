// Client accounts on the booking site (migration …_client_accounts.sql):
// separate from staff logins. A client proves an email or phone is theirs
// (a one-time code or link, ./codes.ts), which matches or creates their
// client record; the browser then keeps a session token in a cookie scoped
// to this salon's booking pages. Everything here runs with the service role
// and is filtered by the session's client and salon, so a client only ever
// sees their own data, at this salon.

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { newSecret, sha256 } from "./security";

type Admin = SupabaseClient<Database>;

export const ACCOUNT_COOKIE = "maestra_client";
export const ACCOUNT_DAYS = 30;

export type Account = { accountId: string; clientId: string; businessId: string; firstName: string };

// The cookie lives under this salon's booking pages only, so another
// salon's site never receives it.
export const accountCookiePath = (slug: string) => `/book/${slug}`;

// Starts a session for the client (after a verified code or link).
export async function startAccountSession(admin: Admin, businessId: string, clientId: string, channel: "sms" | "email", slug: string, ipHash: string | null): Promise<void> {
  const { data: account, error } = await admin
    .from("client_accounts")
    .upsert({ business_id: businessId, client_id: clientId, verified_channel: channel, last_sign_in_at: new Date().toISOString() }, { onConflict: "business_id,client_id" })
    .select("id")
    .single();
  if (error) throw error;
  const token = newSecret();
  const expires = new Date(Date.now() + ACCOUNT_DAYS * 86_400_000);
  const { error: sessionError } = await admin
    .from("client_sessions")
    .insert({ business_id: businessId, account_id: account.id, token_hash: sha256(token), expires_at: expires.toISOString(), ip_hash: ipHash });
  if (sessionError) throw sessionError;
  (await cookies()).set(ACCOUNT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: accountCookiePath(slug),
    expires,
  });
}

// The signed-in client at this salon, if any.
export async function currentAccount(admin: Admin, businessId: string): Promise<Account | null> {
  const token = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  return token ? accountForToken(admin, businessId, token) : null;
}

export async function accountForToken(admin: Admin, businessId: string, token: string): Promise<Account | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const { data, error } = await admin
    .from("client_sessions")
    .select("expires_at, revoked_at, account:client_accounts!inner(id, business_id, client_id, client:clients!inner(first_name))")
    .eq("token_hash", sha256(token))
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at || new Date(data.expires_at) < new Date()) return null;
  const a = data.account;
  if (a.business_id !== businessId) return null;
  return { accountId: a.id, clientId: a.client_id, businessId, firstName: a.client.first_name };
}

export async function endAccountSession(admin: Admin, businessId: string, slug: string): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ACCOUNT_COOKIE)?.value;
  if (token) await admin.from("client_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", sha256(token)).eq("business_id", businessId);
  jar.set(ACCOUNT_COOKIE, "", { path: accountCookiePath(slug), maxAge: 0 });
}

// Booking while signed in: the browser sends this instead of a code
// session, and the booking is for the account's own client.
export const ACCOUNT_SESSION = "account";

// How to reach them: email if they have one, else their phone.
export async function accountContact(admin: Admin, account: Account): Promise<{ channel: "sms" | "email"; destination: string } | null> {
  const { data, error } = await admin.from("clients").select("email, phone_digits").eq("id", account.clientId).eq("business_id", account.businessId).single();
  if (error) throw error;
  if (data.email) return { channel: "email", destination: data.email.toLowerCase() };
  if (data.phone_digits) return { channel: "sms", destination: data.phone_digits };
  return null;
}
