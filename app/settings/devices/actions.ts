"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, hashDeviceToken, newDeviceToken } from "@/lib/shared-device";

export type DeviceResult = { ok: true; message: string } | { ok: false; message: string };
const NOT_ALLOWED = "Only owners and managers set up shared devices.";

// Marks this device (the browser it's in) as the salon's shared iPad.
export async function shareThisDevice(name: string): Promise<DeviceResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: NOT_ALLOWED };
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) return { ok: false, message: "Give it a name, like Front desk iPad." };
  const token = newDeviceToken();
  const { error } = await supabase.rpc("register_shared_device", { p_location_id: me.location.id, p_name: trimmed, p_token_hash: hashDeviceToken(token) });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error) throw error;
  (await cookies()).set(DEVICE_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: DEVICE_COOKIE_MAX_AGE });
  revalidatePath("/", "layout");
  return { ok: true, message: `This device is now ${trimmed}. Anyone with a PIN can switch to themselves here.` };
}

// Stops sharing a device; it signs in the ordinary way again.
export async function removeDevice(deviceId: string): Promise<DeviceResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings") || !isUuid(deviceId)) return { ok: false, message: NOT_ALLOWED };
  const { error } = await supabase.rpc("revoke_shared_device", { p_device_id: deviceId });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error) throw error;
  revalidatePath("/settings/devices");
  return { ok: true, message: "Removed. It needs a password to sign in again." };
}

// This browser stops acting as shared (its record stays until removed).
export async function forgetThisDevice(): Promise<DeviceResult> {
  (await cookies()).delete(DEVICE_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true, message: "This device is no longer shared." };
}

export async function saveAutoLock(minutes: number): Promise<DeviceResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: NOT_ALLOWED };
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) return { ok: false, message: "Choose 1 to 60 minutes." };
  const { error } = await supabase.rpc("set_auto_lock", { p_business_id: me.business_id, p_minutes: minutes });
  if (error) throw error;
  revalidatePath("/", "layout");
  return { ok: true, message: `Shared devices lock after ${minutes} ${minutes === 1 ? "minute" : "minutes"} with nobody using them.` };
}
