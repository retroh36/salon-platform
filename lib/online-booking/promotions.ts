// Promotions on the booking site (service role): a last-minute special on
// the times it covers (picked with the time, so Review shows it from the
// start), and at review the client's promo code or that special, with what
// it takes off at the stylists' prices, or why it doesn't apply to them.
// The visit keeps it (attach_online_promotion, which checks the rules
// again), the confirmation and their account show it, and it's taken off
// at checkout.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { applyPromotions, discountText, normalCode, PROMOTION_COLUMNS, promotionApplies, promotionProblem, ruleOf, showsOnTimes, specialFor, type PromoLine, type PromoRule, type PromotionRow } from "@/lib/promotions";
import { momentAt, promoRatesFor } from "@/lib/promotions-load";
import { loadBookingContext } from "@/lib/scheduling/load";
import { planVisitAt, type PlannedItem, type VisitRequest } from "@/lib/scheduling/online";
import { todayIn, toLocal, type LocalDate } from "@/lib/scheduling/time";
import type { BookingSite } from "./site";

type Admin = SupabaseClient<Database>;

// label: what the client sees ("Last-minute 15% off", "Spring code: $10 off").
export type OnlinePromo = { id: string; name: string; text: string; label: string; discountCents: number };

export const offerLabel = (rule: Pick<PromoRule, "kind" | "name" | "discount">) =>
  rule.kind === "last_minute" ? `Last-minute ${discountText(rule.discount)}` : `${rule.name}: ${discountText(rule.discount)}`;

const offerOf = (rule: PromoRule, lines: readonly PromoLine[]): OnlinePromo => ({
  id: rule.id,
  name: rule.name,
  text: discountText(rule.discount),
  label: offerLabel(rule),
  discountCents: applyPromotions([rule], lines).perLine.reduce((a, b) => a + b, 0),
});

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

export const onlineSpecials = (rules: readonly PromoRule[]) => rules.filter(showsOnTimes);

// The special for a time, if one covers it (its badge is `text`, "15% off").
export function specialAt(site: BookingSite, specials: readonly PromoRule[], items: readonly PlannedItem[], start: Date, now: Date, today: LocalDate): OnlinePromo | null {
  const lines = promoLinesFor(site, items);
  const rule = specialFor(specials, { startsAt: start.getTime(), now: now.getTime(), today, when: momentAt(start, site.location.timezone) }, lines);
  return rule ? offerOf(rule, lines) : null;
}

export async function plannedItems(admin: Admin, site: BookingSite, request: VisitRequest, start: Date): Promise<PlannedItem[] | null> {
  const date = toLocal(start, site.location.timezone).date;
  const ctx = await loadBookingContext(admin, { id: site.location.id, timezone: site.location.timezone }, date, date);
  return planVisitAt(ctx, request, start);
}

// Why an offer doesn't apply to this client and visit, after "<label>
// doesn't apply": the rule's own reason, said to the client.
function lostReason(rule: PromoRule, problem: string): string {
  const said = problem.replace(rule.name, "it").replace(/^it is /, "it's ").replace(/^This client has already used it/, "you've already used it");
  return `: ${said.charAt(0).toLowerCase()}${said.slice(1)}`;
}

export type OnlinePromotion = { ok: true; promo: OnlinePromo | null; lost?: string } | { ok: false; message: string };

