"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { DEMO_OFF, isDemo } from "@/lib/demo";
import { LOGO_BUCKET, LOGO_TYPES, MAX_LOGO_BYTES } from "@/lib/branding";
import { can } from "@/lib/permissions";
import { everyTool } from "@/lib/denise/assistant";
import { CHAT_MODEL } from "@/lib/denise/claude";
import { claudeFor } from "@/lib/denise/day-state";
import { failureRef, logDeniseError } from "@/lib/denise/errors";
import { healthStatus, type HealthStatus } from "@/lib/denise/health";
import { DailyLimitReached } from "@/lib/denise/usage";

export type SettingsResult = { ok: true; message: string } | { ok: false; message: string };
const OWNERS_ONLY = "Only owners and managers can change the salon's name and logo.";

async function manager() {
  const { supabase, staff: me } = await getCurrentStaff();
  return can(me, "settings") ? { supabase, me } : null;
}

function refresh() {
  // The name and logo are on every page.
  revalidatePath("/", "layout");
}

export async function saveSalonName(name: string): Promise<SettingsResult> {
  const s = await manager();
  if (!s) return { ok: false, message: OWNERS_ONLY };
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) return { ok: false, message: "Enter the salon's name (up to 100 characters)." };
  const { data, error } = await s.supabase.from("businesses").update({ name: trimmed }).eq("id", s.me.business_id).select("id");
  if (error) throw error;
  if (!data.length) return { ok: false, message: OWNERS_ONLY };
  refresh();
  return { ok: true, message: "Saved the salon's name." };
}

// Stores the logo under the business id, then points the salon at it and
// removes the old one.
export async function uploadSalonLogo(formData: FormData): Promise<SettingsResult> {
  const s = await manager();
  if (!s) return { ok: false, message: OWNERS_ONLY };
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose an image." };
  const ext = LOGO_TYPES[file.type];
  if (!ext) return { ok: false, message: "Use a PNG, JPEG or WebP image." };
  if (file.size > MAX_LOGO_BYTES) return { ok: false, message: "Use an image up to 2 MB." };

  const path = `${s.me.business_id}/logo-${Date.now()}.${ext}`;
  const { error } = await s.supabase.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, message: "Couldn't upload that image. Try again." };
  const { data: before } = await s.supabase.from("businesses").select("logo_path").eq("id", s.me.business_id).single();
  const { error: updateError } = await s.supabase.from("businesses").update({ logo_path: path }).eq("id", s.me.business_id);
  if (updateError) throw updateError;
  if (before?.logo_path) await s.supabase.storage.from(LOGO_BUCKET).remove([before.logo_path]);
  refresh();
  return { ok: true, message: "Saved the salon's logo." };
}

export async function removeSalonLogo(): Promise<SettingsResult> {
  const s = await manager();
  if (!s) return { ok: false, message: OWNERS_ONLY };
  const { data: before } = await s.supabase.from("businesses").select("logo_path").eq("id", s.me.business_id).single();
  const { error } = await s.supabase.from("businesses").update({ logo_path: null }).eq("id", s.me.business_id);
  if (error) throw error;
  if (before?.logo_path) await s.supabase.storage.from(LOGO_BUCKET).remove([before.logo_path]);
  refresh();
  return { ok: true, message: "Removed the logo. The salon's initial shows instead." };
}

// How many tokens Denise may use a day (owners: it's billing). 0 turns her
// thinking off.
export async function saveDeniseLimit(limit: number): Promise<SettingsResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "billing")) return { ok: false, message: "Only owners can change Denise's limit." };
  if (isDemo()) return { ok: false, message: DEMO_OFF.limit };
  const s = { supabase, me };
  if (!Number.isInteger(limit) || limit < 0 || limit > 50_000_000) return { ok: false, message: "Enter a whole number of tokens, up to 50,000,000." };
  const { error } = await s.supabase.from("businesses").update({ ai_daily_token_limit: limit }).eq("id", s.me.business_id);
  if (error) throw error;
  revalidatePath("/settings");
  return { ok: true, message: "Saved Denise's daily limit." };
}

// Asks Denise's AI service one small question, with the same tools Ask
// Denise sends, so Settings says "Working" only when a real call works (the
// meter records the outcome either way; lib/denise/health.ts words it).
export async function checkDenise(): Promise<HealthStatus> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { kind: "unknown" };
  const client = claudeFor(me.business_id, "connection_check");
  if (!client) return { kind: "off" };
  try {
    await client.messages.create(
      { model: CHAT_MODEL, max_tokens: 16, tools: everyTool(), tool_choice: { type: "none" }, output_config: { effort: "low" }, messages: [{ role: "user", content: "Reply with the word OK." }] },
      { timeout: 20_000, maxRetries: 0 },
    );
  } catch (error) {
    if (error instanceof DailyLimitReached) return { kind: "failing", at: new Date().toISOString(), why: "Denise has used today's limit, so she's using plain wording until tomorrow." };
    logDeniseError(error, { where: "connection_check", businessId: me.business_id, model: CHAT_MODEL, ref: failureRef() });
  }
  const { data, error } = await supabase.from("ai_health").select("last_ok_at, last_failed_at, last_failure").eq("business_id", me.business_id).maybeSingle();
  if (error) throw error;
  return healthStatus(true, data && { lastOkAt: data.last_ok_at, lastFailedAt: data.last_failed_at, lastFailure: data.last_failure });
}
