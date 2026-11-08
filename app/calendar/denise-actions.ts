"use server";

import { policyNeedFor } from "@/lib/booking-policy";
import { revalidatePath } from "next/cache";
import { toldAboutFix, type Told } from "@/lib/denise/applied";
import { approveFix, rejectFix, undoFix } from "@/lib/denise/fixes";
import { deniseDay } from "@/lib/denise/day-state";
import { askerOf, deniseSession, type DeniseSession } from "@/lib/denise/session";
import type { DeniseState, FixResult, Moved } from "@/lib/denise/types";
import { isUuid } from "@/lib/ids";
import { bookWaitlistEntry } from "@/lib/waitlist-book";
import { siteUrl } from "@/lib/branding";
import { appointmentChannel, blockedReason } from "@/lib/messaging/send";
import { withStopLine } from "@/lib/messaging/templates";
import { phoneDigits } from "@/lib/online-booking/contact";
import { newSecret, sha256 } from "@/lib/online-booking/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMinute, fromLocal, isLocalDate, toLocal } from "@/lib/scheduling/time";
import { OFFER_MINUTES, offerMessage, offerWhen } from "@/lib/waitlist-offers";

const NOT_SIGNED_IN = "Sign in again.";

function refresh() {
  revalidatePath("/calendar", "layout");
}

const session = deniseSession;
type Session = DeniseSession;

function look(s: Session, date: string): Promise<DeniseState> {
  return deniseDay(askerOf(s), date);
}

// Books a waitlist client into an opening Denise found (staff choose and
// tell the client; Denise doesn't contact them).
export async function bookFromWaitlist(entryId: string, staffId: string, date: string, startMinute: number): Promise<FixResult> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_SIGNED_IN };
  if (!s.viewer.canBook) return { ok: false, message: "Only the front desk, managers and owners can book." };
  if (!isUuid(entryId) || !isUuid(staffId) || !isLocalDate(date)) return { ok: false, message: "That opening isn't there any more." };
  const booked = await bookWaitlistEntry(s.supabase, s.viewer.location, entryId, staffId, date, startMinute);
  const need = booked.ok ? await policyNeedFor(s.supabase, s.me.business_id, s.me.role, booked.appointmentId) : null;
  const result = need && booked.ok ? { ...booked, message: `${booked.message} ${need}: send the link from booking details.` } : booked;
  refresh();
  return { ...result, state: await look(s, date) };
}

// Offers an opening to a waitlist client with one tap: the salon's fixed
// message with a link to take it or say no thanks, on the channel they get
// visit messages on. Only staff send it; Denise never does.
export async function offerWaitlistSpot(entryId: string, staffId: string, date: string, startMinute: number): Promise<FixResult> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_SIGNED_IN };
  if (!s.viewer.canBook) return { ok: false, message: "Only the front desk, managers and owners can offer a spot." };
  if (!isUuid(entryId) || !isUuid(staffId) || !isLocalDate(date) || !Number.isInteger(startMinute)) return { ok: false, message: "That opening isn't there any more." };
  const tz = s.viewer.location.timezone;
  const start = fromLocal(date, startMinute, tz);
  if (!start) return { ok: false, message: "That opening isn't there any more." };
  const { data: entry } = await s.supabase
    .from("waitlist_entries")
    .select("id, client_id, service_ids, client:clients(first_name)")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return { ok: false, message: "That client is no longer on the waitlist." };
  const first = entry.client.first_name;
  const admin = createAdminClient();
  const to = await appointmentChannel(admin, entry.client_id);
  if (!to) return { ok: false, message: `${first} doesn't get visit messages. Call them instead.` };
  const address = to.channel === "sms" ? (phoneDigits(to.to) ?? to.to) : to.to;
  const blocked = await blockedReason(admin, to.channel, address, { id: entry.client_id, firstName: first });
  if (blocked) return { ok: false, message: blocked };

  const token = newSecret();
  const { data: offerId, error } = await s.supabase.rpc("create_waitlist_offer", {
    p_entry_id: entryId,
    p_staff_id: staffId,
    p_starts_at: start.toISOString(),
    p_token_hash: sha256(token),
    p_channel: to.channel,
    p_to: address,
    p_minutes: OFFER_MINUTES,
  });
  if (error?.code === "42501" || error?.code === "55000" || error?.code === "22023") return { ok: false, message: `${error.message}.` };
  if (error) throw error;
  const [{ data: offer }, { data: business }, { data: stylist }, { data: services }] = await Promise.all([
    s.supabase.from("waitlist_offers").select("expires_at").eq("id", offerId).single(),
    s.supabase.from("businesses").select("name").eq("id", s.me.business_id).single(),
    s.supabase.from("staff").select("first_name").eq("id", staffId).single(),
    s.supabase.from("services").select("id, name").in("id", entry.service_ids),
  ]);
  const until = formatMinute(toLocal(new Date(offer!.expires_at), tz).minute);
  const names = entry.service_ids.map((id) => services?.find((x) => x.id === id)?.name ?? "").filter(Boolean);
  const message = offerMessage(business?.name ?? "The salon", first, names, stylist?.first_name ?? "your stylist", offerWhen(start.toISOString(), tz), until, `${siteUrl()}/offer/${token}`, to.channel);
  const { error: outError } = await admin.from("outbox_messages").insert({
    business_id: s.me.business_id,
    channel: to.channel,
    to_address: address,
    subject: message.subject,
    body: to.channel === "sms" ? withStopLine(message.body) : message.body,
  });
  if (outError) throw outError;
  refresh();
  return { ok: true, message: `Offered to ${first}, held for them until ${until}. Whoever books the time first has it.`, state: await look(s, date) };
}

