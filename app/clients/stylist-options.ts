import type { createClient } from "@/lib/supabase/server";
import { fullName, sortStaff } from "@/lib/staff";
import type { StylistOption } from "./client-form";

// Active staff, plus the client's current preferred stylist even if they've
// since become inactive, so the form doesn't silently drop them.
export async function stylistOptions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  keepId?: string | null,
): Promise<StylistOption[]> {
  const { data, error } = await supabase.from("staff").select("id, first_name, last_name, role, is_active");
  if (error) throw error;
  return sortStaff(data.filter((s) => s.is_active || s.id === keepId)).map((s) => ({
    id: s.id,
    name: s.is_active ? fullName(s) : `${fullName(s)} (inactive)`,
  }));
}