// The promotion for this visit: the code they gave (or why it can't be
// used), else the special picked with the time (or why it no longer
// applies to them: `lost`, said at review before they book).
export async function onlinePromotion(
  admin: Admin,
  site: BookingSite,
  clientId: string | null,
  items: readonly PlannedItem[],
  start: Date,
  choice: { code?: string | null; specialId?: string | null },
  now = new Date(),
): Promise<OnlinePromotion> {
  const tz = site.location.timezone;
  const today = todayIn(tz, now);
  const rates = await promoRatesFor(admin, { businessId: site.business.id, timezone: tz, today, clientId, appointmentId: null, where: "online" });
  const lines = promoLinesFor(site, items);
  const spend = lines.reduce((n, l) => n + l.cents, 0);
  const when = momentAt(start, tz);
  const problemOf = (rule: PromoRule) =>
    promotionProblem(rule, { ...rates.context, ...(rates.uses[rule.id] ?? { uses: 0, clientUses: 0 }), subtotalCents: spend, visit: { startsAt: start.getTime(), bookedAt: now.getTime() }, when });

  const code = choice.code?.trim();
  if (code) {
    const rule = rates.rules.find((r) => r.kind === "code" && r.code === normalCode(code));
    if (!rule) return { ok: false, message: "That code isn't valid. Check it and try again." };
    const problem = problemOf(rule);
    if (problem) return { ok: false, message: problem.replace("needs a client on the sale", "needs your details first") };
    if (!lines.some((l) => promotionApplies(rule, l))) return { ok: false, message: `${rule.name} doesn't cover these services.` };
    return { ok: true, promo: offerOf(rule, lines) };
  }
  if (!choice.specialId) return { ok: true, promo: null };
  const rule = onlineSpecials(rates.rules).find((r) => r.id === choice.specialId);
  if (!rule) return { ok: true, promo: null, lost: "That last-minute offer has ended." };
  const label = offerLabel(rule);
  const problem = problemOf(rule) ?? (specialFor([rule], { startsAt: start.getTime(), now: now.getTime(), today, when }, lines) || !lines.some((l) => promotionApplies(rule, l)) ? null : rule.kind === "last_minute" ? `${rule.name} is for visits booked within ${rule.hoursAhead} hours of starting.` : `${rule.name} isn't on at this day and time.`);
  if (problem) return { ok: true, promo: null, lost: `${label} doesn't apply${lostReason(rule, problem)}` };
  const missed = items.filter((_, n) => !promotionApplies(rule, lines[n]));
  if (missed.length === items.length) {
    const what = missed.map((i) => `${site.services.find((s) => s.id === i.serviceId)?.name ?? "this service"} with ${site.stylists.find((s) => s.id === i.staffId)?.firstName ?? "this stylist"}`);
    return { ok: true, promo: null, lost: `${label} doesn't apply to ${what.join(" or ")}.` };
  }
  return { ok: true, promo: offerOf(rule, lines) };
}

// The offer a booked visit holds (its promotion, at the visit's own
// prices), for the confirmation and the client's account.
export async function heldOffer(
  admin: Admin,
  businessId: string,
  promotionId: string | null,
  items: readonly { serviceId: string; staffId: string; priceCents: number }[],
): Promise<{ label: string; discountCents: number } | null> {
  if (!promotionId) return null;
  const [promotion, services, staff] = await Promise.all([
    admin.from("promotions").select(PROMOTION_COLUMNS).eq("id", promotionId).eq("business_id", businessId).maybeSingle(),
    admin.from("services").select("id, category").in("id", [...new Set(items.map((i) => i.serviceId))]),
    admin.from("staff").select("id, level").in("id", [...new Set(items.map((i) => i.staffId))]),
  ]);
  for (const r of [promotion, services, staff]) if (r.error) throw r.error;
  if (!promotion.data) return null;
  const rule = ruleOf(promotion.data as unknown as PromotionRow);
  const lines: PromoLine[] = items.map((i) => ({
    kind: "service",
    serviceId: i.serviceId,
    category: services.data!.find((s) => s.id === i.serviceId)?.category ?? null,
    staffId: i.staffId,
    level: staff.data!.find((s) => s.id === i.staffId)?.level ?? null,
    cents: i.priceCents,
  }));
  const discountCents = applyPromotions([rule], lines).perLine.reduce((a, b) => a + b, 0);
  return discountCents > 0 ? { label: offerLabel(rule), discountCents } : null;
}
