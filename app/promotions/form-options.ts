import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fullName } from "@/lib/staff";
import type { FormOptions } from "./promotion-form";

// The salon's services, stylists and retail products, for the form.
export async function formOptions(supabase: SupabaseClient<Database>, businessId: string): Promise<FormOptions> {
  const [services, staff, products] = await Promise.all([
    supabase.from("services").select("id, name, category").eq("business_id", businessId).is("archived_at", null).order("category").order("name"),
    supabase.from("staff").select("id, first_name, last_name, level").eq("business_id", businessId).eq("is_active", true).not("level", "is", null).order("first_name"),
    supabase.from("products").select("id, brand, line, name").eq("business_id", businessId).eq("type", "retail").eq("is_active", true).order("brand"),
  ]);
  return {
    services: services.data ?? [],
    staff: (staff.data ?? []).map((s) => ({ id: s.id, name: fullName(s) })),
    products: (products.data ?? []).map((p) => ({ id: p.id, name: [p.brand, p.line, p.name].filter(Boolean).join(" ") })),
  };
}
