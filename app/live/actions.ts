"use server";

import { createClient } from "@/lib/supabase/server";

// The signed-in person's current access token, for listening to Realtime
// in the browser (useCalendarChanges). The server keeps the session (the
// proxy refreshes it), so the browser never refreshes or signs out on its
// own; null when nobody's signed in.
export async function realtimeToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
