// Logins for the team: an invite gives someone on the team a login and
// emails them a link to choose a password (Supabase Auth's invite email,
// our template in supabase/templates/); a reset emails a link to choose a
// new one. Server only.
//
// Inviting needs the service role (creating a login), so it's the one
// staff action that uses it, and only after checking, with the person's
// own login, that they may manage this team member. A reset needs nothing
// special (it's the same email as "Forgot password?").

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { DEMO_OFF, isDemo } from "@/lib/demo";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StaffRole } from "@/lib/staff";
import { canManageMember, canResetPassword, loginState } from "./team";

type Supabase = SupabaseClient<Database>;
type Me = { id: string; role: StaffRole; business_id: string; permissions: readonly string[] };

export type LoginResult = { ok: true; message: string } | { ok: false; message: string };

const NOT_ALLOWED = "Only owners and managers can manage the team (and only owners can manage owners).";

async function memberOf(supabase: Supabase, me: Me, staffId: string) {
  const { data, error } = await supabase.from("staff").select("id, first_name, email, role, is_active, user_id").eq("id", staffId).eq("business_id", me.business_id).maybeSingle();
  if (error) throw error;
  return data;
}

async function loginOf(supabase: Supabase, me: Me, staffId: string) {
  const { data, error } = await supabase.rpc("team_logins", { p_business_id: me.business_id });
  if (error) throw error;
  return (data ?? []).find((l) => l.staff_id === staffId) ?? null;
}

// A first login, or the invite again for someone who hasn't signed in yet.
export async function inviteMember(supabase: Supabase, me: Me, staffId: string): Promise<LoginResult> {
  if (isDemo()) return { ok: false, message: DEMO_OFF.invites };
  const member = await memberOf(supabase, me, staffId);
  if (!member || !canManageMember(me, member)) return { ok: false, message: NOT_ALLOWED };
  if (!member.is_active) return { ok: false, message: `${member.first_name} is deactivated. Reactivate them first.` };
  if (member.user_id) {
    const login = await loginOf(supabase, me, staffId);
    if (loginState(login) === "active") return { ok: false, message: `${member.first_name} already signs in.` };
    // Invited before: a fresh link to choose a password.
    const { error } = await supabase.auth.resetPasswordForEmail(login?.email ?? member.email ?? "");
    if (error) return { ok: false, message: "The invite didn't send. Try again in a minute." };
    return { ok: true, message: `Sent ${member.first_name} the invite again.` };
  }
  if (!member.email) return { ok: false, message: `Add ${member.first_name}'s email first.` };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(member.email);
  if (error) {
    if (error.code === "email_exists" || /already been registered/i.test(error.message)) {
      return { ok: false, message: "That email already has a Maestra login. Use another email for them, or ask us to link it." };
    }
    return { ok: false, message: "The invite didn't send. Try again in a minute." };
  }
  const { error: linkError } = await admin.from("staff").update({ user_id: data.user.id }).eq("id", staffId).eq("business_id", me.business_id);
  if (linkError) throw linkError;
  return { ok: true, message: `Invited ${member.first_name}. They'll get an email to choose a password.` };
}

// A link to choose a new password, to the email they sign in with (owners).
export async function resetMemberPassword(supabase: Supabase, me: Me, staffId: string): Promise<LoginResult> {
  if (!canResetPassword(me)) return { ok: false, message: "Only owners can reset someone's password." };
  if (isDemo()) return { ok: false, message: DEMO_OFF.passwords };
  const member = await memberOf(supabase, me, staffId);
  if (!member) return { ok: false, message: NOT_ALLOWED };
  const login = await loginOf(supabase, me, staffId);
  if (!login?.email) return { ok: false, message: `${member.first_name} doesn't have a login yet. Send an invite instead.` };
  const { error } = await supabase.auth.resetPasswordForEmail(login.email);
  if (error) return { ok: false, message: "The email didn't send. Try again in a minute." };
  return { ok: true, message: `Sent ${member.first_name} a link to choose a new password.` };
}
