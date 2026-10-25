"use server";

// The desk's actions on an event's proposal and money: send the proposal
// (a secure link), send a member their own share to pay, try a failed
// payment again, mark an event lost or reopen it. The database checks who
// may do each; links go through the outbox in fixed templates, never to a
// number that replied STOP or on a channel the client turned off.

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { siteUrl } from "@/lib/branding";
import { chargeDuePayments, runEventBilling } from "@/lib/events/billing";
import { CARD_LINK_DAYS, cardLinkMessage, MEMBER_LINK_DAYS, memberLinkMessage, PROPOSAL_LINK_DAYS, proposalMessage } from "@/lib/events/messages";
import { memberShare } from "@/lib/events/pricing";
import { settingsFrom } from "@/lib/events/types";
import { isUuid } from "@/lib/ids";
import { blockedReason } from "@/lib/messaging/send";
import { withStopLine } from "@/lib/messaging/templates";
import { normalEmail, phoneDigits } from "@/lib/online-booking/contact";
import { newSecret, sha256 } from "@/lib/online-booking/security";
import { isFrontOfHouse } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export type MoneyResult = { ok: true; message: string } | { ok: false; message: string };

const NOT_ALLOWED = "Only the front desk, managers and owners can do that.";

function refresh(eventId: string) {
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
}

function address(channel: "sms" | "email", to: string): string | null {
  return channel === "sms" ? phoneDigits(to) : normalEmail(to);
}

async function outbox(businessId: string, channel: "sms" | "email", to: string, message: { subject: string | null; body: string }) {
  const { error } = await createAdminClient()
    .from("outbox_messages")
    .insert({ business_id: businessId, channel, to_address: to, subject: channel === "email" ? message.subject : null, body: channel === "sms" ? withStopLine(message.body) : message.body });
  if (error) throw error;
}

export async function sendProposal(eventId: string, channel: "sms" | "email", to: string): Promise<MoneyResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isFrontOfHouse(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(eventId)) return { ok: false, message: "That event no longer exists." };
  if (!address(channel, to)) return { ok: false, message: channel === "sms" ? "Enter a 10-digit mobile number." : "Enter an email address like name@example.com." };
  const { data: e } = await supabase.from("events").select("title, client:clients(id, first_name)").eq("id", eventId).maybeSingle();
  if (!e?.client) return { ok: false, message: "Add the client before sending a proposal." };
  const blocked = await blockedReason(createAdminClient(), channel, to.trim(), { id: e.client.id, firstName: e.client.first_name });
  if (blocked) return { ok: false, message: blocked };

  const token = newSecret();
  const { error } = await supabase.rpc("send_event_proposal", { p_event_id: eventId, p_token_hash: sha256(token), p_channel: channel, p_to: to.trim(), p_days: PROPOSAL_LINK_DAYS });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "55000") return { ok: false, message: `${error.message}.` };
  if (error) throw error;
  await outbox(me.business_id, channel, to.trim(), proposalMessage(me.location.business.name, e.client.first_name, e.title, `${siteUrl()}/event/${token}`, channel));
  refresh(eventId);
  return { ok: true, message: `Proposal sent to ${to.trim()}.` };
}

