"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { copyName, parseGroupSwitches, switchesOf } from "@/lib/permission-groups";
import { isUuid } from "@/lib/ids";

export type GroupResult = { ok: true; message: string; id?: string } | { ok: false; message: string };

const OWNERS = "Only owners change permission groups.";

function refresh() {
  revalidatePath("/team/permissions");
  revalidatePath("/team", "layout");
}

// Make or change a group from its form: name, and each switch on, off or
// the role's default.
export async function saveGroup(id: string | null, form: FormData): Promise<GroupResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (me?.role !== "owner" || (id !== null && !isUuid(id))) return { ok: false, message: OWNERS };
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 60) return { ok: false, message: "Give the group a name (60 characters at most)." };
  const { data, error } = await supabase.rpc("save_permission_group", { p_business_id: me.business_id, p_id: id as string, p_name: name, p_permissions: parseGroupSwitches(form) });
  if (error?.code === "42501") return { ok: false, message: OWNERS };
  if (error?.hint === "name_taken") return { ok: false, message: "There's already a group with that name." };
  if (error?.code === "P0002") return { ok: false, message: "That group was removed. Reload the page." };
  if (error) throw error;
  refresh();
  return { ok: true, message: id ? "Saved. It applies to everyone in the group the next time they open a page." : "Group added.", id: data };
}

// A copy of a group with the same switches, and no one in it yet.
export async function copyGroup(id: string): Promise<GroupResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (me?.role !== "owner" || !isUuid(id)) return { ok: false, message: OWNERS };
  const { data: groups, error: loadError } = await supabase.from("permission_groups").select("id, name, permissions").eq("business_id", me.business_id);
  if (loadError) throw loadError;
  const group = groups.find((g) => g.id === id);
  if (!group) return { ok: false, message: "That group was removed. Reload the page." };
  const name = copyName(group.name, groups.map((g) => g.name));
  const { data, error } = await supabase.rpc("save_permission_group", { p_business_id: me.business_id, p_id: null as unknown as string, p_name: name, p_permissions: switchesOf(group.permissions) });
  if (error?.code === "42501") return { ok: false, message: OWNERS };
  if (error) throw error;
  refresh();
  return { ok: true, message: `Copied as "${name}".`, id: data };
}

export async function deleteGroup(id: string): Promise<GroupResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (me?.role !== "owner" || !isUuid(id)) return { ok: false, message: OWNERS };
  const { error } = await supabase.rpc("delete_permission_group", { p_id: id });
  if (error?.code === "42501") return { ok: false, message: OWNERS };
  if (error) throw error;
  refresh();
  return { ok: true, message: "Group removed. Its people are back to their role's defaults." };
}

// Put someone in a group, or none.
export async function setMemberGroup(staffId: string, groupId: string | null): Promise<GroupResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (me?.role !== "owner" || !isUuid(staffId) || (groupId !== null && !isUuid(groupId))) return { ok: false, message: "Only owners change someone's permission group." };
  const { error } = await supabase.rpc("set_staff_permission_group", { p_staff_id: staffId, p_group_id: groupId as string });
  if (error?.code === "42501") return { ok: false, message: "Only owners change someone's permission group." };
  if (error?.code === "22023") return { ok: false, message: "Owners can always do everything." };
  if (error?.code === "P0002") return { ok: false, message: "That group was removed. Reload the page." };
  if (error) throw error;
  refresh();
  revalidatePath(`/team/${staffId}`);
  return { ok: true, message: groupId ? "Saved. It applies the next time they open a page." : "Saved. They follow their role's defaults." };
}
