import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { groupByCategory } from "@/lib/services";
import { minuteToTime, type Weekday } from "@/lib/scheduling/time";
import type { ServiceGroup } from "./member-form";

type Supabase = SupabaseClient<Database>;

// The menu, by category, for choosing what someone does.
export async function serviceGroups(supabase: Supabase): Promise<ServiceGroup[]> {
  const { data, error } = await supabase.from("services").select("id, name, category").is("archived_at", null);
  if (error) throw error;
  return groupByCategory(data).map((g) => ({ category: g.category, services: g.services.map((s) => ({ id: s.id, name: s.name })) }));
}

// The salon's opening hours, as a new member's starting hours (the first
// stretch of each day).
export async function openingHours(supabase: Supabase, locationId: string): Promise<Partial<Record<Weekday, { start: string; end: string }>>> {
  const { data, error } = await supabase.from("location_hours").select("weekday, start_minute, end_minute").eq("location_id", locationId).order("start_minute");
  if (error) throw error;
  const out: Partial<Record<Weekday, { start: string; end: string }>> = {};
  for (const h of data) if (!out[h.weekday as Weekday]) out[h.weekday as Weekday] = { start: minuteToTime(h.start_minute), end: minuteToTime(h.end_minute) };
  return out;
}
