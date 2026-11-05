"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { liveGate, resendKeys, twilioKeys } from "@/lib/live";
import { e164, sendEmail, sendText } from "@/lib/messaging/providers";
import { messagingStatus } from "@/lib/messaging/status";
import { can } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export async function saveFreeTextRoles(roles: string[]) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { ok: false, message: "Sign in again." };
  const { error } = await supabase.rpc("set_free_text_roles", { p_business_id: me.business_id, p_roles: roles });
  if (error) return { ok: false, message: error.code === "42501" ? "Only owners change this." : "That didn't save. Try again." };
  revalidatePath("/settings/messages");
  return { ok: true, message: "Saved." };
}

// Which answer "Let Maria know about the new time?" leans to after staff
// move a visit. Only the first button: neither sends without a tap.
export async function saveMoveMessageDefault(value: string) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "settings")) return { ok: false, message: "Only those who can change settings can change this." };
  if (value !== "send" && value !== "skip") return { ok: false, message: "Choose one." };
  const { data, error } = await supabase.from("businesses").update({ move_message_default: value }).eq("id", me.business_id).select("id");
  if (error || !data.length) return { ok: false, message: "That didn't save. Try again." };
  revalidatePath("/settings/messages");
  return { ok: true, message: "Saved." };
}

export type LiveResult = { ok: boolean; message: string };

// "Go live" for texts and email (owners): only on the production site with
// at least one of them connected (lib/messaging/status.ts); the database
// checks who and logs it.
export async function setMessagesLive(on: boolean): Promise<LiveResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "billing")) return { ok: false, message: "Only owners turn this on or off." };
  if (on) {
    const { data: b } = await supabase.from("businesses").select("messages_live").eq("id", me.business_id).single();
    const why = messagingStatus({ messages_live: b?.messages_live ?? false }).cantGoLive;
    if (why) return { ok: false, message: why };
  }
  const { error } = await supabase.rpc("set_go_live", { p_kind: "messages", p_on: on });
  if (error) return { ok: false, message: error.code === "42501" ? "Only owners turn this on or off." : "That didn't save. Try again." };
  revalidatePath("/settings/messages");
  return { ok: true, message: on ? "You're live: messages now go to clients." : "Turned off: messages wait in the outbox again." };
}

// A test text or email to an address the owner types (their own), to check
// the connection before going live. It goes out for real only on the
// production site with that channel connected, and never to a client;
// anywhere else it lands in the outbox. Five every 10 minutes.
export async function sendTestMessage(channel: "sms" | "email", to: string): Promise<LiveResult> {
  const { staff: me } = await getCurrentStaff();
  if (!me || !can(me, "billing")) return { ok: false, message: "Only owners send a test." };
  const address = to.trim();
  if (channel === "sms" ? !e164(address) : !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
    return { ok: false, message: channel === "sms" ? "Enter a US mobile number." : "Enter an email address." };
  }
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("hit_rate_limit", { p_key: `test-send:${me.business_id}`, p_limit: 5, p_window_seconds: 600 });
  if (!allowed) return { ok: false, message: "That's a lot of tests. Try again in a few minutes." };
  const { data: b } = await admin.from("businesses").select("name").eq("id", me.business_id).single();
  const salon = b?.name ?? "your salon";
  const body = `This is a test from Maestra for ${salon}. If you got it, ${channel === "sms" ? "texts" : "email"} to your clients will work.`;

  const gate = liveGate();
  const twilio = twilioKeys();
  const resend = resendKeys();
  if (gate.open && (channel === "sms" ? twilio : resend)) {
    const sent =
      channel === "sms"
        ? await sendText(twilio!, { to: address, body, statusCallback: null })
        : await sendEmail(resend!, { salon, to: address, subject: "Maestra test email", text: body, html: null, idempotencyKey: `test-${randomUUID()}` });
    if (sent.ok) return { ok: true, message: `Sent. Check ${channel === "sms" ? "that phone" : "that inbox"}.` };
    return { ok: false, message: `It didn't send (${sent.code}). ${sent.retry ? "Try again in a minute." : "Let the Maestra team know."}` };
  }
  const { error } = await admin.from("outbox_messages").insert({ business_id: me.business_id, channel, to_address: address, subject: channel === "email" ? "Maestra test email" : null, body });
  if (error) return { ok: false, message: "That didn't work. Try again." };
  return { ok: true, message: gate.open ? `${channel === "sms" ? "Texts aren't" : "Email isn't"} connected yet, so the test went to the outbox.` : "This copy never sends real messages, so the test went to the outbox." };
}
