import { redirect } from "next/navigation";
import { cache } from "react";
import { homeFor, type StaffRole } from "@/lib/staff";
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
      "id, first_name, role, business_id, calendar_zoom, assists_staff_id, location:locations(id, name, city, region, timezone, business:businesses(name, logo_path, auto_lock_minutes))",
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!staff?.location) return { supabase, staff: null };
  // What they can do, as the database sees it (lib/permissions.ts).
  const { data: permissions, error: permError } = await supabase.rpc("my_permissions", { p_business_id: staff.business_id });
  if (permError) throw permError;
  return { supabase, staff: { ...staff, location: staff.location, permissions: permissions ?? [] } };
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
