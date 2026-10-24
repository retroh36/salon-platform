"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { isToggle } from "@/lib/permissions";
import { isUuid } from "@/lib/ids";
import type { StaffRole } from "@/lib/staff";
import { canManageMember, parseMemberForm, rolesFor, type MemberErrors } from "@/lib/team";
import { inviteMember, resetMemberPassword, type LoginResult } from "@/lib/team-logins";

// Each action checks the role; the database (RLS and save_team_member)
// enforces the same underneath.

export type MemberState = { errors?: MemberErrors; message?: string; saved?: boolean } | undefined;

const NOT_ALLOWED = "Only owners and managers can manage the team, and only owners can manage owners.";

function refresh() {
  revalidatePath("/team", "layout");
  revalidatePath("/schedule", "layout");
  revalidatePath("/calendar", "layout");
}

// Adds someone (staffId null) or saves their details, role, level and
// services. A new member can be invited straight away.
export async function saveMember(staffId: string | null, _prev: MemberState, formData: FormData): Promise<MemberState> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || (staffId !== null && !isUuid(staffId))) return { message: NOT_ALLOWED };
  let target: { role: StaffRole } | null = null;
  if (staffId) {
    const { data } = await supabase.from("staff").select("role").eq("id", staffId).eq("business_id", me.business_id).maybeSingle();
    if (!data) return { message: "They're no longer on the team." };
    target = data;
  }
  if (!canManageMember(me, target)) return { message: NOT_ALLOWED };
  // Your own role stays as it is (the form doesn't offer it).
  const allowed = staffId === me.id ? [me.role] : rolesFor(me);
  const parsed = parseMemberForm(formData, allowed);
  if (!parsed.ok) return { errors: parsed.errors, message: "Fix the highlighted fields." };
  if (formData.get("invite") && !parsed.input.email) return { errors: { email: "Add their email to send an invite." }, message: "Fix the highlighted fields." };

  const { data: id, error } = await supabase.rpc("save_team_member", {
    p_business_id: me.business_id,
    p_location_id: me.location.id,
    p_staff_id: staffId!,
    p_input: parsed.input as never,
  });
  if (error?.code === "42501") return { message: NOT_ALLOWED };
  if (error?.code === "55000") return { message: error.message === "The salon needs an owner" ? "The salon needs an owner: make someone else an owner first." : "You can't change your own role." };
  if (error?.code === "23505") return { errors: { email: "Someone on the team already has that login." }, message: "Fix the highlighted fields." };
  if (error) throw error;
  refresh();

  if (!staffId) {
    let note = "added";
    if (formData.get("invite")) note = (await inviteMember(supabase, me, id)).ok ? "invited" : "invite_failed";
    redirect(`/team/${id}?done=${note}`);
  }
  return { saved: true, message: "Saved." };
}

// Someone leaving (deactivate) or coming back.
export async function setMemberActive(staffId: string, active: boolean): Promise<LoginResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(staffId)) return { ok: false, message: NOT_ALLOWED };
  const { error } = await supabase.rpc("set_staff_active", { p_staff_id: staffId, p_active: active });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "55000") return { ok: false, message: error.message === "The salon needs an owner" ? "The salon needs an owner: make someone else an owner first." : "You can't deactivate yourself." };
  if (error) throw error;
  refresh();
  return { ok: true, message: active ? "Reactivated." : "Deactivated. Their history stays, and they can't sign in or be booked." };
}

export async function inviteTeamMember(staffId: string): Promise<LoginResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(staffId)) return { ok: false, message: NOT_ALLOWED };
  const result = await inviteMember(supabase, me, staffId);
  refresh();
  return result;
}

export async function resetTeamPassword(staffId: string): Promise<LoginResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(staffId)) return { ok: false, message: NOT_ALLOWED };
  return resetMemberPassword(supabase, me, staffId);
}

// Owners fine-tune what one person can do (lib/permissions.ts); back to
// what their role allows when it matches the default.
export async function setMemberPermission(staffId: string, permission: string, allowed: boolean): Promise<LoginResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (me?.role !== "owner" || !isUuid(staffId) || !isToggle(permission)) return { ok: false, message: "Only owners change what someone can do." };
  const { error } = await supabase.rpc("set_staff_permission", { p_staff_id: staffId, p_permission: permission, p_allowed: allowed });
  if (error?.code === "42501" || error?.code === "22023") return { ok: false, message: error.code === "22023" ? "That can't be changed for this role." : "Only owners change what someone can do." };
  if (error) throw error;
  refresh();
  return { ok: true, message: "Saved. It applies the next time they open a page." };
}

// Which stylist an assistant helps (whose day they see).
export async function setAssistantStylist(staffId: string, stylistId: string | null): Promise<LoginResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(staffId) || (stylistId !== null && !isUuid(stylistId))) return { ok: false, message: NOT_ALLOWED };
  const { error } = await supabase.rpc("set_assistant_stylist", { p_staff_id: staffId, p_stylist_id: stylistId as string });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "22023") return { ok: false, message: "Choose a stylist on the team." };
  if (error) throw error;
  refresh();
  return { ok: true, message: stylistId ? "Saved. They'll see that stylist's day." : "Saved. They're not assisting anyone." };
}

// Clears someone's PIN for the shared iPad (they set a new one themselves).
export async function clearMemberPin(staffId: string): Promise<LoginResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(staffId)) return { ok: false, message: NOT_ALLOWED };
  const { error } = await supabase.rpc("clear_staff_pin", { p_staff_id: staffId });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error) throw error;
  refresh();
  return { ok: true, message: "PIN cleared. They can set a new one on Your account." };
}
