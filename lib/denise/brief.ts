// Denise's morning brief: today's risks, likely no-shows, clients due back
// who aren't booked, openings worth filling from the waitlist, stock running
// low for today's services, and clients coming in with credit. Every fact is
// worked out here from the data and what she's learned (lib/insights/); the
// Dashboard lays it out in sections, each item linking to the client,
// booking or product (and dismissable: briefItemKey).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ClientInsight } from "@/lib/insights/clients";
import { loadAllClientInsights } from "@/lib/insights/read";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { isUsable, loadPackagesByClient, usesLeft } from "@/lib/packages";
import { addDays, formatMinute, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import type { ConflictView, WaitlistOpening } from "./types";

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
};

// The key an item is dismissed by (denise_dismissals), per section.
export const briefItemKey = {
  risk: (r: BriefFacts["risks"][number]) => `risk:${r.subject}`,
  noShow: (n: BriefFacts["likelyNoShows"][number]) => `noshow:${n.appointmentId}`,
  due: (d: BriefFacts["dueNotBooked"]["top"][number]) => `due:${d.clientId}`,
  stock: (p: BriefFacts["lowStock"][number]) => `stock:${p.productId}`,
  credit: (c: BriefFacts["credits"][number]) => `credit:${c.clientId}`,
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
  };
}

const shortName = (c: { first_name: string; last_name: string }) => `${c.first_name}${c.last_name ? ` ${c.last_name[0]}.` : ""}`;

export async function briefFacts(
  supabase: Supabase,
  where: { businessId: string; location: { id: string; timezone: string } },
  date: LocalDate,
  scan: { conflicts: ConflictView[]; openings: WaitlistOpening[] },
): Promise<BriefFacts> {
  const tz = where.location.timezone;
  const [{ data: items, error }, insights] = await Promise.all([
    supabase
      .from("appointment_items")
      .select("id, service_id, starts_at, appointment:appointments!inner(id, status, client:clients(id, first_name, last_name))")
      .eq("location_id", where.location.id)
      .gte("starts_at", startOfLocalDay(date, tz).toISOString())
      .lt("starts_at", startOfLocalDay(addDays(date, 1), tz).toISOString())
      .in("appointment.status", ["booked", "confirmed", "checked_in"])
      .order("starts_at"),
    loadAllClientInsights(supabase, where.businessId),
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
  const { data: names, error: nameError } = topIds.length ? await supabase.from("clients").select("id, first_name, last_name").in("id", topIds) : { data: [], error: null };
  if (nameError) throw nameError;
  const nameOf = new Map(names.map((n) => [n.id, shortName(n)]));
  const top = due.slice(0, DUE_LISTED).flatMap(([id, c]: [string, ClientInsight]) =>
    nameOf.has(id) ? [{ clientId: id, client: nameOf.get(id)!, overdueDays: c.overdueDays, usualWeeks: c.intervalDays ? Math.round(c.intervalDays / 7) : null }] : [],
  );

  // Stock below its reorder point that today's services use.
  const serviceIds = [...new Set(items.map((i) => i.service_id))];
  let lowStock: BriefFacts["lowStock"] = [];
  if (serviceIds.length) {
    const { data: recipes, error: recipeError } = await supabase.from("service_products").select("product_id").in("service_id", serviceIds);
    if (recipeError) throw recipeError;
    const productIds = [...new Set(recipes.map((r) => r.product_id))];
    if (productIds.length) {
      const { data: levels, error: levelError } = await supabase
        .from("stock_levels")
        .select("product_id, on_hand, reorder_point, product:products(brand, line, name)")
        .eq("location_id", where.location.id)
        .in("product_id", productIds);
      if (levelError) throw levelError;
      lowStock = levels
        .filter((l) => Number(l.on_hand) < Number(l.reorder_point))
        .map((l) => ({ productId: l.product_id, name: [l.product.brand, l.product.line, l.product.name].filter(Boolean).join(" ") }));
    }
  }

  // Credit: package uses left and gift card balances, for today's clients.
  const clientIds = [...new Set([...firstItem.values()].flatMap((i) => (i.appointment.client ? [i.appointment.client.id] : [])))];
  const [packages, { data: cards, error: cardError }] = await Promise.all([
    loadPackagesByClient(supabase, clientIds),
    clientIds.length
      ? supabase.from("gift_cards").select("client_id, balance_cents, expires_at").in("client_id", clientIds).eq("status", "active").gt("balance_cents", 0)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (cardError) throw cardError;
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
  };
}

// "3 Blowouts left on a package, $40 on a gift card"
export function creditText(c: BriefFacts["credits"][number]): string {
  const parts = [...c.packages.map((p) => `${p} on a package`), ...(c.giftCardCents ? [`${formatPrice(c.giftCardCents)} on a gift card`] : [])];
  return parts.join(", ");
}
