// Denise's morning brief: today's risks, likely no-shows, clients due back
// who aren't booked, openings worth filling from the waitlist, stock running
// low for today's services, clients coming in with credit, and what could go
// wrong with the events coming up (lib/events/risks.ts). Every fact is
// worked out here from the data and what she's learned (lib/insights/); the
// Dashboard lays it out in sections, each item linking to the client,
// booking or product (and dismissable: briefItemKey).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ClientInsight } from "@/lib/insights/clients";
import { loadAllClientInsights } from "@/lib/insights/read";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { isUsable, loadPackagesByClient, usesLeft } from "@/lib/packages";
import type { EventRisk } from "@/lib/events/risks";
import { loadEventRisks } from "@/lib/events/risks-load";
import { addDays, formatMinute, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import type { ConflictView, WaitlistOpening } from "./types";
import { firstLetter } from "@/lib/initial";

type Supabase = SupabaseClient<Database>;

// A client looks likely to miss a visit with this no-show rate over at
// least NO_SHOW_VISITS visits.
export const NO_SHOW_RATE = 0.2;
const NO_SHOW_VISITS = 3;
const DUE_LISTED = 5;

export type BriefFacts = {
  date: LocalDate;
  visits: number;
  // Visits likely to run over (her risk check), with the visit to open.
  risks: { subject: string; headline: string; appointmentId: string | null }[];
  likelyNoShows: { appointmentId: string; client: string; time: string; noShowPercent: number; visits: number }[];
  dueNotBooked: { total: number; top: { clientId: string; client: string; overdueDays: number; usualWeeks: number | null }[] };
  openings: { count: number; withMatches: number };
  lowStock: { productId: string; name: string }[];
  // Clients coming in today with uses left on a package or money on a gift
  // card, so the desk can mention it.
  credits: { clientId: string; appointmentId: string; client: string; packages: string[]; giftCardCents: number }[];
  // Balances unpaid a week out, trials not booked a month out, the
  // headcount cutoff, the team's time off and clashes, artists not chosen.
  events: EventRisk[];
};

// The key an item is dismissed by (denise_dismissals), per section.
export const briefItemKey = {
  risk: (r: BriefFacts["risks"][number]) => `risk:${r.subject}`,
  noShow: (n: BriefFacts["likelyNoShows"][number]) => `noshow:${n.appointmentId}`,
  due: (d: BriefFacts["dueNotBooked"]["top"][number]) => `due:${d.clientId}`,
  stock: (p: BriefFacts["lowStock"][number]) => `stock:${p.productId}`,
  credit: (c: BriefFacts["credits"][number]) => `credit:${c.clientId}`,
  event: (e: EventRisk) => e.key,
};

// The brief without what's been dismissed today.
export function withoutDismissed(f: BriefFacts, dismissed: ReadonlySet<string>): BriefFacts {
  const top = f.dueNotBooked.top.filter((d) => !dismissed.has(briefItemKey.due(d)));
  return {
    ...f,
    risks: f.risks.filter((r) => !dismissed.has(briefItemKey.risk(r))),
    likelyNoShows: f.likelyNoShows.filter((n) => !dismissed.has(briefItemKey.noShow(n))),
    dueNotBooked: { total: f.dueNotBooked.total - (f.dueNotBooked.top.length - top.length), top },
    lowStock: f.lowStock.filter((p) => !dismissed.has(briefItemKey.stock(p))),
    credits: f.credits.filter((c) => !dismissed.has(briefItemKey.credit(c))),
    events: f.events.filter((e) => !dismissed.has(briefItemKey.event(e))),
  };
}

const shortName = (c: { first_name: string; last_name: string }) => `${c.first_name}${c.last_name ? ` ${firstLetter(c.last_name)}.` : ""}`;

type Scanned = { conflicts: ConflictView[]; openings: WaitlistOpening[] };

export async function briefFacts(
  supabase: Supabase,
  where: { businessId: string; location: { id: string; timezone: string } },
  date: LocalDate,
  // Denise's scan of the day, which may still be running: only the last
  // step needs it, so the brief's own reads go at the same time.
  scanned: Scanned | PromiseLike<Scanned>,
): Promise<BriefFacts> {
  const tz = where.location.timezone;
  const [{ data: items, error }, insights, events] = await Promise.all([
    supabase
      .from("appointment_items")
      .select("id, service_id, starts_at, appointment:appointments!inner(id, status, client:clients(id, first_name, last_name))")
      .eq("location_id", where.location.id)
      .gte("starts_at", startOfLocalDay(date, tz).toISOString())
      .lt("starts_at", startOfLocalDay(addDays(date, 1), tz).toISOString())
      .in("appointment.status", ["booked", "confirmed", "checked_in"])
      .order("starts_at"),
    loadAllClientInsights(supabase, where.businessId),
    loadEventRisks(supabase, where, date),
  ]);
  if (error) throw error;

  // Likely no-shows: clients on today's book who often don't come.
  const firstItem = new Map<string, (typeof items)[number]>();
  for (const i of items) if (!firstItem.has(i.appointment.id)) firstItem.set(i.appointment.id, i);
  const likelyNoShows = [...firstItem.values()].flatMap((i) => {
    const c = i.appointment.client;
    const known = c ? insights.get(c.id) : undefined;
    if (!c || !known || known.noShowRate === null || known.noShowRate < NO_SHOW_RATE || known.visits < NO_SHOW_VISITS) return [];
    return [{ appointmentId: i.appointment.id, client: shortName(c), time: formatMinute(toLocal(new Date(i.starts_at), tz).minute), noShowPercent: Math.round(known.noShowRate * 100), visits: known.visits }];
  });

  // Regulars due back (or overdue) with nothing booked, most overdue first.
  const due = [...insights].filter(([, c]) => (c.due === "overdue" || c.due === "due_soon") && c.visits >= 2).sort((a, b) => b[1].overdueDays - a[1].overdueDays);
  const topIds = due.slice(0, DUE_LISTED).map(([id]) => id);
  const serviceIds = [...new Set(items.map((i) => i.service_id))];
  const clientIds = [...new Set([...firstItem.values()].flatMap((i) => (i.appointment.client ? [i.appointment.client.id] : [])))];
  // Their names, stock for today's services and today's clients' credit, all at once.
  const [{ data: names, error: nameError }, lowStock, packages, { data: cards, error: cardError }, scan] = await Promise.all([
    topIds.length ? supabase.from("clients").select("id, first_name, last_name").in("id", topIds) : Promise.resolve({ data: [], error: null }),
    lowStockFor(supabase, where.location.id, serviceIds),
    loadPackagesByClient(supabase, clientIds),
    clientIds.length
      ? supabase.from("gift_cards").select("client_id, balance_cents, expires_at").in("client_id", clientIds).eq("status", "active").gt("balance_cents", 0)
      : Promise.resolve({ data: [], error: null }),
    scanned,
  ]);
  if (nameError) throw nameError;
  if (cardError) throw cardError;
  const nameOf = new Map(names.map((n) => [n.id, shortName(n)]));
  const top = due.slice(0, DUE_LISTED).flatMap(([id, c]: [string, ClientInsight]) =>
    nameOf.has(id) ? [{ clientId: id, client: nameOf.get(id)!, overdueDays: c.overdueDays, usualWeeks: c.intervalDays ? Math.round(c.intervalDays / 7) : null }] : [],
  );

  // Credit: package uses left and gift card balances, for today's clients.
  const now = new Date();
  const credits = [...firstItem.values()].flatMap((i) => {
    const c = i.appointment.client;
    if (!c) return [];
    const uses = (packages.get(c.id) ?? []).filter((p) => isUsable(p, now)).flatMap((p) => p.items.filter((x) => x.used < x.total).map(usesLeft));
    const giftCardCents = cards.filter((g) => g.client_id === c.id && (g.expires_at === null || new Date(g.expires_at) > now)).reduce((n, g) => n + g.balance_cents, 0);
    return uses.length || giftCardCents ? [{ clientId: c.id, appointmentId: i.appointment.id, client: shortName(c), packages: uses, giftCardCents }] : [];
  });

  return {
    date,
    visits: firstItem.size,
    risks: scan.conflicts
      .filter((c) => c.kind === "likely_overrun")
      .map((c) => ({ subject: c.subject, headline: c.headline, appointmentId: items.find((i) => c.itemIds.includes(i.id))?.appointment.id ?? null })),
    likelyNoShows,
    dueNotBooked: { total: due.length, top },
    openings: { count: scan.openings.length, withMatches: scan.openings.filter((o) => o.matches.length > 0).length },
    lowStock,
    credits,
    events,
  };
}

// Stock below its reorder point that these services use.
async function lowStockFor(supabase: Supabase, locationId: string, serviceIds: string[]): Promise<BriefFacts["lowStock"]> {
  if (!serviceIds.length) return [];
  const { data: recipes, error: recipeError } = await supabase.from("service_products").select("product_id").in("service_id", serviceIds);
  if (recipeError) throw recipeError;
  const productIds = [...new Set(recipes.map((r) => r.product_id))];
  if (!productIds.length) return [];
  const { data: levels, error: levelError } = await supabase
    .from("stock_levels")
    .select("product_id, on_hand, reorder_point, product:products(brand, line, name)")
    .eq("location_id", locationId)
    .in("product_id", productIds);
  if (levelError) throw levelError;
  return levels
    .filter((l) => Number(l.on_hand) < Number(l.reorder_point))
    .map((l) => ({ productId: l.product_id, name: [l.product.brand, l.product.line, l.product.name].filter(Boolean).join(" ") }));
}

// "3 Blowouts left on a package, $40 on a gift card"
export function creditText(c: BriefFacts["credits"][number]): string {
  const parts = [...c.packages.map((p) => `${p} on a package`), ...(c.giftCardCents ? [`${formatPrice(c.giftCardCents)} on a gift card`] : [])];
  return parts.join(", ");
}
