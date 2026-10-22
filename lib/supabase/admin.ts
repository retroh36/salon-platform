import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSupabaseEnv } from "./env";

// A Supabase client with the service role, which bypasses RLS. Only for
// the public booking site (app/book/), which has no signed-in user: its
// server code reads exactly the columns it shows, checks the booking rules
// and saves through functions only the service role can call. Never import
// this from client components, and never use it for staff pages.
export function createAdminClient() {
  const { url } = getSupabaseEnv();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("Missing SUPABASE_SECRET_KEY (server-only), needed for online booking.");
  return createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
