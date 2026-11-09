// The grace message (Settings → Policies → Grace), server only. It's never
// sent by itself: once grace forgives (or holds) a fee, booking details and
// Denise's card ask "Let Ava know their fee was waived?" with the salon's
// message filled in here from the fee, never from the browser or Denise,
// and only Send sends it (send_client_message, logged with who sent it);
// Don't send is skip_grace_message. Read and sent with the staff member's
// own login, so RLS and the database decide who may.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { siteUrl } from "@/lib/branding";
import { channelFor, consentOf, type Channel } from "@/lib/messaging/consent";
import { withStopLine } from "@/lib/messaging/templates";
import { graceFromRow, graceMessage, graceMessageDue } from "@/lib/policy";
import { toLocal } from "@/lib/scheduling/time";
import { CONSENT_COLUMNS, guardianChannel, guardianRecipients } from "@/lib/messaging/send";

type Supabase = SupabaseClient<Database>;

export type GraceAsk = {
  feeId: string;
  appointmentId: string;
  clientName: string;
  firstName: string;
  phone: string | null;
  // The channel they allow for messages about visits (null: call them).
  channel: Channel | null;
  subject: string;
  body: string;
  // Waived already, or held until they rebook.
  held: boolean;
};

export const GRACE_DUE_COLUMNS = "grace_at, grace_message_at, grace_message_skipped_at, status, grace_until";

const FEE_COLUMNS = `id, appointment_id, business_id, ${GRACE_DUE_COLUMNS}, grace_staff:staff!policy_fees_grace_staff_id_fkey(id, first_name), client:clients(first_name, last_name, ${CONSENT_COLUMNS}), location:locations(timezone, phone)`;

export async function graceAsks(supabase: Supabase, feeIds: string[]): Promise<GraceAsk[]> {
  if (!feeIds.length) return [];
  const { data: fees, error } = await supabase.from("policy_fees").select(FEE_COLUMNS).in("id", feeIds);
  if (error) throw error;
  const due = fees.filter((f) => graceMessageDue(f));
  if (!due.length) return [];
  const businessId = due[0].business_id;
  const [{ data: business }, { data: settings }, { data: online }] = await Promise.all([
    supabase.from("businesses").select("name, slug").eq("id", businessId).single(),
    supabase.from("policy_settings").select("grace_on, grace_kinds, grace_months, grace_rebook_days, grace_message").eq("business_id", businessId).maybeSingle(),
    supabase.from("online_booking_settings").select("enabled").eq("business_id", businessId).maybeSingle(),
  ]);
  const grace = graceFromRow(settings);
  const bookOnline = Boolean(online?.enabled && business?.slug);
  const guardians = await guardianRecipients(supabase, due.map((f) => f.appointment_id));
  return due.map((f) => {
    const guardian = guardians.get(f.appointment_id);
    const channel = guardian ? guardianChannel(guardian) : (channelFor(consentOf(f.client), "appointment", "sms")?.channel ?? null);
    const stylist = f.grace_staff;
    const tz = f.location.timezone;
    let by = "";
    if (f.grace_until) {
      const [y, m, d] = toLocal(new Date(f.grace_until), tz).date.split("-").map(Number);
      by = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
    }
    const message = graceMessage(grace.message, {
      firstName: guardian?.guardian ?? f.client.first_name,
      salon: business?.name ?? "The salon",
      stylist: stylist?.first_name ?? "us",
      by,
      bookingLink: bookOnline ? `${siteUrl()}/book/${business!.slug}?src=grace${stylist ? `&staff=${stylist.id}` : ""}` : (f.location.phone ?? ""),
    });
    const body = guardian ? `About ${guardian.dependent}'s visit: ${message}` : message;
    return {
      feeId: f.id,
      appointmentId: f.appointment_id,
      clientName: `${f.client.first_name} ${f.client.last_name ?? ""}`.trim(),
      firstName: f.client.first_name,
      phone: f.client.phone,
      channel,
      subject: business?.name ?? "A message from the salon",
      body,
      held: f.status !== "waived",
    };
  });
}

export type GraceSendResult = { ok: true; message: string } | { ok: false; message: string };

// Sends it: the salon's message as it is, or `edited`, their own words
// (the database refuses those for a role that can't write its own).
export async function sendGrace(supabase: Supabase, feeId: string, channel: Channel, edited: string | null): Promise<GraceSendResult> {
  const [ask] = await graceAsks(supabase, [feeId]);
  if (!ask) return { ok: false, message: "That message has already been sent or skipped." };
  if (ask.channel !== channel) return { ok: false, message: `${ask.firstName} doesn't get ${channel === "sms" ? "texts" : "emails"} about visits.` };
  const body = (edited ?? ask.body).trim();
  if (!body) return { ok: false, message: "Write a message first." };
  const { error } = await supabase.rpc("send_client_message", {
    p_appointment_id: ask.appointmentId,
    p_purpose: "appointment",
    p_template: edited ? "custom" : "grace",
    p_channel: channel,
    p_subject: ask.subject,
    p_body: channel === "sms" ? withStopLine(body) : body,
    p_opt_out_hash: null as never,
  });
  if (error) {
    if (error.code === "42501" || error.code === "55000" || error.code === "22023") return { ok: false, message: `${error.message}.` };
    throw error;
  }
  return { ok: true, message: `Sent to ${ask.firstName} by ${channel === "sms" ? "text" : "email"}.` };
}

export async function skipGrace(supabase: Supabase, feeId: string): Promise<GraceSendResult> {
  const { error } = await supabase.rpc("skip_grace_message", { p_fee_id: feeId });
  if (error) {
    if (error.code === "42501" || error.code === "55000") return { ok: false, message: `${error.message}.` };
    throw error;
  }
  return { ok: true, message: "Not sent." };
}