export async function sendMemberLink(memberId: string, channel: "sms" | "email", to: string): Promise<MoneyResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isFrontOfHouse(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(memberId)) return { ok: false, message: "They're no longer in the party." };
  if (!address(channel, to)) return { ok: false, message: channel === "sms" ? "Enter a 10-digit mobile number." : "Enter an email address like name@example.com." };
  const blocked = await blockedReason(createAdminClient(), channel, to.trim(), null);
  if (blocked) return { ok: false, message: blocked };
  const { data: m } = await supabase.from("event_members").select("name, price_cents, event:events(id, title)").eq("id", memberId).maybeSingle();
  if (!m) return { ok: false, message: "They're no longer in the party." };
  const [{ data: s }, { data: b }] = await Promise.all([
    supabase.from("event_settings").select("*").eq("business_id", me.business_id).single(),
    supabase.from("businesses").select("tax_rate_services_bp").eq("id", me.business_id).single(),
  ]);

  const token = newSecret();
  const { error } = await supabase.rpc("send_event_member_link", { p_member_id: memberId, p_token_hash: sha256(token), p_channel: channel, p_to: to.trim(), p_days: MEMBER_LINK_DAYS });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "55000") return { ok: false, message: `${error.message}.` };
  if (error) throw error;
  const share = memberShare(m.price_cents, settingsFrom(s!), b!.tax_rate_services_bp);
  await outbox(me.business_id, channel, to.trim(), memberLinkMessage(me.location.business.name, m.name, m.event.title, share, `${siteUrl()}/event/${token}`, channel));
  refresh(m.event.id);
  return { ok: true, message: `Pay link sent to ${to.trim()}.` };
}

// A link for the client to put a new card on the event.
export async function sendEventCardLink(eventId: string, channel: "sms" | "email", to: string): Promise<MoneyResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isFrontOfHouse(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(eventId)) return { ok: false, message: "That event no longer exists." };
  if (!address(channel, to)) return { ok: false, message: channel === "sms" ? "Enter a 10-digit mobile number." : "Enter an email address like name@example.com." };
  const { data: e } = await supabase.from("events").select("title, client:clients(id, first_name)").eq("id", eventId).maybeSingle();
  if (!e?.client) return { ok: false, message: "That event no longer exists." };
  const blocked = await blockedReason(createAdminClient(), channel, to.trim(), { id: e.client.id, firstName: e.client.first_name });
  if (blocked) return { ok: false, message: blocked };
  const token = newSecret();
  const { error } = await supabase.rpc("send_event_card_link", { p_event_id: eventId, p_token_hash: sha256(token), p_channel: channel, p_to: to.trim(), p_days: CARD_LINK_DAYS });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "55000") return { ok: false, message: `${error.message}.` };
  if (error) throw error;
  await outbox(me.business_id, channel, to.trim(), cardLinkMessage(me.location.business.name, e.client.first_name, e.title, `${siteUrl()}/event/${token}`, channel));
  refresh(eventId);
  return { ok: true, message: `Card link sent to ${to.trim()}.` };
}

export async function retryEventPayment(paymentId: string): Promise<MoneyResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isFrontOfHouse(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(paymentId)) return { ok: false, message: "That payment no longer exists." };
  const { data: p } = await supabase.from("event_payments").select("event_id").eq("id", paymentId).maybeSingle();
  if (!p) return { ok: false, message: "That payment no longer exists." };
  const { error } = await supabase.rpc("retry_event_payment", { p_payment_id: paymentId });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "55000") return { ok: false, message: `${error.message}.` };
  if (error) throw error;
  // Charged now (any hour: someone at the desk asked for it).
  const admin = createAdminClient();
  const charged = await chargeDuePayments(admin, { businessId: me.business_id, paymentId });
  refresh(p.event_id);
  if (charged.failed) return { ok: false, message: `It didn't go through again${charged.reasons[0] ? ` (${charged.reasons[0]})` : ""}. Ask the client for another card.` };
  await runEventBilling(admin, { businessId: me.business_id, paymentId });
  refresh(p.event_id);
  return { ok: true, message: "Paid." };
}

export async function setEventStatus(eventId: string, status: "lost" | "inquiry" | "booked" | "trial_done", reason = ""): Promise<MoneyResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isFrontOfHouse(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(eventId)) return { ok: false, message: "That event no longer exists." };
  const { error } = await supabase.rpc("set_event_status", { p_event_id: eventId, p_status: status, p_reason: reason.trim().slice(0, 300) });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "55000" || error?.code === "22023") return { ok: false, message: `${error.message}.` };
  if (error) throw error;
  refresh(eventId);
  return { ok: true, message: status === "lost" ? "Marked as lost." : status === "inquiry" ? "Reopened as an inquiry." : "Saved." };
}
