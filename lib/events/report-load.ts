// Loads every event at the salon for the events report (eventReport), with
// its payments, as local dates. Owners and managers (reports).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { toLocal } from "@/lib/scheduling/time";
import type { ReportEvent } from "./report";

export async function loadEventReportRows(supabase: SupabaseClient<Database>, businessId: string, timeZone: string): Promise<ReportEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id, status, event_date, created_at, booked_at, total_cents, deposit_cents, event_payments(kind, status, amount_cents, paid_at)")
    .eq("business_id", businessId)
    .limit(5000);
  if (error) throw error;
  const day = (iso: string) => toLocal(new Date(iso), timeZone).date;
  return data.map((e) => ({
    id: e.id,
    status: e.status,
    date: e.event_date,
    createdOn: day(e.created_at),
    bookedOn: e.booked_at ? day(e.booked_at) : null,
    totalCents: e.total_cents,
    depositCents: e.deposit_cents,
    payments: e.event_payments.map((p) => ({ kind: p.kind, status: p.status, amountCents: p.amount_cents, paidOn: p.paid_at ? day(p.paid_at) : null })),
  }));
}
