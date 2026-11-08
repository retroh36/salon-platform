"use server";

// "Let Ava know their fee was waived?" (lib/grace-message.ts): the salon's
// grace message for booking details and Denise's card, then Send or Don't
// send. Front of house only; nothing goes out without Send.

import { revalidatePath } from "next/cache";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { graceAsks, sendGrace, skipGrace, type GraceAsk, type GraceSendResult } from "@/lib/grace-message";
import { isUuid } from "@/lib/ids";
import type { Channel } from "@/lib/messaging/consent";

export type GraceAsks = { asks: GraceAsk[]; freeText: boolean; askDefault: "send" | "skip" };

async function desk() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me && canBook(me.role) ? { supabase, me } : null;
}

function refresh() {
  revalidatePath("/calendar", "layout");
  revalidatePath("/policy");
  revalidatePath("/clients", "layout");
}

export async function loadGraceAsks(feeIds: string[]): Promise<GraceAsks> {
  const s = await desk();
  const ids = Array.isArray(feeIds) ? feeIds.filter(isUuid).slice(0, 20) : [];
  if (!s || !ids.length) return { asks: [], freeText: false, askDefault: "send" };
  const [asks, { data: business }] = await Promise.all([
    graceAsks(s.supabase, ids),
    s.supabase.from("businesses").select("free_text_roles, move_message_default").eq("id", s.me.business_id).maybeSingle(),
  ]);
  return {
    asks,
    freeText: s.me.role === "owner" || Boolean(business?.free_text_roles.includes(s.me.role)),
    askDefault: business?.move_message_default === "skip" ? "skip" : "send",
  };
}

export async function sendGraceMessage(input: { feeId: string; channel: Channel; edited: string | null }): Promise<GraceSendResult> {
  const s = await desk();
  if (!s) return { ok: false, message: "Only owners, managers and front desk can message clients about a fee." };
  if (!isUuid(input.feeId) || (input.channel !== "sms" && input.channel !== "email")) return { ok: false, message: "Choose the visit again." };
  const r = await sendGrace(s.supabase, input.feeId, input.channel, typeof input.edited === "string" ? input.edited : null);
  if (r.ok) refresh();
  return r;
}

export async function skipGraceMessage(feeId: string): Promise<GraceSendResult> {
  const s = await desk();
  if (!s) return { ok: false, message: "Only owners, managers and front desk can decide about a fee's message." };
  if (!isUuid(feeId)) return { ok: false, message: "Choose the visit again." };
  const r = await skipGrace(s.supabase, feeId);
  if (r.ok) refresh();
  return r;
}