// Denise looks over the day: conflicts, her fixes, and notices.
export async function scanDenise(date: string): Promise<DeniseState | null> {
  const s = await session();
  if (!s || !isLocalDate(date)) return null;
  return look(s, date);
}

async function decide(actionId: string, date: string, run: (s: Session) => Promise<{ ok: true; message: string; moved?: Moved } | { ok: false; message: string }>): Promise<FixResult> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_SIGNED_IN };
  if (!isUuid(actionId) || !isLocalDate(date)) return { ok: false, message: "I can't find that suggestion any more." };
  const result = await run(s);
  refresh();
  const state = await look(s, date);
  return result.ok ? { ok: true, message: result.message, state, moved: result.moved } : { ok: false, message: result.message, state };
}

export async function approveDeniseFix(actionId: string, date: string, clientId: string | null = null): Promise<FixResult> {
  return decide(actionId, date, (s) => approveFix(s.supabase, s.viewer, actionId, { clientId: clientId && isUuid(clientId) ? clientId : null }));
}

export async function undoDeniseFix(actionId: string, date: string): Promise<FixResult> {
  return decide(actionId, date, (s) => undoFix(s.supabase, s.viewer, actionId));
}

// Before an undo: the clients already told about the move, and the
// correction each would be sent.
export async function undoWarning(actionId: string): Promise<Told[]> {
  const s = await session();
  if (!s?.viewer.canBook || !isUuid(actionId)) return [];
  return toldAboutFix(s.supabase, s.viewer.location.timezone, actionId);
}

export async function rejectDeniseFix(actionId: string, date: string): Promise<FixResult> {
  return decide(actionId, date, async (s) => {
    const result = await rejectFix(s.supabase, actionId);
    return result.ok ? { ok: true, message: "Okay, I'll leave that one." } : result;
  });
}

// Dismisses an item from her brief or panel for the day ("noshow:<id>",
// "late:<id>", ...). It stays gone, for everyone at the location.
export async function dismissDeniseItem(key: string, date: string): Promise<{ ok: boolean }> {
  const s = await session();
  if (!s || !s.viewer.canBook || !isLocalDate(date) || !/^(risk|noshow|due|stock|credit|late):[\w:.-]{1,180}$/.test(key)) return { ok: false };
  const { error } = await s.supabase.rpc("dismiss_denise_item", { p_location_id: s.viewer.location.id, p_day: date, p_key: key });
  if (error) throw error;
  return { ok: true };
}
