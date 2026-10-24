"use server";

// A client's own account on the booking site (lib/online-booking/account.ts):
// sign in with a code or link (no passwords), then manage their own visits,
// card and message preferences. Separate from staff logins; everything is
// checked here against the session's client at this salon.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { siteUrl } from "@/lib/branding";
import { accountContact, currentAccount, endAccountSession, startAccountSession, type Account } from "@/lib/online-booking/account";
import { afterVerified, PENDING_COOKIE } from "@/lib/online-booking/account-signin";
import { ownsVisit } from "@/lib/online-booking/account-data";
import { sendCode, sessionContact, verifyCode, type Channel } from "@/lib/online-booking/codes";
import { formatPhone, normalEmail, phoneDigits } from "@/lib/online-booking/contact";
import { hashKey, newSecret, requestInfo, sha256, withinLimits } from "@/lib/online-booking/security";
import { loadSite, type BookingSite } from "@/lib/online-booking/site";
import { createAdminClient } from "@/lib/supabase/admin";

const HOUR = 3600;

type Admin = ReturnType<typeof createAdminClient>;

async function openSite(slug: string): Promise<BookingSite | null> {
  const found = await loadSite(createAdminClient(), slug);
  return found.status === "open" ? found.site : null;
}

const signInLink = (slug: string) => (id: string, secret: string) => `${siteUrl()}/book/${slug}/account/link?v=${id}&t=${secret}`;

export type SignInResult = { ok: true; verificationId: string; sentTo: string } | { ok: false; message: string };

// Sends a code and a sign-in link. The same answer whether or not the
// salon knows them, so it can't be used to look people up.
export async function requestSignIn(slug: string, channel: Channel, value: string, honeypot: string): Promise<SignInResult> {
  const site = await openSite(slug);
  if (!site) return { ok: false, message: "Accounts aren't available right now." };
  const destination = channel === "sms" ? phoneDigits(value) : normalEmail(value);
  if (!destination) return { ok: false, message: channel === "sms" ? "Enter a 10-digit mobile number." : "Enter an email address like name@example.com." };
  const admin = createAdminClient();
  const { ipHash } = await requestInfo();
  const allowed = await withinLimits(admin, [
    { key: `signin:ip:${ipHash}`, limit: 10, windowSeconds: HOUR },
    { key: `signin:to:${hashKey(destination)}`, limit: 5, windowSeconds: HOUR },
  ]);
  if (!allowed) return { ok: false, message: "Too many sign-in tries. Please wait a while, or call the salon." };
  const sentTo = channel === "sms" ? formatPhone(destination) : destination;
  if (honeypot) return { ok: true, verificationId: crypto.randomUUID(), sentTo };
  const verificationId = await sendCode(admin, site.business, channel, destination, signInLink(site.business.slug));
  return { ok: true, verificationId, sentTo };
}

export type ConfirmResult = { ok: true; needsName: boolean } | { ok: false; message: string };

export async function confirmSignIn(slug: string, verificationId: string, code: string): Promise<ConfirmResult> {
  const site = await openSite(slug);
  if (!site) return { ok: false, message: "Accounts aren't available right now." };
  if (!/^[0-9a-f-]{36}$/.test(verificationId) || !/^\d{6}$/.test(code.trim())) return { ok: false, message: "Enter the 6-digit code." };
  const admin = createAdminClient();
  const { ipHash } = await requestInfo();
  if (!(await withinLimits(admin, [{ key: `signin:confirm:${ipHash}`, limit: 20, windowSeconds: HOUR }]))) {
    return { ok: false, message: "Too many tries. Please wait a while, or call the salon." };
  }
  const result = await verifyCode(admin, site.business.id, verificationId, code);
  if (!result.ok) {
    return {
      ok: false,
      message: { wrong: "That code isn't right. Check it and try again.", expired: "That code has expired. Ask for a new one.", too_many: "Too many tries. Ask for a new code." }[result.error],
    };
  }
  return (await afterVerified(admin, site, result.session, ipHash)) ? { ok: true, needsName: false } : { ok: true, needsName: true };
}

export type CreateResult = { ok: true } | { ok: false; message: string };

