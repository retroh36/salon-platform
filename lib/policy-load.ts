// Loads a salon's cancellation policy (Settings → Policies) and a client's
// standing under it. Works with the signed-in user's client (RLS) or the
// service role (the booking site, the card link page).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { policyFromRow, staffPolicyFromRow, type PolicySettings, type RepeatAction, type StaffPolicy } from "./policy.ts";

type Supabase = SupabaseClient<Database>;

export type LoadedPolicy = { settings: PolicySettings; stylists: StaffPolicy[]; extra: string; waiveRoles: string[] };

export async function loadPolicy(supabase: Supabase, businessId: string): Promise<LoadedPolicy> {
  const [settings, stylists, online] = await Promise.all([
    supabase.from("policy_settings").select("*").eq("business_id", businessId).maybeSingle(),
    supabase.from("staff_policies").select("staff_id, cancel_window_hours, late_cancel_fee_kind, late_cancel_fee_amount, no_show_fee_kind, no_show_fee_amount").eq("business_id", businessId),
    supabase.from("online_booking_settings").select("cancellation_policy").eq("business_id", businessId).maybeSingle(),
  ]);
  if (settings.error) throw settings.error;
  if (stylists.error) throw stylists.error;
  return {
    settings: policyFromRow(settings.data),
    stylists: stylists.data.map(staffPolicyFromRow),
    extra: online.data?.cancellation_policy ?? "",
    waiveRoles: settings.data?.waive_roles ?? ["owner", "manager"],
  };
}

export type ClientStanding = { strikes: number; months: number; action: RepeatAction; hasCard: boolean };

export async function clientStanding(supabase: Supabase, clientId: string): Promise<ClientStanding> {
  const { data, error } = await supabase.rpc("client_policy_standing", { p_client_id: clientId });
  if (error) throw error;
  const s = data as { strikes: number; months: number; action: RepeatAction; has_card: boolean };
  return { strikes: s.strikes, months: s.months, action: s.action, hasCard: s.has_card };
}

// Whether the client has finished a visit before (new clients may need a
// card).
export async function isNewClient(supabase: Supabase, clientId: string, exceptAppointmentId?: string): Promise<boolean> {
  let query = supabase.from("appointments").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("status", "completed");
  if (exceptAppointmentId) query = query.neq("id", exceptAppointmentId);
  const { count, error } = await query;
  if (error) throw error;
  return (count ?? 0) === 0;
}
