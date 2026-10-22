// What Denise's Claude calls cost: each call's tokens are logged per salon
// (ai_usage), and once a salon reaches its daily limit
// (businesses.ai_daily_token_limit) calls stop until tomorrow, so Denise
// uses template wording instead. Server-only (the service role).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ClaudeClient } from "./claude";

type Admin = SupabaseClient<Database>;

export class DailyLimitReached extends Error {
  constructor() {
    super("Denise has reached today's limit");
    this.name = "DailyLimitReached";
  }
}

export async function usageToday(admin: Admin, businessId: string): Promise<{ used: number; limit: number }> {
  const { data, error } = await admin.rpc("ai_usage_today", { p_business_id: businessId });
  if (error) throw error;
  const row = data[0];
  return { used: Number(row?.used ?? 0), limit: row?.daily_limit ?? 0 };
}

// The same client, with each call checked against the limit and logged.
export function metered(client: ClaudeClient, admin: Admin, businessId: string, feature: string): ClaudeClient {
  return {
    messages: {
      create: async (params, options) => {
        const { used, limit } = await usageToday(admin, businessId);
        if (used >= limit) throw new DailyLimitReached();
        const response = await client.messages.create(params, options);
        const u = response.usage;
        const { error } = await admin.rpc("record_ai_usage", {
          p_business_id: businessId,
          p_model: String(params.model),
          p_feature: feature,
          p_input: (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0),
          p_output: u?.output_tokens ?? 0,
          p_cache_read: u?.cache_read_input_tokens ?? 0,
        });
        if (error) throw error;
        return response;
      },
    },
  };
}
