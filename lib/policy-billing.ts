// Charging the policy's fees, with the service role (every 15 minutes at
// /api/cron/fees, "Charge due fees now" on the policy page, and straight
// after a waiver or a retry). Each due fee is claimed first
// (claim_policy_fees, so two runs never charge one twice), charged to the
// card on file through its payment provider, and recorded
// (record_fee_charge: charged, or failed with a notice to the front of
// house). Then: receipts for fees charged (a fixed template, through the
// outbox), refunds for fees waived after charging, and deposits to give
// back (a visit the salon canceled, or the client canceled in good time).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { providerFor } from "./payments/index.ts";
import { feeReceipt } from "./policy.ts";
import { toLocal } from "./scheduling/time.ts";

type Admin = SupabaseClient<Database>;

export type FeeRunSummary = { charged: number; failed: number; receipts: number; refunded: number; depositsRefunded: number };

export async function runPolicyCharges(admin: Admin, options: { businessId?: string; feeId?: string } = {}): Promise<FeeRunSummary> {
  const summary: FeeRunSummary = { charged: 0, failed: 0, receipts: 0, refunded: 0, depositsRefunded: 0 };

  const { data: due, error } = await admin.rpc("claim_policy_fees", { p_business_id: options.businessId ?? null!, p_fee_id: options.feeId ?? null!, p_limit: 100 });
  if (error) throw error;
  for (const fee of due) {
    const result = await providerFor(fee.provider).charge({
      amountCents: fee.amount_cents,
      paymentMethodRef: fee.payment_method_ref,
      description: fee.kind === "no_show" ? "No-show fee" : "Late cancellation fee",
      idempotencyKey: `fee:${fee.fee_id}:${fee.attempt}`,
    });
    const { data: status, error: recordError } = await admin.rpc("record_fee_charge", {
      p_fee_id: fee.fee_id,
      p_attempt: fee.attempt,
      p_result: result.ok ? { ok: true, provider: fee.provider, reference: result.reference } : { ok: false, reason: result.reason },
    });
    // Waived (or recorded) meanwhile: give back what was just taken.
    if (recordError?.code === "55000") {
      if (result.ok) await providerFor(fee.provider).refund(result.reference);
      continue;
    }
    if (recordError) throw recordError;
    if (status === "charged") summary.charged += 1;
    else summary.failed += 1;
  }

  summary.receipts = await sendReceipts(admin, options);
  summary.refunded = await refundWaived(admin, options);
  summary.depositsRefunded = await refundDeposits(admin, options);
  return summary;
}

async function sendReceipts(admin: Admin, options: { businessId?: string; feeId?: string }): Promise<number> {
  let query = admin
    .from("policy_fees")
    .select("id, business_id, kind, fee_cents, from_deposit_cents, card_label, appointment:appointments(starts_at), client:clients(email, phone), business:businesses(name), location:locations(timezone)")
    .eq("status", "charged")
    .is("receipt_sent_at", null)
    .gt("fee_cents", 0);
  if (options.businessId) query = query.eq("business_id", options.businessId);
  if (options.feeId) query = query.eq("id", options.feeId);
  const { data, error } = await query;
  if (error) throw error;
  let sent = 0;
  for (const f of data) {
    const to = f.client.email ?? f.client.phone;
    if (to) {
      const local = toLocal(new Date(f.appointment.starts_at), f.location.timezone);
      const when = new Date(`${local.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
      const receipt = feeReceipt(f.business.name, f.kind as "late_cancel" | "no_show", f.fee_cents, f.card_label, f.from_deposit_cents, when);
      const channel = f.client.email ? "email" : "sms";
      const { error: outError } = await admin
        .from("outbox_messages")
        .insert({ business_id: f.business_id, channel, to_address: to, subject: channel === "email" ? receipt.subject : null, body: receipt.body });
      if (outError) throw outError;
    }
    const { error: markError } = await admin.rpc("record_fee_receipt", { p_fee_id: f.id });
    if (markError) throw markError;
    sent += 1;
  }
  return sent;
}

async function refundWaived(admin: Admin, options: { businessId?: string; feeId?: string }): Promise<number> {
  let query = admin
    .from("policy_fees")
    .select("id, provider, provider_reference, from_deposit_cents, appointment:appointments(deposit_provider, deposit_reference)")
    .eq("refund_due", true);
  if (options.businessId) query = query.eq("business_id", options.businessId);
  if (options.feeId) query = query.eq("id", options.feeId);
  const { data, error } = await query;
  if (error) throw error;
  let refunded = 0;
  for (const f of data) {
    const parts: { provider: string; reference: string }[] = [];
    if (f.provider && f.provider_reference) parts.push({ provider: f.provider, reference: f.provider_reference });
    if (f.from_deposit_cents > 0 && f.appointment.deposit_provider && f.appointment.deposit_reference) parts.push({ provider: f.appointment.deposit_provider, reference: f.appointment.deposit_reference });
    const results = await Promise.all(parts.map((p) => providerFor(p.provider).refund(p.reference)));
    const ok = results.every((r) => r.ok);
    const { error: recordError } = await admin.rpc("record_fee_refund", { p_fee_id: f.id, p_ok: ok, p_detail: ok ? "Given back to the card" : "The provider didn't accept the refund" });
    if (recordError) throw recordError;
    if (ok) refunded += 1;
  }
  return refunded;
}

async function refundDeposits(admin: Admin, options: { businessId?: string }): Promise<number> {
  let query = admin.from("appointments").select("id, deposit_provider, deposit_reference").eq("deposit_outcome", "refund_due");
  if (options.businessId) query = query.eq("business_id", options.businessId);
  const { data, error } = await query;
  if (error) throw error;
  let refunded = 0;
  for (const a of data) {
    const ok = !!(a.deposit_provider && a.deposit_reference) && (await providerFor(a.deposit_provider).refund(a.deposit_reference)).ok;
    const { error: recordError } = await admin.rpc("record_deposit_refund", { p_appointment_id: a.id, p_ok: ok });
    if (recordError) throw recordError;
    if (ok) refunded += 1;
  }
  return refunded;
}