// New to the salon: their name and the other contact detail, then the account.
export async function createAccount(slug: string, input: { firstName: string; lastName: string; other: string }): Promise<CreateResult> {
  const site = await openSite(slug);
  if (!site) return { ok: false, message: "Accounts aren't available right now." };
  if (!site.settings.allowNewClients) return { ok: false, message: `${site.business.name} isn't taking new clients online. Please call the salon.` };
  const admin = createAdminClient();
  const jar = await cookies();
  const session = jar.get(PENDING_COOKIE)?.value ?? "";
  const contact = await sessionContact(admin, site.business.id, session);
  if (!contact) return { ok: false, message: "Your code has expired. Please sign in again." };
  const first = input.firstName.trim();
  const last = input.lastName.trim();
  const phone = contact.channel === "sms" ? contact.destination : phoneDigits(input.other);
  const email = contact.channel === "email" ? contact.destination : normalEmail(input.other);
  if (!first || first.length > 60 || last.length > 60 || !phone || !email) {
    return { ok: false, message: `Enter your first name and ${contact.channel === "sms" ? "an email address" : "a 10-digit phone number"}.` };
  }
  const { data: clientId, error } = await admin.rpc("find_online_client", {
    p_business_id: site.business.id,
    p_phone_digits: phone,
    p_email: email,
    p_first_name: first,
    p_last_name: last,
    p_phone: formatPhone(phone),
  });
  if (error) throw error;
  const { ipHash } = await requestInfo();
  await startAccountSession(admin, site.business.id, clientId as string, contact.channel, site.business.slug, ipHash);
  jar.set(PENDING_COOKIE, "", { path: `/book/${site.business.slug}`, maxAge: 0 });
  return { ok: true };
}

async function signedIn(slug: string): Promise<{ admin: Admin; site: BookingSite; account: Account } | null> {
  const site = await openSite(slug);
  if (!site) return null;
  const admin = createAdminClient();
  const account = await currentAccount(admin, site.business.id);
  return account ? { admin, site, account } : null;
}

export async function signOut(slug: string): Promise<void> {
  const site = await openSite(slug);
  if (site) await endAccountSession(createAdminClient(), site.business.id, slug);
  redirect(`/book/${slug}/account`);
}

// Change or cancel a visit: their own visit's page, where the policy and
// any fee are shown before anything changes. A fresh link for it (the
// one in their confirmation stops working).
export async function openVisit(slug: string, appointmentId: string): Promise<{ ok: false; message: string } | never> {
  const s = await signedIn(slug);
  if (!s || !/^[0-9a-f-]{36}$/.test(appointmentId) || !(await ownsVisit(s.admin, s.account, appointmentId))) return { ok: false, message: "Please sign in again." };
  const token = newSecret();
  const { error } = await s.admin
    .from("appointments")
    .update({ manage_token_hash: sha256(token) })
    .eq("id", appointmentId)
    .eq("client_id", s.account.clientId)
    .eq("business_id", s.site.business.id);
  if (error) throw error;
  redirect(`/book/${slug}/manage/${token}`);
}

export type AccountResult = { ok: true; message: string } | { ok: false; message: string };

export async function removeCard(slug: string): Promise<AccountResult> {
  const s = await signedIn(slug);
  if (!s) return { ok: false, message: "Please sign in again." };
  const { error } = await s.admin.rpc("remove_own_card", { p_business_id: s.site.business.id, p_client_id: s.account.clientId });
  if (error) throw error;
  return { ok: true, message: "Card removed." };
}

// Adds or replaces their card: the salon's secure card page, where they
// read the policy and agree before the card is saved with the provider.
export async function addCard(slug: string): Promise<{ ok: false; message: string } | never> {
  const s = await signedIn(slug);
  if (!s) return { ok: false, message: "Please sign in again." };
  const contact = await accountContact(s.admin, s.account);
  if (!contact) return { ok: false, message: "Add an email or phone number with the salon first." };
  const token = newSecret();
  await s.admin.from("card_requests").update({ status: "canceled" }).eq("client_id", s.account.clientId).is("appointment_id", null).eq("status", "open");
  const { error } = await s.admin.from("card_requests").insert({
    business_id: s.site.business.id,
    location_id: s.site.location.id,
    client_id: s.account.clientId,
    token_hash: sha256(token),
    channel: contact.channel,
    sent_to: contact.destination,
    expires_at: new Date(Date.now() + HOUR * 1000).toISOString(),
    from_account: true,
  });
  if (error) throw error;
  redirect(`/card/${token}`);
}

export async function saveMessagePreferences(slug: string, prefs: { sms: boolean; email: boolean }): Promise<AccountResult> {
  const s = await signedIn(slug);
  if (!s) return { ok: false, message: "Please sign in again." };
  const { error } = await s.admin
    .from("clients")
    .update({ sms_opt_in: Boolean(prefs.sms), email_opt_in: Boolean(prefs.email) })
    .eq("id", s.account.clientId)
    .eq("business_id", s.site.business.id);
  if (error) throw error;
  return { ok: true, message: "Saved." };
}
