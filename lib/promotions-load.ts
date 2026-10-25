// Loading promotions for the checkout and the booking site: the salon's
// live ones, and what their limits need to know about this client and
// visit (uses so far, when they joined, whether they've visited, when the
// visit was booked). The database checks it all again (complete_sale,
// attach_online_promotion).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { PROMOTION_COLUMNS, ruleOf, type Level, type PromoRule, type PromotionRow } from "@/lib/promotions";
import { toLocal, type LocalDate } from "@/lib/scheduling/time";
import type { PromoRates } from "@/lib/ticket";

type Supabase = SupabaseClient<Database>;

// Not archived and not over.
export async function loadPromotions(supabase: Supabase, businessId: string, today: LocalDate): Promise<PromoRule[]> {
  const { data, error } = await supabase.from("promotions").select(PROMOTION_COLUMNS).eq("business_id", businessId).is("archived_at", null).order("created_at");
  if (error) throw error;
  return (data as unknown as PromotionRow[]).map(ruleOf).filter((r) => !r.endsOn || r.endsOn >= today);
}

// Uses of each promotion (sales not voided, and visits holding one from
// online booking, apart from this visit), in all and by this client.
export async function promotionUses(supabase: Supabase, ids: readonly string[], clientId: string | null, appointmentId: string | null) {
  const uses: Record<string, { uses: number; clientUses: number }> = Object.fromEntries(ids.map((id) => [id, { uses: 0, clientUses: 0 }]));
  if (!ids.length) return uses;
  const [redeemed, held] = await Promise.all([
    supabase.from("promotion_redemptions").select("promotion_id, client_id").in("promotion_id", [...ids]).is("voided_at", null),
    supabase.from("appointments").select("id, promotion_id, client_id").in("promotion_id", [...ids]).in("status", ["booked", "confirmed", "checked_in"]),
  ]);
  if (redeemed.error) throw redeemed.error;
  if (held.error) throw held.error;
  for (const r of [...redeemed.data, ...held.data.filter((a) => a.id !== appointmentId)]) {
    const u = uses[r.promotion_id!];
    u.uses += 1;
    if (clientId && r.client_id === clientId) u.clientUses += 1;
  }
  return uses;
}

export async function promoRatesFor(
  supabase: Supabase,
  o: { businessId: string; timezone: string; today: LocalDate; clientId: string | null; appointmentId: string | null; where?: "checkout" | "online" },
): Promise<PromoRates> {
  const rules = await loadPromotions(supabase, o.businessId, o.today);
  const [services, staff, client, visited, visit, uses] = await Promise.all([
    supabase.from("services").select("id, category").eq("business_id", o.businessId),
    supabase.from("staff").select("id, level").eq("business_id", o.businessId),
    o.clientId ? supabase.from("clients").select("created_at").eq("id", o.clientId).maybeSingle() : Promise.resolve({ data: null }),
    o.clientId ? supabase.from("appointments").select("id").eq("client_id", o.clientId).eq("status", "completed").neq("id", o.appointmentId ?? "00000000-0000-0000-0000-000000000000").limit(1) : Promise.resolve({ data: [] }),
    o.appointmentId ? supabase.from("appointments").select("starts_at, created_at").eq("id", o.appointmentId).maybeSingle() : Promise.resolve({ data: null }),
    promotionUses(supabase, rules.map((r) => r.id), o.clientId, o.appointmentId),
  ]);
  return {
    rules,
    categoryOf: Object.fromEntries((services.data ?? []).map((s) => [s.id, s.category])),
    levelOf: Object.fromEntries((staff.data ?? []).map((s) => [s.id, s.level as Level | null])),
    context: {
      today: o.today,
      where: o.where ?? "checkout",
      client: client.data ? { createdOn: toLocal(new Date(client.data.created_at), o.timezone).date, visitedBefore: (visited.data ?? []).length > 0 } : null,
      visit: visit.data ? { startsAt: Date.parse(visit.data.starts_at), bookedAt: Date.parse(visit.data.created_at) } : null,
    },
    uses,
  };
}
