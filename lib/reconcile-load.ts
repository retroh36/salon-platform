import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { reconcile, type PaymentLine, type ReconcileRange } from "@/lib/reconcile";
import { all } from "@/lib/reports-load";
import { tenderOf } from "@/lib/reports";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, toLocal } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";

type Supabase = SupabaseClient<Database>;

// The range's payments, sales and close-outs at a location, with the
// signed-in person's own access (`reports`), worked out by `reconcile`.
export async function loadReconcile(supabase: Supabase, businessId: string, location: { id: string; timezone: string }, range: ReconcileRange) {
  const tz = location.timezone;
  const start = startOfLocalDay(range.from, tz).toISOString();
  const end = startOfLocalDay(addDays(range.to, 1), tz).toISOString();
  const [payments, sales, closes, team] = await Promise.all([
    all((from, to) =>
      supabase
        .from("payments")
        .select("method, amount_cents, processor, reference, created_at, sale:sales(number)")
        .eq("location_id", location.id)
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    all((from, to) => supabase.from("sales").select("total_cents, created_at").eq("location_id", location.id).gte("created_at", start).lt("created_at", end).order("id").range(from, to)),
    supabase.from("cash_closeouts").select("day, expected_cents, counted_cents, deposit_cents, closed_by").eq("location_id", location.id).gte("day", range.from).lte("day", range.to),
    supabase.from("staff").select("id, first_name, last_name").eq("business_id", businessId),
  ]);
  if (closes.error) throw closes.error;
  if (team.error) throw team.error;
  const name = new Map(team.data.map((s) => [s.id, fullName(s)]));
  const dayOf = (iso: string) => toLocal(new Date(iso), tz).date;
  const paid = payments.map((p) => ({ ...p, day: dayOf(p.created_at) }));
  const days = reconcile(
    range,
    paid,
    sales.map((s) => ({ day: dayOf(s.created_at), totalCents: s.total_cents })),
    closes.data.map((c) => ({ day: c.day, expectedCents: c.expected_cents, countedCents: c.counted_cents, depositCents: c.deposit_cents, by: c.closed_by ? (name.get(c.closed_by) ?? "A former team member") : null })),
  );
  const lines: PaymentLine[] = paid.map((p) => ({ at: p.created_at, day: p.day, saleNumber: p.sale?.number ?? 0, tender: tenderOf(p), amountCents: p.amount_cents, reference: p.reference }));
  return { days, lines };
}
