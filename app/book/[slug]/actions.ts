"use server";

// The public booking site's server side. Everything is checked here, never
// trusted from the browser: the salon and its rules, which services and
// stylists can be booked, the times (planned with the booking rules in
// lib/scheduling/), who the client is (a confirmed code), rate limits and
// a honeypot field for bots. Every booking, change and cancellation is
// logged.

import { siteUrl } from "@/lib/branding";
import { isBookingSource } from "@/lib/online-booking/sources";
import { normalEmail, phoneDigits, formatPhone } from "@/lib/online-booking/contact";
import { sendCode, sessionContact, verifyCode, type Channel } from "@/lib/online-booking/codes";
import { hashKey, newSecret, requestInfo, sha256, withinLimits } from "@/lib/online-booking/security";
import { loadSite, stylistsFor, type BookingSite } from "@/lib/online-booking/site";
import { bookOnline, cancelOnline } from "@/lib/scheduling/online-book";
import { loadBookingContext } from "@/lib/scheduling/load";
import { visitTimes, type VisitRequest } from "@/lib/scheduling/online";
import { addDays, fromLocal, isLocalDate, todayIn, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { formatMinute } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { patchExplanation } from "@/lib/online-booking/patch";
import { loadManaged, canChange } from "@/lib/online-booking/manage";
import { onlineTerms, type OnlineTerms } from "@/lib/online-booking/terms";
import { currentProvider, providerFor } from "@/lib/payments";

const MAX_SERVICES = 4;
const DAYS_PER_PAGE = 14;
const HOUR = 3600;

async function openSite(slug: string): Promise<BookingSite | null> {
  const found = await loadSite(createAdminClient(), slug);
  return found.status === "open" ? found.site : null;
}

// The services and stylist asked for, if the site allows them together.
function visitRequest(site: BookingSite, serviceIds: unknown, staffId: unknown): VisitRequest | null {
  if (!Array.isArray(serviceIds) || serviceIds.length === 0 || serviceIds.length > MAX_SERVICES) return null;
  const ids = serviceIds.map(String);
  if (new Set(ids).size !== ids.length) return null;
  for (const id of ids) {
    const service = site.services.find((s) => s.id === id);
    if (!service || service.mode !== "bookable") return null;
  }
  const stylistIds = site.stylists.filter((s) => ids.some((id) => id in s.prices)).map((s) => s.id);
  if (staffId === null) return { serviceIds: ids, staffId: null, stylistIds };
  if (typeof staffId !== "string" || !stylistsFor(site, ids).some((s) => s.id === staffId)) return null;
  return { serviceIds: ids, staffId, stylistIds };
}

function bookingWindow(site: BookingSite, now = new Date()) {
  const tz = site.location.timezone;
  const today = todayIn(tz, now);
  const lastDay = addDays(today, site.settings.windowDays);
  return {
    today,
    lastDay,
    notBefore: new Date(now.getTime() + site.settings.noticeMinutes * 60_000),
    notAfter: fromLocal(addDays(lastDay, 1), 0, tz) ?? undefined,
  };
}

export type DayTimes = { date: LocalDate; times: { minute: number; staffIds: string[] }[] };
export type TimesResult = { ok: true; days: DayTimes[]; lastDay: LocalDate } | { ok: false; message: string };

// Free times for the visit over two weeks from `from`.
export async function findTimes(slug: string, serviceIds: string[], staffId: string | null, from: string, rescheduleToken?: string): Promise<TimesResult> {
  const site = await openSite(slug);
  if (!site) return { ok: false, message: "Online booking isn't available right now." };
  const admin = createAdminClient();
  const { ipHash } = await requestInfo();
  if (!(await withinLimits(admin, [{ key: `times:${ipHash}`, limit: 240, windowSeconds: HOUR }]))) {
    return { ok: false, message: "That's a lot of searching. Please wait a few minutes and try again." };
  }

  let request: VisitRequest | null;
  let replacing: string | undefined;
  if (rescheduleToken) {
    const managed = await loadManaged(admin, site, rescheduleToken);
    if (!managed || !canChange(site, managed)) return { ok: false, message: "This booking can't be changed online." };
    request = managed.request;
    replacing = managed.id;
  } else {
    request = visitRequest(site, serviceIds, staffId);
  }
  if (!request) return { ok: false, message: "Those services can't be booked together online." };

  const window = bookingWindow(site);
  const start = isLocalDate(from) && from > window.today ? from : window.today;
  if (start > window.lastDay) return { ok: true, days: [], lastDay: window.lastDay };
  const end = addDays(start, DAYS_PER_PAGE - 1) < window.lastDay ? addDays(start, DAYS_PER_PAGE - 1) : window.lastDay;

  const location = { id: site.location.id, timezone: site.location.timezone };
  const ctx = await loadBookingContext(admin, location, start, end);
  const days: DayTimes[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const times = visitTimes(ctx, request, date, { notBefore: window.notBefore, notAfter: window.notAfter, replacingAppointmentId: replacing });
    days.push({ date, times: times.map((t) => ({ minute: t.minute, staffIds: [...new Set(t.items.map((i) => i.staffId))] })) });
  }
  return { ok: true, days, lastDay: window.lastDay };
}

export type CodeResult = { ok: true; verificationId: string; sentTo: string } | { ok: false; message: string };

// Sends a code to a phone number or email. The answer is the same whether
// or not the salon knows them, so the site can't be used to look people up.
export async function requestCode(slug: string, channel: Channel, value: string, honeypot: string): Promise<CodeResult> {
  const site = await openSite(slug);
  if (!site) return { ok: false, message: "Online booking isn't available right now." };
  const destination = channel === "sms" ? phoneDigits(value) : normalEmail(value);
  if (!destination) return { ok: false, message: channel === "sms" ? "Enter a 10-digit mobile number." : "Enter an email address like name@example.com." };

  const admin = createAdminClient();
  const { ipHash } = await requestInfo();
  const allowed = await withinLimits(admin, [
    { key: `code:ip:${ipHash}`, limit: 10, windowSeconds: HOUR },
    { key: `code:to:${hashKey(destination)}`, limit: 5, windowSeconds: HOUR },
  ]);
  if (!allowed) return { ok: false, message: "Too many codes requested. Please wait a while, or call the salon." };

  // Bots fill in every field, including the hidden one: pretend it worked.
  if (honeypot) return { ok: true, verificationId: crypto.randomUUID(), sentTo: value };

  const verificationId = await sendCode(admin, site.business, channel, destination);
  return { ok: true, verificationId, sentTo: channel === "sms" ? formatPhone(destination) : destination };
}

export type ConfirmResult =
  | { ok: true; session: string; client: { known: true; firstName: string } | { known: false; channel: Channel; contact: string } }
  | { ok: false; message: string };

export async function confirmCode(slug: string, verificationId: string, code: string): Promise<ConfirmResult> {
  const site = await openSite(slug);
  if (!site) return { ok: false, message: "Online booking isn't available right now." };
  if (!/^[0-9a-f-]{36}$/.test(verificationId) || !/^\d{6}$/.test(code.trim())) return { ok: false, message: "Enter the 6-digit code." };
  const admin = createAdminClient();
  const result = await verifyCode(admin, site.business.id, verificationId, code);
  if (!result.ok) {
    return {
      ok: false,
      message: {
        wrong: "That code isn't right. Check it and try again.",
        expired: "That code has expired. Ask for a new one.",
        too_many: "Too many tries. Ask for a new code.",
      }[result.error],
    };
  }
  const contact = (await sessionContact(admin, site.business.id, result.session))!;
  const clientId = await findClient(admin, site, contact.channel, contact.destination);
  if (clientId) {
    const { data } = await admin.from("clients").select("first_name").eq("id", clientId).single();
    return { ok: true, session: result.session, client: { known: true, firstName: data!.first_name } };
  }
  return {
    ok: true,
    session: result.session,
    client: { known: false, channel: contact.channel, contact: contact.channel === "sms" ? formatPhone(contact.destination) : contact.destination },
  };
}

async function findClient(admin: ReturnType<typeof createAdminClient>, site: BookingSite, channel: Channel, destination: string, create?: { first: string; last: string; phone: string; email: string }) {
  const { data, error } = await admin.rpc("find_online_client", {
    p_business_id: site.business.id,
    p_phone_digits: channel === "sms" ? destination : (create ? (phoneDigits(create.phone) ?? "") : ""),
    p_email: channel === "email" ? destination : (create?.email ?? ""),
    p_first_name: create?.first ?? "",
    p_last_name: create?.last ?? "",
    p_phone: channel === "sms" ? formatPhone(destination) : create?.phone ?? "",
  });
  if (error) throw error;
  return data as string | null;
}

export type TermsResult =
  | { ok: true; lines: string[]; cardNeeded: boolean; depositCents: number; cardOnFile: string | null; testMode: boolean; cards: { ref: string; label: string; outcome: string }[] }
  | { ok: false; message: string };

// The policy for this visit, before the client agrees: its text with this
// visit's amounts, and whether a card (and a deposit) is needed.
export async function reviewTerms(slug: string, session: string, serviceIds: string[], staffId: string | null, date: string, minute: number): Promise<TermsResult> {
  const site = await openSite(slug);
  if (!site) return { ok: false, message: "Online booking isn't available right now." };
  const request = visitRequest(site, serviceIds, staffId);
  const start = isLocalDate(date) && Number.isInteger(minute) ? fromLocal(date, minute, site.location.timezone) : null;
  if (!request || !start) return { ok: false, message: "Those services can't be booked together online." };
  const admin = createAdminClient();
  const contact = await sessionContact(admin, site.business.id, session);
  if (!contact) return { ok: false, message: "Your code has expired. Please confirm your details again." };
  const clientId = await findClient(admin, site, contact.channel, contact.destination);
  const terms = await onlineTerms(admin, site, clientId, request, start);
  if (!terms) return { ok: false, message: "Sorry, that time was just taken. Please pick another." };
  const provider = currentProvider();
  return {
    ok: true,
    lines: terms.lines,
    cardNeeded: terms.cardNeeded,
    depositCents: terms.depositCents,
    cardOnFile: terms.cardOnFile?.label ?? null,
    testMode: provider.testMode,
    cards: provider.testCards.map((c) => ({ ref: c.ref, label: c.label, outcome: c.outcome })),
  };
}

export type BookInput = {
  session: string;
  serviceIds: string[];
  staffId: string | null;
  date: string;
  minute: number;
  // New clients only.
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  note?: string;
  agreed: boolean;
  honeypot: string;
  // Where they came from (?src= on the link they followed).
  source?: string;
  // The card entered on the provider's form, when one is needed.
  cardRef?: string;
};

export type BookResult =
  | { ok: true; manageUrl: string }
  | { ok: false; message: string; reason?: "taken" | "patch_test" | "session" | "details" | "new_clients" | "card"; serviceIds?: string[] };

export async function book(slug: string, input: BookInput): Promise<BookResult> {
  const site = await openSite(slug);
  if (!site) return { ok: false, message: "Online booking isn't available right now." };
  const admin = createAdminClient();
  const { ipHash, userAgent } = await requestInfo();
  if (!(await withinLimits(admin, [{ key: `book:ip:${ipHash}`, limit: 10, windowSeconds: HOUR }]))) {
    return { ok: false, message: "Too many bookings from here. Please call the salon." };
  }
  if (input.honeypot) return { ok: false, message: "Something went wrong. Please call the salon." };
  if (!input.agreed) return { ok: false, message: "Please read and agree to the cancellation policy." };

  const request = visitRequest(site, input.serviceIds, input.staffId);
  if (!request) return { ok: false, message: "Those services can't be booked together online." };
  const window = bookingWindow(site);
  const start = isLocalDate(input.date) && Number.isInteger(input.minute) ? fromLocal(input.date, input.minute, site.location.timezone) : null;
  if (!start || start < window.notBefore || (window.notAfter && start > window.notAfter)) {
    return { ok: false, reason: "taken", message: "That time can't be booked online any more. Please pick another." };
  }

  const contact = await sessionContact(admin, site.business.id, input.session);
  if (!contact) return { ok: false, reason: "session", message: "Your code has expired. Please confirm your details again." };

  let clientId = await findClient(admin, site, contact.channel, contact.destination);
  if (!clientId) {
    if (!site.settings.allowNewClients) return { ok: false, reason: "new_clients", message: `${site.business.name} isn't taking new clients online. Please call to book.` };
    const first = input.firstName?.trim() ?? "";
    const last = input.lastName?.trim() ?? "";
    const phone = contact.channel === "sms" ? contact.destination : phoneDigits(input.phone ?? "");
    const email = contact.channel === "email" ? contact.destination : normalEmail(input.email ?? "");
    if (!first || first.length > 60 || last.length > 60 || !phone || !email) {
      return { ok: false, reason: "details", message: "Enter your first name, a 10-digit phone number and an email address." };
    }
    clientId = await findClient(admin, site, contact.channel, contact.destination, { first, last, phone: formatPhone(phone), email });
  }

  // The policy for this visit, as the client was shown it; the card is
  // saved (and any deposit taken) before the booking is confirmed.
  const terms = await onlineTerms(admin, site, clientId!, request, start);
  if (!terms) return { ok: false, reason: "taken", message: "Sorry, that time was just taken. Please pick another." };
  const token = newSecret();
  const card = await cardFor(terms, input.cardRef);
  if (!card.ok) return { ok: false, reason: "card", message: card.message };
  let deposit: { amount_cents: number; provider: string; reference: string } | null = null;
  if (terms.depositCents > 0 && card.charge) {
    const charged = await providerFor(card.charge.provider).charge({ amountCents: terms.depositCents, paymentMethodRef: card.charge.ref, description: "Deposit", idempotencyKey: `deposit:${sha256(token)}` });
    if (!charged.ok) return { ok: false, reason: "card", message: `${charged.reason}. You haven't been charged; try another card.` };
    deposit = { amount_cents: terms.depositCents, provider: card.charge.provider, reference: charged.reference };
  }

  const note = input.note?.trim().slice(0, 500);
  const result = await bookOnline(admin, { id: site.location.id, timezone: site.location.timezone }, {
    clientId: clientId!,
    notes: note ? `From the client (online): ${note}` : null,
    request,
    start,
    manageTokenHash: sha256(token),
    source: isBookingSource(input.source) ? input.source : "direct",
  });
  if (!result.ok) {
    if (deposit) await providerFor(deposit.provider).refund(deposit.reference);
    if (result.error === "patch_test") {
      return { ok: false, reason: "patch_test", serviceIds: result.serviceIds, message: patchExplanation(site, result.state) };
    }
    return { ok: false, reason: "taken", message: "Sorry, that time was just taken. Please pick another." };
  }
  // What they agreed to and when, the card, and the deposit.
  const { error: consentError } = await admin.rpc("record_online_card", {
    p_appointment_id: result.appointmentId,
    p_card: (card.save ?? null) as never,
    p_consent: { policy_text: terms.lines.join("\n"), terms: { ...terms.terms, deposit_cents: terms.depositCents, visit_cents: terms.visitCents }, ip_hash: ipHash },
    p_deposit: deposit as never,
  });
  if (consentError) throw consentError;

  const manageUrl = `/book/${site.business.slug}/manage/${token}`;
  await Promise.all([
    admin.from("online_booking_log").insert({
      business_id: site.business.id,
      appointment_id: result.appointmentId,
      client_id: clientId,
      action: "booked",
      ip_hash: ipHash,
      user_agent: userAgent,
      source: isBookingSource(input.source) ? input.source : "direct",
    }),
    confirmationMessage(admin, site, contact, start, manageUrl, terms),
  ]);
  return { ok: true, manageUrl: `${manageUrl}?booked=1` };
}

async function confirmationMessage(
  admin: ReturnType<typeof createAdminClient>,
  site: BookingSite,
  contact: { channel: Channel; destination: string },
  start: Date,
  manageUrl: string,
  terms: OnlineTerms,
) {
  const local = toLocal(start, site.location.timezone);
  const when = `${new Date(`${local.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })} at ${formatMinute(local.minute)}`;
  await admin.from("outbox_messages").insert({
    business_id: site.business.id,
    channel: contact.channel,
    to_address: contact.destination,
    subject: contact.channel === "email" ? `You're booked at ${site.business.name}` : null,
    body: `${site.business.name}: you're booked for ${when}.${terms.depositCents ? ` Deposit paid: $${(terms.depositCents / 100).toFixed(2)}.` : ""} View, change or cancel: ${siteUrl()}${manageUrl}\n\nOur cancellation policy: ${terms.lines.join(" ")}`,
  });
}

