// Loading the owners' reports (worked out in ./reports.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, type LocalDate } from "@/lib/scheduling/time";
import { bookingSourcesReport } from "@/lib/online-booking/sources";
import { closeout, giftCardActivity, giftCardLiability, rebookingAtCheckout, unusedPackageValue, type CardRow, type PackageItemRow } from "./reports";

type Supabase = SupabaseClient<Database>;

// Every row of a query, a page at a time.
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    rows.push(...data!);
    if (data!.length < 1000) break;
  }
  return rows;
}

export async function loadGiftCardLiability(supabase: Supabase, businessId: string, now = new Date()) {
  const cards = await all<CardRow>((from, to) =>
    supabase.from("gift_cards").select("kind, status, balance_cents, expires_at").eq("business_id", businessId).gt("balance_cents", 0).order("id").range(from, to),
  );
  return giftCardLiability(cards, now);
}

async function packageRows(supabase: Supabase, businessId: string) {
  return all<{ total: number; used: number; use_value_cents: number; service: { name: string }; client_package: { client_id: string; status: PackageItemRow["status"]; expires_at: string | null; name: string; client: { first_name: string; last_name: string } } }>(
    (from, to) =>
      supabase
        .from("client_package_items")
        .select("total, used, use_value_cents, service:services(name), client_package:client_packages!inner(client_id, status, expires_at, name, client:clients(first_name, last_name))")
        .eq("business_id", businessId)
        .eq("client_package.status", "active")
        .order("id")
        .range(from, to) as never,
  );
}

export async function loadUnusedPackages(supabase: Supabase, businessId: string, now = new Date()) {
  const rows = await packageRows(supabase, businessId);
  const items: PackageItemRow[] = rows.map((r) => ({ client_id: r.client_package.client_id, status: r.client_package.status, expires_at: r.client_package.expires_at, total: r.total, used: r.used, use_value_cents: r.use_value_cents }));
  const value = unusedPackageValue(items, now);
  // Who has them: per client, the uses left and what they're worth.
  const byClient = new Map<string, { firstName: string; lastName: string; packages: Set<string>; uses: string[]; cents: number }>();
  for (const r of rows) {
    const p = r.client_package;
    if (r.used >= r.total || (p.expires_at && new Date(p.expires_at) <= now)) continue;
    const c = byClient.get(p.client_id) ?? { firstName: p.client.first_name, lastName: p.client.last_name, packages: new Set(), uses: [], cents: 0 };
    c.packages.add(p.name);
    c.uses.push(`${r.total - r.used} ${r.service.name}`);
    c.cents += (r.total - r.used) * r.use_value_cents;
    byClient.set(p.client_id, c);
  }
  const clients = [...byClient.entries()].map(([id, c]) => ({ clientId: id, ...c, packages: [...c.packages] })).sort((a, b) => b.cents - a.cents);
  return { ...value, clients };
}

export async function loadGiftCardActivity(supabase: Supabase, businessId: string, from: LocalDate, to: LocalDate, timeZone: string) {
  const events = await all<{ kind: string; amount_cents: number; card: { kind: "purchased" | "promotional" } }>((f, t) =>
    supabase
      .from("gift_card_events")
      .select("kind, amount_cents, card:gift_cards(kind)")
      .eq("business_id", businessId)
      .gte("created_at", startOfLocalDay(from, timeZone).toISOString())
      .lt("created_at", startOfLocalDay(addDays(to, 1), timeZone).toISOString())
      .order("id")
      .range(f, t) as never,
  );
  return giftCardActivity(events.map((e) => ({ kind: e.kind, amount_cents: e.amount_cents, card_kind: e.card.kind })));
}

export async function loadCloseout(supabase: Supabase, location: { id: string; timezone: string }, day: LocalDate) {
  const [payments, { data: saved, error }] = await Promise.all([
    all<{ method: Database["public"]["Enums"]["payment_method"]; amount_cents: number; processor: string | null }>((from, to) =>
      supabase
        .from("payments")
        .select("method, amount_cents, processor")
        .eq("location_id", location.id)
        .gte("created_at", startOfLocalDay(day, location.timezone).toISOString())
        .lt("created_at", startOfLocalDay(addDays(day, 1), location.timezone).toISOString())
        .order("id")
        .range(from, to),
    ),
    supabase.from("cash_closeouts").select("expected_cents, counted_cents, note, closed_at, staff:staff(first_name)").eq("location_id", location.id).eq("day", day).maybeSingle(),
  ]);
  if (error) throw error;
  return { ...closeout(payments), saved };
}

// Visits checked out in a period (not voided) and whether the client left
// with their next visit booked, by the visit's main stylist (the one on its
// first service line).
export async function loadRebooking(supabase: Supabase, location: { id: string; timezone: string }, from: LocalDate, to: LocalDate) {
  const sales = await all<{ rebook_appointment_id: string | null; sale_items: { kind: string; staff_id: string | null; position: number }[] }>((f, t) =>
    supabase
      .from("sales")
      .select("rebook_appointment_id, sale_items(kind, staff_id, position)")
      .eq("location_id", location.id)
      .not("appointment_id", "is", null)
      .neq("status", "voided")
      .gte("created_at", startOfLocalDay(from, location.timezone).toISOString())
      .lt("created_at", startOfLocalDay(addDays(to, 1), location.timezone).toISOString())
      .order("id")
      .range(f, t) as never,
  );
  return rebookingAtCheckout(
    sales.map((s) => ({
      staff_id: [...s.sale_items].filter((i) => i.kind === "service").sort((a, b) => a.position - b.position)[0]?.staff_id ?? null,
      rebooked: s.rebook_appointment_id !== null,
    })),
  );
}

// Online bookings made in a period, by where they came from (the tag on
// the link they followed), with what the visits brought in once checked out.
export async function loadBookingSources(supabase: Supabase, location: { id: string; timezone: string }, from: LocalDate, to: LocalDate) {
  const rows = await all<{ online_source: string | null; status: string; sales: { status: string; total_cents: number; tax_cents: number; tip_cents: number; refunded_cents: number }[] }>((f, t) =>
    supabase
      .from("appointments")
      .select("online_source, status, sales!sales_appointment_id_fkey(status, total_cents, tax_cents, tip_cents, refunded_cents)")
      .eq("location_id", location.id)
      .eq("source", "online")
      .gte("created_at", startOfLocalDay(from, location.timezone).toISOString())
      .lt("created_at", startOfLocalDay(addDays(to, 1), location.timezone).toISOString())
      .order("id")
      .range(f, t) as never,
  );
  return bookingSourcesReport(
    rows.map((r) => ({
      source: r.online_source,
      completed: r.status === "completed",
      revenueCents: r.sales.filter((s) => s.status !== "voided").reduce((n, s) => n + Math.max(0, s.total_cents - s.tax_cents - s.tip_cents - s.refunded_cents), 0),
    })),
  );
}
