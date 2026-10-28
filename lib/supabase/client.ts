"use client";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { realtimeToken } from "@/app/live/actions";
import { getSupabaseEnv } from "./env";

// Supabase in the browser, only for listening (Realtime): reads and writes
// stay on the server. It never handles the session itself (no refreshing,
// no signing out: a tab with a wrong clock would otherwise think the
// session expired and sign out); it asks the server for the signed-in
// person's current token, so RLS still decides what reaches them. One per
// tab.
let client: ReturnType<typeof createClient<Database>> | null = null;
export function browserClient() {
  if (!client) {
    const { url, publishableKey } = getSupabaseEnv();
    client = createClient<Database>(url, publishableKey, { accessToken });
  }
  return client;
}

// Realtime asks for the token on every heartbeat; the server is asked again
// only when the one held is five minutes from expiring (or there's none).
const REFRESH_BEFORE_MS = 5 * 60_000;
let held: { token: string; expires: number } | null = null;
async function accessToken(): Promise<string | null> {
  if (held && held.expires - Date.now() > REFRESH_BEFORE_MS) return held.token;
  const token = await realtimeToken().catch(() => null);
  held = token ? { token, expires: expiresAt(token) } : null;
  return token;
}
// When a token expires (its `exp`), in ms; now if it can't be read.
function expiresAt(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return payload.exp ? payload.exp * 1000 : Date.now();
  } catch {
    return Date.now();
  }
}
