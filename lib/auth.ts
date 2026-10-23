import { redirect } from "next/navigation";
import { cache } from "react";
import type { StaffRole } from "@/lib/staff";
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
      "id, first_name, role, business_id, calendar_zoom, location:locations(id, name, city, region, timezone, business:businesses(name, logo_path))",
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return { supabase, staff: staff?.location ? { ...staff, location: staff.location } : null };
});

const MANAGER_ROLES: StaffRole[] = ["owner", "manager"];

// Owners and managers manage the menu, staff and settings. The database
// enforces the same rule through RLS; this only decides what UI to show.
export function canManage(role: StaffRole): boolean {
  return MANAGER_ROLES.includes(role);
}
