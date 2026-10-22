// Denise drafts reorders: from stock on hand (and already ordered) and the
// products the next two weeks of appointments will use, she suggests a
// purchase order per supplier before anything runs out. Suggestions go in
// the AI action log; staff approve one to make it a draft order, and
// nothing is ordered automatically.
//
// What a booked service will use: the formula recorded for it, or else the
// client's latest formula with products for the same service, or (for
// color) their latest formula with products, or else the service's recipe.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { serviceFamily } from "@/lib/calendar";
import { containerName, formatAmount, productName } from "@/lib/inventory";
import { draftReorders, outlook, type PlannedUse, type ReorderDraft, type StockInfo } from "@/lib/inventory-forecast";
import { loadInventory, type StockRow } from "@/lib/inventory-load";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, todayIn, toLocal, weekdayOf } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";

type Supabase = SupabaseClient<Database>;

export const REORDER_FEATURE = "reorder";
export const WINDOW_DAYS = 14;
const WEEKDAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type ReorderLineView = { productId: string; product: string; quantity: string; costCents: number; reason: string };

export type ReorderSuggestion = {
  actionId: string | null;
  supplierId: string;
  supplier: string;
  leadDays: number;
  // "You'll run out of Goldwell Topchic 7N before Friday — 4 color
  // appointments need it."
  headline: string;
  lines: ReorderLineView[];
  totalCents: number;
};

// "today", "tomorrow", "Friday", "Mon, Nov 3"
export function dayWord(at: Date, now: Date, timeZone: string): string {
  const day = toLocal(at, timeZone).date;
  const today = todayIn(timeZone, now);
  if (day === today) return "the end of today";
  if (day === addDays(today, 1)) return "tomorrow";
  if (day <= addDays(today, 6)) return WEEKDAY_NAMES[weekdayOf(day)];
  const [, m, d] = day.split("-").map(Number);
  return `${WEEKDAY_NAMES[weekdayOf(day)].slice(0, 3)}, ${MONTHS[m - 1]} ${d}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function lineReason(row: StockRow, l: ReorderDraft["lines"][number], now: Date, tz: string): string {
  const o = l.outlook;
  const who = o.colorAppointments === o.appointments && o.appointments > 0 ? "color appointment" : "appointment";
  if (o.runsOutAt) return `Runs out ${dayWord(o.runsOutAt, now, tz) === "the end of today" ? "today" : `by ${dayWord(o.runsOutAt, now, tz)}`}: ${plural(o.appointments, who)} in the next two weeks need ${formatAmount(o.needed, row.unit)}.`;
  if (o.lowNow) return "Below its reorder point now.";
  return `${plural(o.appointments, who)} in the next two weeks take it below its reorder point.`;
}

export function headlineFor(draft: ReorderDraft, rows: ReadonlyMap<string, StockRow>, now: Date, tz: string): string {
  const urgent = draft.mostUrgent;
  if (urgent?.outlook.runsOutAt) {
    const o = urgent.outlook;
    const who = o.colorAppointments === o.appointments ? "color appointment" : "appointment";
    const needs = o.appointments === 1 ? `1 ${who} needs it` : `${o.appointments} ${who}s need it`;
    return `You'll run out of ${productName(rows.get(urgent.productId)!)} before ${dayWord(o.runsOutAt!, now, tz)} — ${needs}.`;
  }
  const first = rows.get(draft.lines[0].productId)!;
  return draft.lines.length === 1
    ? `${productName(first)} is getting low.`
    : `${productName(first)} and ${plural(draft.lines.length - 1, "other product")} are getting low.`;
}

type Upcoming = { id: string; appointmentId: string; at: Date; serviceId: string; serviceColor: boolean; clientId: string | null };

