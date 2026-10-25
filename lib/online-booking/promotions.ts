// Promotions on the booking site (service role): a last-minute special's
// badge on the times it covers, and at review the client's promo code or
// the special for their time, with about what it takes off. The visit
// keeps it (attach_online_promotion, which checks the rules again) and
// it's taken off at checkout.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { applyPromotions, discountText, normalCode, promotionApplies, promotionProblem, specialFor, type PromoLine, type PromoRule } from "@/lib/promotions";
import { promoRatesFor } from "@/lib/promotions-load";
import { loadBookingContext } from "@/lib/scheduling/load";
import { planVisitAt, type PlannedItem, type VisitRequest } from "@/lib/scheduling/online";
import { todayIn, toLocal, type LocalDate } from "@/lib/scheduling/time";
import type { BookingSite } from "./site";

type Admin = SupabaseClient<Database>;

export type OnlinePromo = { id: string; name: string; text: string; discountCents: number };

// A visit's services as promotions see them, at the stylists' prices.
export function promoLinesFor(site: BookingSite, items: readonly Pick<PlannedItem, "serviceId" | "staffId">[]): PromoLine[] {
  return items.map((i) => {
    const stylist = site.stylists.find((s) => s.id === i.staffId);
    return {
      kind: "service",
      serviceId: i.serviceId,
      category: site.services.find((s) => s.id === i.serviceId)?.category ?? null,
      staffId: i.staffId,
      level: stylist?.level ?? null,
      cents: stylist?.prices[i.serviceId] ?? 0,
    };
  });
}

export const onlineSpecials = (rules: readonly PromoRule[]) => rules.filter((r) => r.kind === "last_minute" && r.online);

// "15% off": a special's badge for a time, if one covers it.
export function badgeFor(site: BookingSite, specials: readonly PromoRule[], items: readonly PlannedItem[], start: Date, now: Date, today: LocalDate): string | null {
  const rule = specialFor(specials, { startsAt: start.getTime(), now: now.getTime(), today }, promoLinesFor(site, items));
  return rule ? discountText(rule.discount) : null;
}

export async function plannedItems(admin: Admin, site: BookingSite, request: VisitRequest, start: Date): Promise<PlannedItem[] | null> {
  const date = toLocal(start, site.location.timezone).date;
  const ctx = await loadBookingContext(admin, { id: site.location.id, timezone: site.location.timezone }, date, date);
  return planVisitAt(ctx, request, start);
}

// The promotion for this visit: the code they gave (or why it can't be
// used), else the best special for the time, if any.
export async function onlinePromotion(
  admin: Admin,
  site: BookingSite,
  clientId: string | null,
  items: readonly PlannedItem[],
  start: Date,
  code: string | null,
  now = new Date(),
): Promise<{ ok: true; promo: OnlinePromo | null } | { ok: false; message: string }> {
  const tz = site.location.timezone;
  const today = todayIn(tz, now);
  const rates = await promoRatesFor(admin, { businessId: site.business.id, timezone: tz, today, clientId, appointmentId: null, where: "online" });
  const lines = promoLinesFor(site, items);
  const spend = lines.reduce((n, l) => n + l.cents, 0);
  const problemOf = (rule: PromoRule) =>
    promotionProblem(rule, { ...rates.context, ...(rates.uses[rule.id] ?? { uses: 0, clientUses: 0 }), subtotalCents: spend, visit: { startsAt: start.getTime(), bookedAt: now.getTime() } });
  const offer = (rule: PromoRule): OnlinePromo => ({ id: rule.id, name: rule.name, text: discountText(rule.discount), discountCents: applyPromotions([rule], lines).perLine.reduce((a, b) => a + b, 0) });

  if (code && code.trim()) {
    const rule = rates.rules.find((r) => r.kind === "code" && r.code === normalCode(code));
    if (!rule) return { ok: false, message: "That code isn't valid. Check it and try again." };
    const problem = problemOf(rule);
    if (problem) return { ok: false, message: problem.replace("needs a client on the sale", "needs your details first") };
    if (!lines.some((l) => promotionApplies(rule, l))) return { ok: false, message: `${rule.name} doesn't cover these services.` };
    return { ok: true, promo: offer(rule) };
  }
  const special = specialFor(onlineSpecials(rates.rules).filter((r) => !problemOf(r)), { startsAt: start.getTime(), now: now.getTime(), today }, lines);
  return { ok: true, promo: special ? offer(special) : null };
}
