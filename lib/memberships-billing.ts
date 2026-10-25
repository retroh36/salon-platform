// Membership billing, with the service role (the nightly job, "Run
// renewals now" for owners, and right after a card is updated or a pause
// ends). For each membership that might have something due: the day's
// changes first (advance_membership: a pause or cancellation that starts,
// a pause that ends), then the payment through its provider, recorded with
// record_membership_charge (a renewal sale, or a failed payment with the
// next try and a notice to staff). The database refuses to record a
// payment that isn't due, so running it twice never charges twice.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { providerFor } from "./payments/index.ts";
import { todayIn } from "./scheduling/time.ts";

type Admin = SupabaseClient<Database>;

export type BillingSummary = { checked: number; renewed: number; failed: number; canceled: number; paused: number; resumed: number };

export async function runMembershipBilling(admin: Admin, options: { businessId?: string; membershipId?: string; now?: Date } = {}): Promise<BillingSummary> {
  const now = options.now ?? new Date();
  let query = admin
    .from("client_memberships")
    .select("id, business_id, status, name, payment_method_ref, provider, current_period_end, next_retry_at, resume_on, cancels_on, pause_from, location:locations(timezone)")
    .in("status", ["active", "past_due", "paused"]);
  if (options.businessId) query = query.eq("business_id", options.businessId);
  if (options.membershipId) query = query.eq("id", options.membershipId);
  const { data, error } = await query;
  if (error) throw error;

  const summary: BillingSummary = { checked: 0, renewed: 0, failed: 0, canceled: 0, paused: 0, resumed: 0 };
  for (const m of data) {
    const today = todayIn(m.location.timezone, now);
    const maybe =
      (m.status === "active" && (m.current_period_end <= today || (m.cancels_on ?? "9999") <= today || (m.pause_from ?? "9999") <= today)) ||
      // A retry is due any time on its day (the database decides).
      (m.status === "past_due" && (!m.next_retry_at || todayIn(m.location.timezone, new Date(m.next_retry_at)) <= today)) ||
      (m.status === "paused" && m.resume_on !== null && m.resume_on <= today);
    if (!maybe) continue;
    summary.checked += 1;

    const { data: step, error: stepError } = await admin.rpc("advance_membership", { p_membership_id: m.id, p_today: today });
    if (stepError) throw stepError;
    const s = step as { status: string; due: boolean; amount_cents: number; attempt: number };
    if (m.status !== s.status) {
      if (s.status === "canceled") summary.canceled += 1;
      if (s.status === "paused") summary.paused += 1;
      if (m.status === "paused" && s.status === "active") summary.resumed += 1;
    }
    if (!s.due) continue;

    const provider = providerFor(m.provider);
    const result = await provider.charge({
      amountCents: s.amount_cents,
      paymentMethodRef: m.payment_method_ref,
      description: `${m.name} membership`,
      idempotencyKey: `membership:${m.id}:${m.current_period_end}:${s.attempt}`,
    });
    const { data: recorded, error: recordError } = await admin.rpc("record_membership_charge", {
      p_membership_id: m.id,
      p_today: today,
      p_result: result.ok ? { ok: true, reference: result.reference } : { ok: false, reason: result.reason },
    });
    // Recorded by another run meanwhile: nothing more to do.
    if (recordError?.code === "55000") continue;
    if (recordError) throw recordError;
    const status = (recorded as { status: string }).status;
    if (status === "active") summary.renewed += 1;
    else {
      summary.failed += 1;
      if (status === "canceled") summary.canceled += 1;
    }
  }
  return summary;
}
