"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { withOptOut } from "@/lib/automations";
import { siteUrl } from "@/lib/branding";
import { channelFor, consentOf } from "@/lib/messaging/consent";
import { CONSENT_COLUMNS } from "@/lib/messaging/send";
import { can } from "@/lib/permissions";
import { specialDraft } from "@/lib/promotion-ideas-load";
import { parsePromotionInput, type PromotionInput } from "@/lib/promotions";
import { isFrontOfHouse } from "@/lib/staff";
import { isLocalDate } from "@/lib/scheduling/time";

export type Result = { ok: true; id?: string; message?: string } | { ok: false; message: string };

// Owners and managers set promotions up (save_promotion checks again).
export async function savePromotion(id: string | null, input: PromotionInput): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "settings")) return { ok: false, message: "Only owners and managers can set up promotions." };
  const parsed = parsePromotionInput(input);
  if (!parsed.ok) return parsed;
  const { data, error } = await supabase.rpc("save_promotion", { p_business_id: me.business_id, p_promotion_id: id as never, p_input: parsed.row as never });
  if (error) {
    if (["23505", "22023", "42501", "P0002"].includes(error.code)) return { ok: false, message: `${error.message}.` };
    throw error;
  }
  revalidatePath("/promotions");
  return { ok: true, id: data as string };
}

export async function archivePromotion(id: string): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "settings")) return { ok: false, message: "Only owners and managers can end promotions." };
  const { error } = await supabase.rpc("archive_promotion", { p_promotion_id: id });
  if (error) {
    if (["22023", "42501", "P0002"].includes(error.code)) return { ok: false, message: `${error.message}.` };
    throw error;
  }
  revalidatePath("/promotions");
  return { ok: true };
}

// Sends a special to a client about an opening: our template (or what the
// staff member wrote, when their role may), to clients who said yes to
// offers, with the unsubscribe link. send_promotion_message checks
// consent, sending hours and the one-a-week limit again.
export async function sendSpecial(input: { promotionId: string; clientId: string; staffId: string; date: string; start: number; body?: string }): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isFrontOfHouse(me.role)) return { ok: false, message: "Only the front of house can send offers." };
  if (!isLocalDate(input.date) || !Number.isInteger(input.start)) return { ok: false, message: "Choose an opening." };
  const draft = await specialDraft(supabase, me, { ...input, date: input.date });
  if (!draft) return { ok: false, message: "That promotion or client isn't available." };
  const { data: client } = await supabase.from("clients").select(CONSENT_COLUMNS).eq("id", input.clientId).maybeSingle();
  const to = client ? channelFor(consentOf(client), "marketing") : null;
  if (!to) return { ok: false, message: "They haven't said yes to offers by text or email." };
  const written = input.body?.trim();
  const custom = Boolean(written && written !== draft.body);
  const token = randomBytes(24).toString("base64url");
  const body = withOptOut(custom ? written! : draft.body, to.channel, `${siteUrl()}/unsubscribe/${token}`);
  const { error } = await supabase.rpc("send_promotion_message", {
    p_promotion_id: input.promotionId,
    p_client_id: input.clientId,
    p_channel: to.channel,
    p_template: custom ? "custom" : "special",
    p_subject: draft.subject,
    p_body: body,
    p_opt_out_hash: createHash("sha256").update(token).digest("hex"),
  });
  if (error) {
    if (["42501", "55000", "22023", "P0002"].includes(error.code)) return { ok: false, message: `${error.message}.` };
    throw error;
  }
  revalidatePath("/promotions");
  return { ok: true, message: `Sent by ${to.channel === "sms" ? "text" : "email"}.` };
}
