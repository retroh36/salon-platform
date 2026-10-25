"use server";

import { getCurrentStaff } from "@/lib/auth";
import { previewTemplate, sendStaffMessage, type MessageInput } from "@/lib/messaging/send";
import { isStaffTemplate } from "@/lib/messaging/templates";

// What a quick pick will say for this visit (filled in by our code).
export async function previewClientMessage(input: Pick<MessageInput, "appointmentId" | "template" | "channel" | "minutes" | "time">) {
  const { supabase } = await getCurrentStaff();
  if (!isStaffTemplate(input.template)) return null;
  return previewTemplate(supabase, input);
}

// Message client: a quick pick or what they wrote, through the consent
// rules (send_client_message checks them again, and who may write).
export async function sendClientMessage(input: MessageInput) {
  const { supabase } = await getCurrentStaff();
  const result = await sendStaffMessage(supabase, input);
  return result.ok ? { ok: true as const, message: `Sent by ${result.channel === "sms" ? "text" : "email"}.` } : result;
}
