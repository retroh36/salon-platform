// Loading Denise's ideas for open time (lib/promotion-ideas.ts) for the
// Promotions page, and the message for one client: the fixed template
// filled in by our code, with a booking link for that stylist and the
// client's usual services. Front of house.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { siteUrl } from "@/lib/branding";
import { gapsWorthFilling } from "@/lib/dashboard";
import type { ClientInsight } from "@/lib/insights/clients";
import { loadAllClientInsights, loadClientInsights } from "@/lib/insights/read";
import { channelFor, consentOf } from "@/lib/messaging/consent";
import { CONSENT_COLUMNS } from "@/lib/messaging/send";
import { openingIdeas, whenText, type Gap, type OpeningIdea, type Regular } from "@/lib/promotion-ideas";
import { discountText, specialMessage, type PromoRule } from "@/lib/promotions";
import { loadPromotions } from "@/lib/promotions-load";
import { formatDay } from "@/lib/schedule-format";
import { loadBookingContext, loadOffers } from "@/lib/scheduling/load";
import { addDays, fromLocal, todayIn, toLocal, type LocalDate } from "@/lib/scheduling/time";

type Supabase = SupabaseClient<Database>;
type Me = { business_id: string; location: { id: string; timezone: string } };

export type IdeaView = OpeningIdea & { staffName: string; when: string };

export async function loadOpeningIdeas(supabase: Supabase, me: Me, now = new Date()): Promise<{ special: PromoRule | null; ideas: IdeaView[] }> {
  const tz = me.location.timezone;
  const today = todayIn(tz, now);
  const tomorrow = addDays(today, 1);
  const specials = (await loadPromotions(supabase, me.business_id, today)).filter((r) => r.kind === "last_minute" && (!r.startsOn || r.startsOn <= today));
  // The special that reaches furthest ahead.
  const special = [...specials].sort((a, b) => (b.hoursAhead ?? 0) - (a.hoursAhead ?? 0))[0] ?? null;
  const last = addDays(today, Math.ceil((special?.hoursAhead ?? 48) / 24));

  const { data: staff } = await supabase.from("staff").select("id, first_name").eq("location_id", me.location.id).eq("is_active", true);
  const offers = await loadOffers(supabase, (staff ?? []).map((s) => s.id));
  const stylists = (staff ?? []).filter((s) => (offers.get(s.id)?.size ?? 0) > 0);
  const ctx = await loadBookingContext(supabase, me.location, today, last);
  const nowMinute = toLocal(now, tz).minute;
  const gaps: Gap[] = [];
  for (let date = today; date <= last; date = addDays(date, 1)) {
    for (const g of gapsWorthFilling(ctx, stylists.map((s) => s.id), date, date === today ? nowMinute : 0)) gaps.push({ ...g, startsAt: fromLocal(g.date, g.start, tz)!.getTime() });
  }

  const insights = await loadAllClientInsights(supabase, me.business_id);
  const due = [...insights].filter(([, c]) => (c.due === "overdue" || c.due === "due_soon") && !c.nextBooked && c.visits >= 2).sort((a, b) => b[1].overdueDays - a[1].overdueDays).slice(0, 200);
  const ids = due.map(([id]) => id);
  const [{ data: clients }, { data: recent }] = await Promise.all([
    ids.length ? supabase.from("clients").select(`id, first_name, ${CONSENT_COLUMNS}`).in("id", ids) : Promise.resolve({ data: [] as never[] }),
    ids.length ? supabase.rpc("recent_offer_clients", { p_business_id: me.business_id, p_client_ids: ids }) : Promise.resolve({ data: [] as string[] }),
  ]);
  const offered = new Set((recent ?? []) as string[]);
  const byId = new Map((clients ?? []).map((c) => [c.id, c]));
  const regulars: Regular[] = due.flatMap(([clientId, c]) => {
    const row = byId.get(clientId);
    if (!row) return [];
    return [
      {
        clientId,
        firstName: row.first_name,
        preferredStaffId: c.preferredStaffId,
        usualServiceIds: c.usualServiceIds,
        overdueDays: c.overdueDays,
        channel: channelFor(consentOf(row), "marketing")?.channel ?? null,
        offeredRecently: offered.has(clientId),
      },
    ];
  });
  const names = new Map(stylists.map((s) => [s.id, s.first_name]));
  const ideas = openingIdeas(gaps, regulars, special, (id) => new Set(offers.get(id)?.keys() ?? []), now.getTime()).slice(0, 4);
  return {
    special,
    ideas: ideas.map((i) => ({ ...i, staffName: names.get(i.gap.staffId) ?? "A stylist", when: whenText(i.gap.date, i.gap.start, today, tomorrow, formatDay) })),
  };
}

// The message for one client about one opening: our template, our facts.
export async function specialDraft(
  supabase: Supabase,
  me: Me,
  o: { promotionId: string; clientId: string; staffId: string; date: LocalDate; start: number },
  now = new Date(),
): Promise<{ body: string; subject: string; promotion: PromoRule } | null> {
  const tz = me.location.timezone;
  const today = todayIn(tz, now);
  const promotion = (await loadPromotions(supabase, me.business_id, today)).find((r) => r.id === o.promotionId);
  if (!promotion) return null;
  const [{ data: business }, { data: client }, { data: stylist }, insight] = await Promise.all([
    supabase.from("businesses").select("name, slug").eq("id", me.business_id).single(),
    supabase.from("clients").select("first_name").eq("id", o.clientId).eq("business_id", me.business_id).maybeSingle(),
    supabase.from("staff").select("first_name").eq("id", o.staffId).eq("business_id", me.business_id).maybeSingle(),
    loadClientInsights(supabase, me.business_id, [o.clientId]),
  ]);
  if (!business || !client || !stylist) return null;
  const habits: ClientInsight | undefined = insight.get(o.clientId)?.habits;
  const services = habits?.usualServiceIds.length ? `&services=${habits.usualServiceIds.join(",")}` : "";
  const link = `${siteUrl()}/book/${business.slug}?src=special&staff=${o.staffId}${services}`;
  return {
    promotion,
    subject: `An opening at ${business.name}`,
    body: specialMessage({
      firstName: client.first_name,
      salon: business.name,
      stylist: stylist.first_name,
      when: whenText(o.date, o.start, today, addDays(today, 1), formatDay),
      offer: discountText(promotion.discount),
      link,
    }),
  };
}
