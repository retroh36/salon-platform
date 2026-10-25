import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSupabaseEnv } from "./env";

// A Supabase client with the service role, which bypasses RLS. Only for
// code with no signed-in user: the public booking site (app/book/), whose
// server code reads exactly the columns it shows, checks the booking rules
// and saves through functions only the service role can call; and
// background jobs (nightly insights, membership billing, also run for one
// membership right after staff change it, once their own login has shown
// they may); and creating a team member's login when they're invited
// (lib/team-logins.ts, after the inviter's own login has shown they may
// manage them); and recording the notices that go with Denise's fixes and
// staff's moves (lib/scheduling/ai-actions.ts, lib/move-notices.ts), in our
// templates, for the person whose login said who they are. Never import
// this from client components, and never use it
// to load what staff pages show.
export function createAdminClient() {
  const { url } = getSupabaseEnv();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("Missing SUPABASE_SECRET_KEY (server-only), needed for online booking.");
  return createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
