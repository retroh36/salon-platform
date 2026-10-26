// What Denise's Claude calls cost: each call's tokens are logged per salon
// (ai_usage), and once a salon reaches its daily limit
// (businesses.ai_daily_token_limit) calls stop until tomorrow, so Denise
// uses template wording instead. Server-only (the service role).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type Anthropic from "@anthropic-ai/sdk";
import { demoTokenLimit, isDemo } from "@/lib/demo";
import type { ClaudeClient, ClaudeStream } from "./claude";

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
  const limit = row?.daily_limit ?? 0;
  // The demo's allowance holds whatever a tester sets on Settings.
  return { used: Number(row?.used ?? 0), limit: isDemo() ? Math.min(limit, demoTokenLimit()) : limit };
}

// The same client, with each call checked against the limit and logged.
export function metered(client: ClaudeClient, admin: Admin, businessId: string, feature: string): ClaudeClient {
  const checkLimit = async () => {
    const { used, limit } = await usageToday(admin, businessId);
    if (used >= limit) throw new DailyLimitReached();
  };
  const record = async (model: string, response: Anthropic.Message) => {
    const u = response.usage;
    const { error } = await admin.rpc("record_ai_usage", {
      p_business_id: businessId,
      p_model: model,
      p_feature: feature,
      p_input: (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0),
      p_output: u?.output_tokens ?? 0,
      p_cache_read: u?.cache_read_input_tokens ?? 0,
    });
    if (error) throw error;
  };
  // Called on client.messages, never detached: the SDK's methods need
  // their `this` (a detached stream() fails with "reading '_client'").
  const messages = client.messages;
  return {
    messages: {
      create: async (params, options) => {
        await checkLimit();
        const response = await client.messages.create(params, options);
        await record(String(params.model), response);
        return response;
      },
      // The same for a streamed reply: the limit first, the usage once it's
      // all arrived.
      stream: messages.stream
        ? (params, options): ClaudeStream => {
            let final: Promise<Anthropic.Message> | null = null;
            return {
              async *[Symbol.asyncIterator]() {
                await checkLimit();
                const s = messages.stream!(params, options);
                for await (const event of s) yield event;
                final = s.finalMessage();
                await record(String(params.model), await final);
              },
              finalMessage: () => final ?? Promise.reject(new Error("Read the stream first.")),
            };
          }
        : undefined,
    },
  };
}
