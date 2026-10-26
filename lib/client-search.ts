import type { SupabaseClient } from "@supabase/supabase-js";
import { CLIENT_SORTS, escapeLike, parseClientSearch, type ClientOrder } from "@/lib/clients";
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

// The Clients list: the same search, with each client's last and next
// visit, usual stylist and spend (client_overview, which RLS keeps to what
// the signed-in member may see), sorted by any of them across every match.
export async function listClients(supabase: SupabaseClient<Database>, businessId: string, query: string, order: ClientOrder, limit: number) {
  const search = parseClientSearch(query);
  let request = supabase.rpc("client_overview", {}, { count: "exact" }).eq("business_id", businessId);
  if (search.kind === "phone") request = request.like("phone_digits", `%${search.digits}%`);
  if (search.kind === "name") {
    for (const term of search.terms) {
      const escaped = escapeLike(term);
      if (escaped) request = request.ilike("search_name", `%${escaped}%`);
    }
  }
  const column = CLIENT_SORTS[order.sort].column;
  if (column !== "search_name") request = request.order(column, { ascending: order.ascending, nullsFirst: false });
  const { data, count, error } = await request
    .order("search_name", { ascending: order.sort === "name" ? order.ascending : true })
    .order("id")
    .limit(limit);
  if (error) throw error;
  return { search, clients: data, total: count ?? data.length };
}
