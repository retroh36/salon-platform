"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { LOGO_BUCKET, LOGO_TYPES, MAX_LOGO_BYTES } from "@/lib/branding";

export type SettingsResult = { ok: true; message: string } | { ok: false; message: string };
const OWNERS_ONLY = "Only owners can change the salon's name and logo.";

async function owner() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me?.role === "owner" ? { supabase, me } : null;
}

function refresh() {
  // The name and logo are on every page.
  revalidatePath("/", "layout");
}

export async function saveSalonName(name: string): Promise<SettingsResult> {
  const s = await owner();
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
  const s = await owner();
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
  const s = await owner();
  if (!s) return { ok: false, message: OWNERS_ONLY };
  const { data: before } = await s.supabase.from("businesses").select("logo_path").eq("id", s.me.business_id).single();
  const { error } = await s.supabase.from("businesses").update({ logo_path: null }).eq("id", s.me.business_id);
  if (error) throw error;
  if (before?.logo_path) await s.supabase.storage.from(LOGO_BUCKET).remove([before.logo_path]);
  refresh();
  return { ok: true, message: "Removed the logo. The salon's initial shows instead." };
}

// How many tokens Denise may use a day (owners). 0 turns her thinking off.
export async function saveDeniseLimit(limit: number): Promise<SettingsResult> {
  const s = await owner();
  if (!s) return { ok: false, message: "Only owners can change Denise's limit." };
  if (!Number.isInteger(limit) || limit < 0 || limit > 50_000_000) return { ok: false, message: "Enter a whole number of tokens, up to 50,000,000." };
  const { error } = await s.supabase.from("businesses").update({ ai_daily_token_limit: limit }).eq("id", s.me.business_id);
  if (error) throw error;
  revalidatePath("/settings");
  return { ok: true, message: "Saved Denise's daily limit." };
}
