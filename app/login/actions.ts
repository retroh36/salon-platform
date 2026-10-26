"use server";

import { redirect } from "next/navigation";
import { DEMO_OFF, isDemo } from "@/lib/demo";
import { requestInfo, withinLimits } from "@/lib/online-booking/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string; email: string } | undefined;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password.", email };
  }

  // The public demo's logins are known, so tries are limited per connection.
  if (isDemo()) {
    const { ipHash } = await requestInfo();
    if (!(await withinLimits(createAdminClient(), [{ key: `login:${ipHash}`, limit: 20, windowSeconds: 600 }]))) {
      return { error: "Too many tries from here. Wait a few minutes, then try again.", email };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Same message for unknown email and wrong password.
    return { error: "That email and password don't match.", email };
  }

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type ForgotState = { sent: boolean; email: string; error?: string } | undefined;

// "Forgot password?": a link to choose a new one. The same answer whether
// or not the email has a login (so it doesn't tell anyone who does).
export async function forgotPassword(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (isDemo()) return { sent: false, email, error: DEMO_OFF.passwords };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { sent: false, email, error: "Enter the email you sign in with." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  // Too many tries is the one thing worth saying.
  if (error?.status === 429) return { sent: false, email, error: "Too many tries. Wait a few minutes, then try again." };
  return { sent: true, email };
}

export type PasswordState = { error: string } | undefined;

// Choosing a password, after an invite or a reset link signed them in.
export async function choosePassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  if (isDemo()) return { error: DEMO_OFF.passwords };
  const password = String(formData.get("password") ?? "");
  const again = String(formData.get("password_again") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== again) return { error: "The two passwords don't match." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error?.code === "same_password") return { error: "Choose a password you haven't used for this account." };
  if (error?.code === "weak_password") return { error: "Choose a stronger password." };
  if (error) return { error: "That didn't save. Open the link from your email again." };
  redirect("/dashboard");
}
