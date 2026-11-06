import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { CashMove, DrawerCount } from "@/lib/drawer";
import { addDays, type LocalDate } from "@/lib/scheduling/time";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { fullName } from "@/lib/staff";

type Supabase = SupabaseClient<Database>;

// Today's drawer at a location: what the opening should hold (what the last
// close-out left, else the usual float), the counts so far (and the
// close-out once it's done), and every cash payment today with who took it.
export async function loadDrawer(supabase: Supabase, businessId: string, location: { id: string; timezone: string }, day: LocalDate) {
  const [lastClose, business, counts, close, cash, team, skip] = await Promise.all([
    supabase.from("cash_closeouts").select("counted_cents, deposit_cents").eq("location_id", location.id).lt("day", day).order("day", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("businesses").select("cash_float_cents").eq("id", businessId).single(),
    supabase.from("drawer_counts").select("id, kind, expected_cents, counted_cents, note, counted_by, counted_at").eq("location_id", location.id).eq("day", day).order("counted_at"),
    supabase.from("cash_closeouts").select("id, expected_cents, counted_cents, deposit_cents, note, closed_by, closed_at").eq("location_id", location.id).eq("day", day).maybeSingle(),
    supabase
      .from("payments")
      .select("amount_cents, created_at, created_by, sale_id, sale:sales(number)")
      .eq("location_id", location.id)
      .eq("method", "cash")
      .gte("created_at", startOfLocalDay(day, location.timezone).toISOString())
      .lt("created_at", startOfLocalDay(addDays(day, 1), location.timezone).toISOString())
      .order("created_at"),
    supabase.from("staff").select("id, first_name, last_name").eq("business_id", businessId),
    supabase.from("drawer_skips").select("reason, skipped_by, asked_by, created_at").eq("location_id", location.id).eq("day", day).maybeSingle(),
  ]);
  for (const r of [business, counts, cash, team, skip]) if (r.error) throw r.error;
  const name = new Map(team.data!.map((s) => [s.id, fullName(s)]));
  const who = (id: string | null) => (id ? (name.get(id) ?? "A former team member") : null);
  const list: DrawerCount[] = counts.data!.map((c) => ({ id: c.id, kind: c.kind as "open" | "mid", expectedCents: c.expected_cents, countedCents: c.counted_cents, at: c.counted_at, by: who(c.counted_by), note: c.note }));
  if (close.data) list.push({ id: close.data.id, kind: "close", expectedCents: close.data.expected_cents, countedCents: close.data.counted_cents, at: close.data.closed_at, by: who(close.data.closed_by), note: close.data.note });
  const moves: CashMove[] = cash.data!.map((p) => ({ at: p.created_at, amountCents: p.amount_cents, saleId: p.sale_id, saleNumber: p.sale?.number ?? 0, by: who(p.created_by) }));
  return {
    openingExpectedCents: lastClose.data ? lastClose.data.counted_cents - lastClose.data.deposit_cents : business.data!.cash_float_cents,
    counts: list,
    opening: list.find((c) => c.kind === "open") ?? null,
    depositCents: close.data?.deposit_cents ?? null,
    moves,
    // A manager let today's cash go ahead without the opening count.
    skip: skip.data ? { reason: skip.data.reason, by: who(skip.data.skipped_by), askedBy: who(skip.data.asked_by), at: skip.data.created_at } : null,
  };
}

// Every count and close-out in the last `days` days, newest first (the
// Reports' drawer history).
export async function loadDrawerHistory(supabase: Supabase, businessId: string, locationId: string, today: LocalDate, days = 30) {
  const since = addDays(today, -(days - 1));
  const [counts, closes, team] = await Promise.all([
    supabase.from("drawer_counts").select("id, day, kind, expected_cents, counted_cents, note, counted_by, counted_at").eq("location_id", locationId).gte("day", since).order("counted_at", { ascending: false }),
    supabase.from("cash_closeouts").select("id, day, expected_cents, counted_cents, deposit_cents, note, closed_by, closed_at").eq("location_id", locationId).gte("day", since),
    supabase.from("staff").select("id, first_name, last_name").eq("business_id", businessId),
  ]);
  for (const r of [counts, closes, team]) if (r.error) throw r.error;
  const name = new Map(team.data!.map((s) => [s.id, fullName(s)]));
  const who = (id: string | null) => (id ? (name.get(id) ?? "A former team member") : null);
  const rows: (DrawerCount & { day: LocalDate; depositCents: number | null })[] = [
    ...counts.data!.map((c) => ({ id: c.id, day: c.day, kind: c.kind as "open" | "mid", expectedCents: c.expected_cents, countedCents: c.counted_cents, at: c.counted_at, by: who(c.counted_by), note: c.note, depositCents: null })),
    ...closes.data!.map((c) => ({ id: c.id, day: c.day, kind: "close" as const, expectedCents: c.expected_cents, countedCents: c.counted_cents, at: c.closed_at, by: who(c.closed_by), note: c.note, depositCents: c.deposit_cents })),
  ];
  return rows.sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at));
}

// Whether cash can be taken today (complete_sale's rule): the drawer has
// its opening count, or a manager skipped it.
export async function drawerReadyToday(supabase: Supabase, locationId: string, day: LocalDate) {
  const [counted, skipped] = await Promise.all([
    supabase.from("drawer_counts").select("id", { count: "exact", head: true }).eq("location_id", locationId).eq("day", day).eq("kind", "open"),
    supabase.from("drawer_skips").select("id", { count: "exact", head: true }).eq("location_id", locationId).eq("day", day),
  ]);
  if (counted.error) throw counted.error;
  if (skipped.error) throw skipped.error;
  return (counted.count ?? 0) + (skipped.count ?? 0) > 0;
}