// The card for a booking that needs one: one entered now (saved with the
// provider), or the one on file. A deposit is charged to it.
async function cardFor(
  terms: OnlineTerms,
  cardRef: string | undefined,
): Promise<{ ok: true; save?: { provider: string; ref: string; label: string }; charge?: { provider: string; ref: string } } | { ok: false; message: string }> {
  if (cardRef) {
    const provider = currentProvider();
    const saved = await provider.saveCard(cardRef);
    if (!saved.ok) return { ok: false, message: `${saved.reason}.` };
    return { ok: true, save: { provider: provider.id, ref: saved.card.ref, label: saved.card.label }, charge: { provider: provider.id, ref: saved.card.ref } };
  }
  if (terms.cardOnFile) return { ok: true, charge: { provider: terms.cardOnFile.provider, ref: terms.cardOnFile.ref } };
  if (terms.cardNeeded) return { ok: false, message: "Add a card to hold your booking." };
  return { ok: true };
}

export type ManageResult = { ok: true } | { ok: false; message: string };

export async function cancelBooking(slug: string, token: string): Promise<ManageResult> {
  const site = await openSite(slug);
  if (!site) return { ok: false, message: "Online booking isn't available right now." };
  const admin = createAdminClient();
  const managed = await loadManaged(admin, site, token);
  if (!managed) return { ok: false, message: "We couldn't find this booking." };
  if (!canChange(site, managed)) return { ok: false, message: `It's too close to your visit to cancel online. Please call ${site.location.phone ?? "the salon"}.` };
  const { ipHash, userAgent } = await requestInfo();
  const result = await cancelOnline(admin, managed.id, sha256(token));
  if (!result.ok) return { ok: false, message: "This booking can't be canceled online." };
  await admin.from("online_booking_log").insert({ business_id: site.business.id, appointment_id: managed.id, client_id: managed.clientId, action: "canceled", ip_hash: ipHash, user_agent: userAgent });
  return { ok: true };
}

