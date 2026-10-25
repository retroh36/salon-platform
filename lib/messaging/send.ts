// Sending to clients through the consent rules (server only).
//
// Staff messages (Message client in booking details): a quick pick, filled
// in here from the visit so nobody can pass off other text as a template,
// or what the staff member wrote ("custom", for the roles the owner allows,
// checked again by send_client_message). Never AI-written. Offers carry an
// unsubscribe link like the automations' (only its token's hash is kept).
//
// System messages (confirmations, card and payment links, fee receipts):
// `appointmentChannel` picks the channel the client allows for messages
// about their visits, so a STOP on texts falls back to email.

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { withOptOut } from "@/lib/automations";
import { siteUrl } from "@/lib/branding";
import { formatMinute, toLocal, todayIn } from "@/lib/scheduling/time";
import { channelFor, consentOf, type Channel, type Purpose } from "./consent";
import { isStaffTemplate, renderStaffMessage, templateProblem, withStopLine, type StaffTemplate } from "./templates";

type Client = SupabaseClient<Database>;

export const CONSENT_COLUMNS = "phone, email, appointment_sms_ok, appointment_email_ok, sms_opt_in, email_opt_in, sms_stopped_at";

export type MessageInput = {
  appointmentId: string;
  purpose: Purpose;
  // A quick pick, or "custom" for what they wrote.
  template: StaffTemplate | "custom";
  channel: Channel;
  subject?: string;
  body?: string;
  minutes?: number;
  time?: string;
};

export type SendResult = { ok: true; channel: Channel } | { ok: false; message: string };

// The facts a quick pick is filled in with, from the visit.
async function visitFacts(supabase: Client, appointmentId: string) {
  const { data: a } = await supabase
    .from("appointments")
    .select("starts_at, business:businesses(name), location:locations(phone, timezone), client:clients(first_name), items:appointment_items(starts_at, staff:staff(first_name))")
    .eq("id", appointmentId)
    .maybeSingle();
  if (!a?.client || !a.location) return null;
  const tz = a.location.timezone;
  const local = toLocal(new Date(a.starts_at), tz);
  const day =
    local.date === todayIn(tz)
      ? "today"
      : new Date(`${local.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const first = [...(a.items ?? [])].sort((x, y) => x.starts_at.localeCompare(y.starts_at))[0];
  return {
    salon: a.business?.name ?? "The salon",
    phone: a.location.phone ?? null,
    firstName: a.client.first_name,
    when: `${day} at ${formatMinute(local.minute)}`,
    stylist: first?.staff?.first_name ?? null,
    manageLink: null,
  };
}

// What a quick pick says, for the panel's preview.
export async function previewTemplate(supabase: Client, input: Pick<MessageInput, "appointmentId" | "template" | "channel" | "minutes" | "time">) {
  if (!isStaffTemplate(input.template)) return null;
  const facts = await visitFacts(supabase, input.appointmentId);
  if (!facts) return null;
  return renderStaffMessage(input.template, { ...facts, minutes: input.minutes, time: input.time }, input.channel);
}

export async function sendStaffMessage(supabase: Client, input: MessageInput): Promise<SendResult> {
  let subject = input.subject?.trim() ?? "";
  let body = input.body?.trim() ?? "";
  if (input.template !== "custom") {
    if (!isStaffTemplate(input.template)) return { ok: false, message: "Choose a message." };
    const problem = templateProblem(input.template, input);
    if (problem) return { ok: false, message: problem };
    const rendered = await previewTemplate(supabase, input);
    if (!rendered) return { ok: false, message: "We couldn't find this visit." };
    ({ subject, body } = rendered);
  } else if (!body) {
    return { ok: false, message: "Write a message first." };
  }
  if (input.channel === "email" && !subject) subject = "A message from the salon";

  let optOutHash: string | null = null;
  if (input.purpose === "marketing") {
    const token = randomBytes(24).toString("base64url");
    optOutHash = createHash("sha256").update(token).digest("hex");
    body = withOptOut(body, input.channel, `${siteUrl()}/unsubscribe/${token}`);
  } else if (input.channel === "sms") {
    body = withStopLine(body);
  }

  const { error } = await supabase.rpc("send_client_message", {
    p_appointment_id: input.appointmentId,
    p_purpose: input.purpose,
    p_template: input.template,
    p_channel: input.channel,
    p_subject: subject,
    p_body: body,
    p_opt_out_hash: optOutHash as never,
  });
  if (error) {
    if (error.code === "42501" || error.code === "55000" || error.code === "22023") return { ok: false, message: `${error.message}.` };
    throw error;
  }
  return { ok: true, channel: input.channel };
}

// Where a message about a client's visit goes: the channel asked for if
// they allow it, else the other (a STOP on texts goes to email); null if
// neither reaches them.
export async function appointmentChannel(
  admin: Client,
  clientId: string,
  prefer: Channel = "sms",
): Promise<{ channel: Channel; to: string } | null> {
  const { data } = await admin.from("clients").select(CONSENT_COLUMNS).eq("id", clientId).maybeSingle();
  if (!data) return null;
  return channelFor(consentOf(data), "appointment", prefer);
}

// Whether a message staff send to an address they typed (a card or payment
// link) is allowed: never a text to a number that replied STOP, and never
// on a channel the client turned off for messages about their visits.
// Returns why not, or null.
export async function blockedReason(
  admin: Client,
  channel: Channel,
  address: string,
  client: { id: string; firstName: string } | null,
): Promise<string | null> {
  if (channel === "sms") {
    const digits = address.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    const { data } = await admin.from("sms_suppressions").select("phone_digits").eq("phone_digits", digits).maybeSingle();
    if (data) return `That number replied STOP to texts. Send it by email instead.`;
  }
  if (!client) return null;
  const { data: c } = await admin.from("clients").select("appointment_sms_ok, appointment_email_ok, sms_stopped_at").eq("id", client.id).maybeSingle();
  if (!c) return null;
  if (channel === "sms" && (c.sms_stopped_at || !c.appointment_sms_ok)) return `${client.firstName} doesn't get texts from the salon. Send it by email instead.`;
  if (channel === "email" && !c.appointment_email_ok) return `${client.firstName} doesn't get emails from the salon. Send it by text instead.`;
  return null;
}
