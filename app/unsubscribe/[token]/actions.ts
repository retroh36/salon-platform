"use server";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Turns off that kind of message for the client (texts, or marketing
// email), and records it on the message.
export async function optOut(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  const { data, error } = await createAdminClient().rpc("marketing_opt_out", { p_token_hash: createHash("sha256").update(token).digest("hex") });
  if (error) throw error;
  return data !== null;
}