async function loadUpcoming(supabase: Supabase, locationId: string, from: Date, to: Date): Promise<Upcoming[]> {
  const rows: Upcoming[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("appointment_items")
      .select("id, appointment_id, starts_at, service_id, service:services(name, category), appointment:appointments!inner(client_id, status)")
      .eq("location_id", locationId)
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString())
      .in("appointment.status", ["booked", "confirmed", "checked_in"])
      .order("starts_at")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(
      ...data.map((i) => ({
        id: i.id,
        appointmentId: i.appointment_id,
        at: new Date(i.starts_at),
        serviceId: i.service_id,
        serviceColor: serviceFamily(i.service.category, i.service.name) === "color" || /gloss|toner/i.test(i.service.name),
        clientId: i.appointment.client_id,
      })),
    );
    if (data.length < 1000) break;
  }
  return rows;
}

type FormulaRow = { clientId: string; itemId: string | null; serviceId: string | null; createdAt: string; lines: { productId: string; amount: number }[] };

// Upcoming clients' formulas that list products, newest first.
async function loadFormulas(supabase: Supabase, clientIds: string[]): Promise<FormulaRow[]> {
  const select = "client_id, appointment_item_id, created_at, item:appointment_items(service_id), formula_products(product_id, amount)";
  const rows: FormulaRow[] = [];
  const add = (data: { client_id: string; appointment_item_id: string | null; created_at: string; item: { service_id: string } | null; formula_products: { product_id: string; amount: number }[] }[]) =>
    rows.push(
      ...data
        .filter((f) => f.formula_products.length)
        .map((f) => ({ clientId: f.client_id, itemId: f.appointment_item_id, serviceId: f.item?.service_id ?? null, createdAt: f.created_at, lines: f.formula_products.map((l) => ({ productId: l.product_id, amount: l.amount })) })),
    );
  for (let i = 0; i < clientIds.length; i += 200) {
    const { data, error } = await supabase.from("client_formulas").select(select).in("client_id", clientIds.slice(i, i + 200));
    if (error) throw error;
    add(data);
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// What each upcoming service will use.
export function plannedUses(upcoming: readonly Upcoming[], formulas: readonly FormulaRow[], recipes: ReadonlyMap<string, { productId: string; amount: number }[]>): PlannedUse[] {
  const byClient = new Map<string, FormulaRow[]>();
  for (const f of formulas) byClient.set(f.clientId, [...(byClient.get(f.clientId) ?? []), f]);
  const uses: PlannedUse[] = [];
  for (const u of upcoming) {
    const theirs = u.clientId ? (byClient.get(u.clientId) ?? []) : [];
    const lines =
      theirs.find((f) => f.itemId === u.id)?.lines ??
      theirs.find((f) => f.serviceId === u.serviceId)?.lines ??
      (u.serviceColor && recipes.has(u.serviceId) ? theirs.find((f) => f.serviceId === null)?.lines : undefined) ??
      recipes.get(u.serviceId) ??
      [];
    for (const l of lines) uses.push({ appointmentId: u.appointmentId, at: u.at, productId: l.productId, amount: l.amount, color: u.serviceColor });
  }
  return uses;
}

export async function suggestReorders(
  supabase: Supabase,
  viewer: { location: { id: string; timezone: string }; canManage: boolean },
  now = new Date(),
): Promise<ReorderSuggestion[]> {
  const tz = viewer.location.timezone;
  const today = todayIn(tz, now);
  const to = startOfLocalDay(addDays(today, WINDOW_DAYS + 1), tz);

  const [rows, upcoming, recipeResult, ordersResult, suppliersResult] = await Promise.all([
    loadInventory(supabase, viewer.location.id),
    loadUpcoming(supabase, viewer.location.id, now, to),
    supabase.from("service_products").select("service_id, product_id, amount"),
    supabase
      .from("purchase_orders")
      .select("status, purchase_order_lines(product_id, quantity, received_quantity)")
      .eq("location_id", viewer.location.id)
      .in("status", ["draft", "sent", "partly_received"]),
    supabase.from("suppliers").select("id, name, lead_time_days"),
  ]);
  if (recipeResult.error) throw recipeResult.error;
  // The front desk can see orders; stylists can't, and that's fine here.
  const openLines = ordersResult.error ? [] : ordersResult.data.flatMap((o) => o.purchase_order_lines);
  if (suppliersResult.error) throw suppliersResult.error;

  const recipes = new Map<string, { productId: string; amount: number }[]>();
  for (const r of recipeResult.data) recipes.set(r.service_id, [...(recipes.get(r.service_id) ?? []), { productId: r.product_id, amount: r.amount }]);
  const clientIds = [...new Set(upcoming.map((u) => u.clientId).filter((c): c is string => !!c))];
  const formulas = await loadFormulas(supabase, clientIds);

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const onOrder = new Map<string, number>();
  for (const l of openLines) onOrder.set(l.product_id, (onOrder.get(l.product_id) ?? 0) + (l.quantity - l.received_quantity) * (rowById.get(l.product_id)?.size ?? 0));

  const stock: StockInfo[] = rows.map((r) => ({
    productId: r.id,
    supplierId: r.supplier?.id ?? null,
    onHand: r.on_hand,
    onOrder: onOrder.get(r.id) ?? 0,
    reorderPoint: r.reorder_point,
    reorderQuantity: r.reorder_quantity,
    size: r.size,
    costCents: r.cost_cents,
  }));
  const drafts = draftReorders(stock, outlook(stock, plannedUses(upcoming, formulas, recipes)));
  const suppliers = new Map(suppliersResult.data.map((s) => [s.id, s]));

  const suggestions: ReorderSuggestion[] = [];
  for (const d of drafts) {
    const supplier = suppliers.get(d.supplierId);
    if (!supplier) continue;
    const lines: ReorderLineView[] = d.lines.map((l) => {
      const row = rowById.get(l.productId)!;
      return {
        productId: l.productId,
        product: productName(row),
        quantity: `${l.quantity} ${row.unit === "unit" ? (l.quantity === 1 ? "unit" : "units") : containerName(row, l.quantity !== 1)}`,
        costCents: l.quantity * l.unitCostCents,
        reason: lineReason(row, l, now, tz),
      };
    });
    const headline = headlineFor(d, rowById, now, tz);
    let actionId: string | null = null;
    if (viewer.canManage) {
      const { data, error } = await supabase.rpc("record_ai_proposals", {
        p_location_id: viewer.location.id,
        p_feature: REORDER_FEATURE,
        p_subject: `${REORDER_FEATURE}:${d.supplierId}:${today}`,
        p_options: [
          {
            summary: `Order from ${supplier.name}: ${plural(d.lines.length, "product")}, ${formatPrice(d.totalCents)}`,
            reason: `${headline} ${lines.map((l) => `${l.product}: ${l.reason}`).join(" ")}`.slice(0, 2000),
            proposal: {
              changes: [],
              purchase_order: {
                location_id: viewer.location.id,
                supplier_id: d.supplierId,
                lines: d.lines.map((l, i) => ({ product_id: l.productId, quantity: l.quantity, unit_cost_cents: l.unitCostCents, reason: lines[i].reason.slice(0, 500) })),
              },
            } as Json,
          },
        ],
      });
      if (error) throw error;
      // Dismissed today.
      if (!data.length) continue;
      actionId = data[0];
    }
    suggestions.push({ actionId, supplierId: d.supplierId, supplier: supplier.name, leadDays: supplier.lead_time_days, headline, lines, totalCents: d.totalCents });
  }

  // Close today's suggestions that are no longer needed.
  if (viewer.canManage) {
    const { data: open } = await supabase
      .from("ai_actions")
      .select("subject")
      .eq("location_id", viewer.location.id)
      .eq("feature", REORDER_FEATURE)
      .eq("status", "proposed")
      .like("subject", `${REORDER_FEATURE}:%:${today}`);
    const current = new Set(suggestions.map((s) => `${REORDER_FEATURE}:${s.supplierId}:${today}`));
    for (const row of open ?? []) {
      if (row.subject && !current.has(row.subject)) {
        await supabase.rpc("record_ai_proposals", { p_location_id: viewer.location.id, p_feature: REORDER_FEATURE, p_subject: row.subject, p_options: [] });
      }
    }
  }
  return suggestions;
}
