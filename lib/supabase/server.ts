import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { Database } from "@/lib/database.types";
import { getSupabaseEnv } from "./env";

// Supabase client for Server Components and Server Actions. Create a new one
// per request; it acts as the signed-in user, so RLS applies.
export async function createClient() {
  // Session reads check token expiry with Date.now(), which Next.js rejects
  // while prerendering (including runtime prefetches, where cookies() is
  // available). Waiting for the request keeps every user-data read per-request
  // and uncached.
  await connection();
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseEnv();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components can't set cookies. The proxy refreshes the
          // session on every request, so this is safe to ignore.
        }
      },
    },
  });
}
