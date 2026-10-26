"use server";

// The public demo's server actions: a tester's feedback, and one-tap
// sign-in as a demo account (lib/demo.ts). Both refuse unless DEMO_MODE is
// on, and both are rate limited per connection.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_CLIENT, DEMO_LOGINS, isDemo, safePath } from "@/lib/demo";
import { ACCOUNT_COOKIE, startAccountSession } from "@/lib/online-booking/account";
import { requestInfo, withinLimits } from "@/lib/online-booking/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { todayIn, toLocal } from "@/lib/scheduling/time";
import { createClient } from "@/lib/supabase/server";

export type FeedbackResult = { ok: true } | { ok: false; message: string };

const ROLE_NAMES: Record<string, string> = { owner: "Owner", manager: "Manager", front_desk: "Front desk", stylist: "Stylist", assistant: "Assistant" };

// Who sent it: the staff member's role and salon, a client signed in on the
// booking site, or someone signed out.
async function sender(): Promise<{ role: string; salon: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data } = await supabase.from("staff").select("role, business:businesses(name)").eq("user_id", user.id).maybeSingle();
    if (data) return { role: ROLE_NAMES[data.role] ?? data.role, salon: data.business?.name ?? null };
  }
  if ((await cookies()).get(ACCOUNT_COOKIE)) return { role: "Client", salon: null };
  return { role: "Signed out", salon: null };
}

export async function sendFeedback(input: { note: string; name: string; page: string }): Promise<FeedbackResult> {
  if (!isDemo()) return { ok: false, message: "Feedback is only for the demo." };
  const note = String(input.note ?? "").trim();
  const name = String(input.name ?? "").trim();
  if (!note) return { ok: false, message: "Type a note first." };
  if (note.length > 2000) return { ok: false, message: "Keep it under 2,000 characters." };
  if (name.length > 80) return { ok: false, message: "Keep your name under 80 characters." };
  const admin = createAdminClient();
  const { ipHash } = await requestInfo();
  if (!(await withinLimits(admin, [{ key: `feedback:${ipHash}`, limit: 10, windowSeconds: 600 }]))) {
    return { ok: false, message: "That's a lot of notes at once. Wait a few minutes, then send it." };
  }
  const who = await sender();
  const { error } = await admin.from("demo_feedback").insert({ note, name: name || null, page: safePath(String(input.page ?? "/")), role: who.role, salon: who.salon });
  if (error) throw error;
  return { ok: true };
}

export type DemoLoginState = { error: string } | undefined;

// Signs in as one of the demo accounts with a one-time link made on the
// server, like the shared iPad's PIN switch: no password, no email.
export async function demoSignIn(_prev: DemoLoginState, formData: FormData): Promise<DemoLoginState> {
  if (!isDemo()) return { error: "One-tap sign-in is only for the demo." };
  const key = String(formData.get("account") ?? "");
  const admin = createAdminClient();
  const { ipHash } = await requestInfo();
  if (!(await withinLimits(admin, [{ key: `demo-login:${ipHash}`, limit: 30, windowSeconds: 600 }]))) {
    return { error: "Too many sign-ins from here. Wait a few minutes, then try again." };
  }

  if (key === "client") {
    const { data: business, error } = await admin.from("businesses").select("id").eq("slug", DEMO_CLIENT.slug).single();
    if (error) throw error;
    const { data: client, error: clientError } = await admin.from("clients").select("id").eq("business_id", business.id).eq("email", DEMO_CLIENT.email).single();
    if (clientError) throw clientError;
    await startAccountSession(admin, business.id, client.id, "email", DEMO_CLIENT.slug, ipHash);
    redirect(`/book/${DEMO_CLIENT.slug}/account`);
  }

  const login = DEMO_LOGINS.find((l) => l.key === key);
  if (!login) return { error: "Choose who to sign in as." };
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: login.email });
  if (linkError) throw linkError;
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (verifyError) throw verifyError;
  redirect(login.goTo === "/calendar" ? await busyCalendar(admin, login.email) : login.goTo);
}

// The calendar on the salon's next day with visits (today unless it's
// closed, as Maple & Ash is on Sundays and Mondays).
async function busyCalendar(admin: ReturnType<typeof createAdminClient>, email: string): Promise<string> {
  const { data: me } = await admin.from("staff").select("location:locations(id, timezone)").eq("email", email).maybeSingle();
  const location = me?.location;
  if (!location) return "/calendar";
  const today = todayIn(location.timezone);
  const { data: next } = await admin
    .from("appointments")
    .select("starts_at")
    .eq("location_id", location.id)
    .gte("starts_at", startOfLocalDay(today, location.timezone).toISOString())
    .not("status", "in", "(canceled,no_show)")
    .order("starts_at")
    .limit(1)
    .maybeSingle();
  const day = next ? toLocal(new Date(next.starts_at), location.timezone).date : today;
  return day === today ? "/calendar" : `/calendar?date=${day}`;
}
