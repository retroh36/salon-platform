import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeLike, parseClientSearch } from "@/lib/clients";
import type { Database } from "@/lib/database.types";

// Clients matching a name or phone search (see parseClientSearch), in name
// order, with the total number of matches. Used by the client list and the
// calendar's booking panel.
export async function searchClients(supabase: SupabaseClient<Database>, businessId: string, query: string, limit: number) {
  const search = parseClientSearch(query);
  let request = supabase
    .from("clients")
    .select("id, first_name, last_name, phone, email, allergies", { count: "exact" })
    .eq("business_id", businessId);
  if (search.kind === "phone") request = request.like("phone_digits", `%${search.digits}%`);
  if (search.kind === "name") {
    for (const term of search.terms) {
      const escaped = escapeLike(term);
      if (escaped) request = request.ilike("search_name", `%${escaped}%`);
    }
  }
  const { data, count, error } = await request.order("search_name").order("id").limit(limit);
  if (error) throw error;
  return { search, clients: data, total: count ?? data.length };
}
