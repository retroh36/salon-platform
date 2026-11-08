// What the cancellation policy asks of a waitlist offer's visit, for the
// client's page: the same terms as the booking site (clientTerms), priced
// at the offer's stylist's own prices. Service role, by the offer.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { depositFor, type DepositKind } from "@/lib/online-booking/settings";
import { clientTerms, type OnlineTerms } from "@/lib/online-booking/terms";
import { levelPricesFrom, stylistPrice } from "@/lib/services";
import type { WaitlistOffer } from "@/lib/waitlist-offers";

type Admin = SupabaseClient<Database>;

export async function offerTerms(admin: Admin, offer: WaitlistOffer): Promise<OnlineTerms> {
  const [services, stylist, own] = await Promise.all([
    admin.from("services").select("id, price_cents, deposit_kind, deposit_amount, service_level_prices(level, price_cents)").in("id", offer.serviceIds),
    admin.from("staff").select("level").eq("id", offer.staffId).single(),
    admin.from("staff_services").select("service_id, price_cents").eq("staff_id", offer.staffId).in("service_id", offer.serviceIds),
  ]);
  for (const r of [services, stylist, own]) if (r.error) throw r.error;
  const custom = new Map(own.data!.map((o) => [o.service_id, o.price_cents]));
  const lines = offer.serviceIds.flatMap((id) => {
    const s = services.data!.find((x) => x.id === id);
    if (!s) return [];
    const priceCents = stylistPrice({ price_cents: s.price_cents, levelPrices: levelPricesFrom(s.service_level_prices) }, { level: stylist.data!.level, customCents: custom.get(id) ?? null });
    return [{ serviceId: id, staffId: offer.staffId, priceCents, depositCents: depositFor(s.deposit_kind as DepositKind, s.deposit_amount, priceCents) }];
  });
  return clientTerms(admin, { id: offer.businessId, name: offer.salon.name }, offer.clientId, lines);
}