export async function reschedule(slug: string, token: string, date: string, minute: number): Promise<ManageResult> {
  const site = await openSite(slug);
  if (!site) return { ok: false, message: "Online booking isn't available right now." };
  const admin = createAdminClient();
  const { ipHash, userAgent } = await requestInfo();
  if (!(await withinLimits(admin, [{ key: `book:ip:${ipHash}`, limit: 10, windowSeconds: HOUR }]))) {
    return { ok: false, message: "Too many changes from here. Please call the salon." };
  }
  const managed = await loadManaged(admin, site, token);
  if (!managed || !canChange(site, managed)) return { ok: false, message: "This booking can't be changed online." };
  const window = bookingWindow(site);
  const start = isLocalDate(date) && Number.isInteger(minute) ? fromLocal(date, minute, site.location.timezone) : null;
  if (!start || start < window.notBefore || (window.notAfter && start > window.notAfter)) return { ok: false, message: "That time can't be booked online. Please pick another." };

  const result = await bookOnline(admin, { id: site.location.id, timezone: site.location.timezone }, {
    appointmentId: managed.id,
    clientId: managed.clientId,
    notes: managed.notes,
    request: managed.request,
    start,
    manageTokenHash: sha256(token),
  });
  if (!result.ok) {
    if (result.error === "patch_test") return { ok: false, message: patchExplanation(site, result.state) };
    return { ok: false, message: "Sorry, that time was just taken. Please pick another." };
  }
  await admin.from("online_booking_log").insert({ business_id: site.business.id, appointment_id: managed.id, client_id: managed.clientId, action: "rescheduled", ip_hash: ipHash, user_agent: userAgent });
  return { ok: true };
}
