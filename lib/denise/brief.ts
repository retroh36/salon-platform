// Denise's morning brief: today's risks, likely no-shows, clients due back
// who aren't booked, openings worth filling from the waitlist, and stock
// running low for today's services. Every fact is worked out here from the
// data and what she's learned (lib/insights/); the wording is a template,
// or Claude's (./claude.ts) from these same facts when she's connected.

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
  risks: string[];
  likelyNoShows: { client: string; time: string; noShowPercent: number; visits: number }[];
  dueNotBooked: { total: number; top: { client: string; overdueDays: number; usualWeeks: number | null }[] };
  openings: { count: number; withMatches: number };
  lowStock: string[];
  // Clients coming in today with uses left on a package or money on a gift
  // card, so the desk can mention it.
  credits: { client: string; packages: string[]; giftCardCents: number }[];
};

export type Brief = {
  facts: BriefFacts;
  // Plain-English summary: Claude's from the facts, or the template.
  text: string;
  writtenBy: "template" | "claude";
};

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
      .select("service_id, starts_at, appointment:appointments!inner(id, status, client:clients(id, first_name, last_name))")
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
    return [{ client: shortName(c), time: formatMinute(toLocal(new Date(i.starts_at), tz).minute), noShowPercent: Math.round(known.noShowRate * 100), visits: known.visits }];
  });

  // Regulars due back (or overdue) with nothing booked, most overdue first.
  const due = [...insights].filter(([, c]) => (c.due === "overdue" || c.due === "due_soon") && c.visits >= 2).sort((a, b) => b[1].overdueDays - a[1].overdueDays);
  const topIds = due.slice(0, DUE_LISTED).map(([id]) => id);
  const { data: names, error: nameError } = topIds.length ? await supabase.from("clients").select("id, first_name, last_name").in("id", topIds) : { data: [], error: null };
  if (nameError) throw nameError;
  const nameOf = new Map(names.map((n) => [n.id, shortName(n)]));
  const top = due.slice(0, DUE_LISTED).flatMap(([id, c]: [string, ClientInsight]) =>
    nameOf.has(id) ? [{ client: nameOf.get(id)!, overdueDays: c.overdueDays, usualWeeks: c.intervalDays ? Math.round(c.intervalDays / 7) : null }] : [],
  );

  // Stock below its reorder point that today's services use.
  const serviceIds = [...new Set(items.map((i) => i.service_id))];
  let lowStock: string[] = [];
  if (serviceIds.length) {
    const { data: recipes, error: recipeError } = await supabase.from("service_products").select("product_id").in("service_id", serviceIds);
    if (recipeError) throw recipeError;
    const productIds = [...new Set(recipes.map((r) => r.product_id))];
    if (productIds.length) {
      const { data: levels, error: levelError } = await supabase
        .from("stock_levels")
        .select("on_hand, reorder_point, product:products(brand, line, name)")
        .eq("location_id", where.location.id)
        .in("product_id", productIds);
      if (levelError) throw levelError;
      lowStock = levels.filter((l) => Number(l.on_hand) < Number(l.reorder_point)).map((l) => [l.product.brand, l.product.line, l.product.name].filter(Boolean).join(" "));
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
    return uses.length || giftCardCents ? [{ client: shortName(c), packages: uses, giftCardCents }] : [];
  });

  return {
    date,
    visits: firstItem.size,
    risks: scan.conflicts.filter((c) => c.kind === "likely_overrun").map((c) => c.headline),
    likelyNoShows,
    dueNotBooked: { total: due.length, top },
    openings: { count: scan.openings.length, withMatches: scan.openings.filter((o) => o.matches.length > 0).length },
    lowStock,
    credits,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "Ava K. (3 Blowouts left on a package, $40 on a gift card)"
export function creditText(c: BriefFacts["credits"][number]): string {
  const parts = [...c.packages.map((p) => `${p} on a package`), ...(c.giftCardCents ? [`${formatPrice(c.giftCardCents)} on a gift card`] : [])];
  return `${c.client} (${parts.join(", ")})`;
}
// Ends with one full stop, even after a name like "Ava K.".
const sentence = (text: string) => (text.endsWith(".") ? text : `${text}.`);

// The template wording, from the facts only.
export function briefTemplate(f: BriefFacts): string {
  const lines: string[] = [`${plural(f.visits, "visit")} on the book today.`];
  if (f.risks.length) lines.push(`${plural(f.risks.length, "visit")} likely to run over; I've lined up fixes below.`);
  else lines.push("Nothing looks likely to run over.");
  if (f.likelyNoShows.length) lines.push(`Might not show: ${f.likelyNoShows.map((n) => `${n.client} at ${n.time} (missed ${n.noShowPercent}% of visits)`).join(", ")}. A reminder call could help.`);
  if (f.dueNotBooked.total) {
    const names = f.dueNotBooked.top.slice(0, 3).map((d) => `${d.client}${d.overdueDays ? ` (${Math.max(1, Math.round(d.overdueDays / 7))} wk overdue)` : ""}`);
    lines.push(sentence(`${plural(f.dueNotBooked.total, "regular")} due back with nothing booked${names.length ? `, most overdue: ${names.join(", ")}` : ""}`));
  }
  if (f.openings.withMatches) lines.push(`${plural(f.openings.withMatches, "opening")} I could fill from the waitlist.`);
  if (f.lowStock.length) lines.push(`Low for today's services: ${f.lowStock.slice(0, 3).join(", ")}${f.lowStock.length > 3 ? ` and ${f.lowStock.length - 3} more` : ""}.`);
  if (f.credits.length) lines.push(sentence(`Coming in with credit: ${f.credits.slice(0, 3).map(creditText).join("; ")}${f.credits.length > 3 ? ` and ${f.credits.length - 3} more` : ""}`));
  return lines.join(" ");
}
