"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { deviceTokenHash } from "@/lib/shared-device";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type SwitchState = { error: string; staffId: string } | undefined;

// Switching to someone on the shared iPad: the device and their PIN are
// checked by the database (check_staff_pin: five wrong locks them out for
// five minutes, every try logged), then they're signed in with a one-time
// link made on the server, so no password is typed and no email is sent.
export async function switchUser(_prev: SwitchState, formData: FormData): Promise<SwitchState> {
  const staffId = String(formData.get("staff_id") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const hash = await deviceTokenHash();
  if (!hash) redirect("/login");
  if (!isUuid(staffId)) return { error: "Choose who you are.", staffId: "" };
  if (!/^[0-9]{4,6}$/.test(pin)) return { error: "Enter your 4 to 6 digit PIN.", staffId };

  const admin = createAdminClient();
  // Thirty tries a device every ten minutes, whoever they're for.
  const { data: allowed, error: limitError } = await admin.rpc("hit_rate_limit", { p_key: `pin:${hash}`, p_limit: 30, p_window_seconds: 600 });
  if (limitError) throw limitError;
  if (!allowed) return { error: "Too many tries on this iPad. Wait a few minutes.", staffId };

  const { data, error } = await admin.rpc("check_staff_pin", { p_token_hash: hash, p_staff_id: staffId, p_pin: pin });
  if (error) throw error;
  const result = data as { ok: boolean; reason?: string; left?: number; email?: string };
  if (!result.ok) {
    if (result.reason === "locked") return { error: "Too many wrong PINs. Try again in 5 minutes, or sign in with your password.", staffId };
    if (result.reason === "needs_six") return { error: "Owners and managers use a 6-digit PIN. Sign in with your password and set one on Your account.", staffId };
    if (result.reason === "wrong") return { error: result.left === 1 ? "That PIN isn't right. One more try before a short lockout." : "That PIN isn't right.", staffId };
    return { error: "That person can't switch in here.", staffId: "" };
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: result.email! });
  if (linkError) throw linkError;
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (verifyError) throw verifyError;
  redirect("/dashboard");
}
