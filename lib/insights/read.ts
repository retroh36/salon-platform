// Reading what Denise has learned, as the signed-in staff member (RLS
// decides: stylists get their own durations and no spend).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ClientInsight } from "./clients";
import type { ClientSpend } from "./describe";
import type { DurationInsight } from "./durations";
import type { SalonInsight } from "./salon";
import { stretchTiming, timingFor, type BookingContext } from "@/lib/scheduling/booking";

type Supabase = SupabaseClient<Database>;

// Stylist × service durations, keyed "<staff id>:<service id>".
export async function loadDurations(supabase: Supabase, businessId: string, staffIds?: string[]): Promise<Map<string, DurationInsight>> {
  const out = new Map<string, DurationInsight>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("insights").select("key, data").eq("business_id", businessId).eq("kind", "duration").order("key").range(offset, offset + 999);
    if (error) throw error;
    for (const r of data) {
      const d = r.data as unknown as DurationInsight;
      if (!staffIds || staffIds.includes(d.staffId)) out.set(r.key, d);
    }
    if (data.length < 1000) break;
  }
  return out;
}

// Client habits and (front of house only) spend, keyed by client id.
export async function loadClientInsights(
  supabase: Supabase,
  businessId: string,
  clientIds: string[],
): Promise<Map<string, { habits: ClientInsight; spend: ClientSpend | null }>> {
  const out = new Map<string, { habits: ClientInsight; spend: ClientSpend | null }>();
  if (!clientIds.length) return out;
  for (let i = 0; i < clientIds.length; i += 200) {
    const ids = clientIds.slice(i, i + 200);
    const { data, error } = await supabase.from("insights").select("kind, key, data").eq("business_id", businessId).in("kind", ["client", "client_spend"]).in("key", ids);
    if (error) throw error;
    for (const r of data.filter((r) => r.kind === "client")) out.set(r.key, { habits: r.data as unknown as ClientInsight, spend: null });
    for (const r of data.filter((r) => r.kind === "client_spend")) {
      const entry = out.get(r.key);
      if (entry) entry.spend = r.data as unknown as ClientSpend;
    }
  }
  return out;
}

export async function loadSalonInsight(supabase: Supabase, businessId: string, locationId: string): Promise<SalonInsight | null> {
  const { data, error } = await supabase.from("insights").select("data").eq("business_id", businessId).eq("kind", "salon").eq("key", locationId).maybeSingle();
  if (error) throw error;
  return (data?.data as unknown as SalonInsight) ?? null;
}

// Every client's habits (for "who's overdue"), paged.
export async function loadAllClientInsights(supabase: Supabase, businessId: string): Promise<Map<string, ClientInsight>> {
  const out = new Map<string, ClientInsight>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("insights").select("key, data").eq("business_id", businessId).eq("kind", "client").order("key").range(offset, offset + 999);
    if (error) throw error;
    for (const r of data) out.set(r.key, r.data as unknown as ClientInsight);
    if (data.length < 1000) break;
  }
  return out;
}

// Each stylist's length for a service: their trusted usual time (in
// 5-minute steps, stretched over the service's parts), else their own or
// the menu's. usualFor says whether Denise knows it.
export function usualTimings(ctx: BookingContext, learned: ReadonlyMap<string, DurationInsight>) {
  const usualFor = (staffId: string, serviceId: string) => {
    const d = learned.get(`${staffId}:${serviceId}`);
    return d?.trusted ? d : null;
  };
  const timingOf = (staffId: string, serviceId: string) => {
    const base = timingFor(ctx, staffId, serviceId);
    const usual = usualFor(staffId, serviceId);
    return base && usual ? stretchTiming(base, Math.ceil(usual.medianMinutes / 5) * 5) : base;
  };
  return { usualFor, timingOf };
}
