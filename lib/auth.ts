import { loadLevels } from "@/lib/levels";
import { redirect } from "next/navigation";
import { cache } from "react";
import { headers } from "next/headers";
import { bookkeeperHome, bookkeeperMayOpen, homeFor, type StaffRole } from "@/lib/staff";
import { PATH_HEADER } from "@/lib/path-header";
import { createClient } from "@/lib/supabase/server";

// The signed-in user's staff record, with their location and business.
// Cached per request, so pages and components can call it freely. Redirects
// to /login when signed out; returns staff: null when the account isn't
// linked to a salon.
export const getCurrentStaff = cache(async () => {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims.sub;
  if (!userId) redirect("/login");

  const { data: staff, error } = await supabase
    .from("staff")
    .select(
      "id, first_name, last_name, role, level, color, photo_path, business_id, calendar_zoom, assists_staff_id, location:locations(id, name, city, region, timezone, business:businesses(name, logo_path, auto_lock_minutes))",
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!staff?.location) return { supabase, staff: null };
  // What they can do, as the database sees it (lib/permissions.ts), and
  // the salon's levels (lib/levels.ts).
  const [{ data: permissions, error: permError }, levels] = await Promise.all([
    supabase.rpc("my_permissions", { p_business_id: staff.business_id }),
    loadLevels(supabase, staff.business_id),
  ]);
  if (permError) throw permError;
  // A bookkeeper sees the money and nothing of the calendar or clients:
  // anywhere else goes to their first page (before the page loads anything).
  if (staff.role === "bookkeeper") {
    const path = (await headers()).get(PATH_HEADER);
    if (path && !bookkeeperMayOpen(path)) redirect(bookkeeperHome(permissions ?? []));
  }
  return { supabase, staff: { ...staff, location: staff.location, permissions: permissions ?? [], levels } };
});

// Where a sign-in goes: the calendar, or My day for stylists and assistants
// (homeFor), looked up straight after signing in (getCurrentStaff is cached
// for the request, from before). Not linked: the calendar says so.
export async function landingFor(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string> {
  const { data } = await supabase.from("staff").select("role").eq("user_id", userId).eq("is_active", true).limit(1).maybeSingle();
  return data ? homeFor(data.role) : "/calendar";
}

const MANAGER_ROLES: StaffRole[] = ["owner", "manager"];

// Owners and managers manage the menu and inventory. The database enforces
// the same rule through RLS; this only decides what UI to show. Settings,
// the team, payroll and reports are permissions (lib/permissions.ts).
export function canManage(role: StaffRole): boolean {
  return MANAGER_ROLES.includes(role);
}
