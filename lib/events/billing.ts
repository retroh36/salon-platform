// Events' scheduled payments, with the service role (hourly at
// /api/cron/events, and straight after a retry or a booking): during the
// salon's sending hours, a reminder three days before each scheduled
// payment, then every payment that's due claimed (claim_event_payments,
// so two runs never charge one twice), charged to the event's card through
// its payment provider and recorded (record_event_charge: paid, or failed
// with a notice to the owners, managers and front desk), then receipts for
// everything paid that hasn't had one (the deposit and members' shares
// too). Messages are fixed templates by a channel the client allows.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { canSendAt } from "@/lib/automations";
import { channelFor, consentOf } from "@/lib/messaging/consent";
import { CONSENT_COLUMNS } from "@/lib/messaging/send";
import { withStopLine } from "@/lib/messaging/templates";
import { providerFor } from "@/lib/payments";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, toLocal } from "@/lib/scheduling/time";
import { PAYMENT_LABELS, receiptMessage, reminderMessage, type EventMessage } from "./messages";
import type { ScheduledKind } from "./pricing";

type Admin = SupabaseClient<Database>;

export const REMINDER_DAYS = 3;

export type EventBillingSummary = { reminded: number; charged: number; failed: number; receipts: number };

type Options = { businessId?: string; paymentId?: string; now?: Date };

export async function runEventBilling(admin: Admin, options: Options = {}): Promise<EventBillingSummary> {
  const now = options.now ?? new Date();
  const summary: EventBillingSummary = { reminded: 0, charged: 0, failed: 0, receipts: 0 };
  const open = await salonsInHours(admin, options, now);
  if (!open.size) return summary;

  summary.reminded = await sendReminders(admin, open, options, now);

  for (const businessId of open.keys()) {
    const charged = await chargeDuePayments(admin, { businessId, paymentId: options.paymentId });
    summary.charged += charged.charged;
    summary.failed += charged.failed;
  }

  summary.receipts = await sendReceipts(admin, open, options);
  return summary;
}

// Every scheduled payment that's due (or the one asked for): claimed,
// charged to the event's card and recorded. Also straight after "Try
// again" at the desk, at any hour.
export async function chargeDuePayments(admin: Admin, options: { businessId: string; paymentId?: string }): Promise<{ charged: number; failed: number; reasons: string[] }> {
  const out = { charged: 0, failed: 0, reasons: [] as string[] };
  const { data: due, error } = await admin.rpc("claim_event_payments", { p_business_id: options.businessId, p_payment_id: options.paymentId ?? null!, p_limit: 100 });
  if (error) throw error;
  for (const p of due) {
    const provider = providerFor(p.provider);
    const result = await provider.charge({
      amountCents: p.amount_cents,
      paymentMethodRef: p.payment_method_ref,
      description: PAYMENT_LABELS[p.kind as ScheduledKind],
      idempotencyKey: `event-payment:${p.payment_id}:${p.attempt}`,
    });
    const { data: status, error: recordError } = await admin.rpc("record_event_charge", {
      p_payment_id: p.payment_id,
      p_attempt: p.attempt,
      p_result: result.ok ? { ok: true, provider: provider.id, reference: result.reference } : { ok: false, reason: result.reason },
    });
    // Canceled meanwhile (the event lost, or its schedule changed): give it back.
    if (recordError?.code === "55000") {
      if (result.ok) await provider.refund(result.reference);
      continue;
    }
    if (recordError) throw recordError;
    if (status === "paid") out.charged += 1;
    else {
      out.failed += 1;
      if (!result.ok) out.reasons.push(result.reason);
    }
  }
  return out;
}

// Salons where it's 9am to 8pm now, with their time zone and name.
async function salonsInHours(admin: Admin, options: Options, now: Date): Promise<Map<string, { tz: string; name: string }>> {
  let query = admin.from("locations").select("business_id, timezone, business:businesses(name)");
  if (options.businessId) query = query.eq("business_id", options.businessId);
  const { data, error } = await query;
  if (error) throw error;
  const out = new Map<string, { tz: string; name: string }>();
  for (const l of data) if (!out.has(l.business_id) && canSendAt(toLocal(now, l.timezone).minute)) out.set(l.business_id, { tz: l.timezone, name: l.business.name });
  return out;
}

type ClientRow = { first_name: string } & Parameters<typeof consentOf>[0];

async function send(admin: Admin, businessId: string, client: ClientRow | null, message: EventMessage): Promise<boolean> {
  const dest = client ? channelFor(consentOf(client), "appointment", "email") : null;
  if (!dest) return false;
  const { error } = await admin.from("outbox_messages").insert({
    business_id: businessId,
    channel: dest.channel,
    to_address: dest.to,
    subject: dest.channel === "email" ? message.subject : null,
    body: dest.channel === "sms" ? withStopLine(message.body) : message.body,
  });
  if (error) throw error;
  return true;
}

async function sendReminders(admin: Admin, open: Map<string, { tz: string; name: string }>, options: Options, now: Date): Promise<number> {
  let sent = 0;
  for (const [businessId, salon] of open) {
    const today = toLocal(now, salon.tz).date;
    let query = admin
      .from("event_payments")
      .select(`id, kind, amount_cents, due_on, event:events!inner(title, status, card_label, client:clients(first_name, ${CONSENT_COLUMNS}))`)
      .eq("business_id", businessId)
      .eq("status", "scheduled")
      .is("reminded_at", null)
      .gt("due_on", today)
      .lte("due_on", addDays(today, REMINDER_DAYS))
      .in("event.status", ["booked", "trial_done"]);
    if (options.paymentId) query = query.eq("id", options.paymentId);
    const { data, error } = await query;
    if (error) throw error;
    for (const p of data) {
      const client = p.event.client as ClientRow | null;
      const message = reminderMessage(salon.name, client?.first_name ?? "", p.event.title, p.kind as ScheduledKind, p.amount_cents, formatLongDay(p.due_on, false), p.event.card_label);
      // Recorded either way, so a client we can't reach isn't tried hourly.
      if (await send(admin, businessId, client, message)) sent += 1;
      await admin.from("event_payments").update({ reminded_at: now.toISOString() }).eq("id", p.id);
    }
  }
  return sent;
}

async function sendReceipts(admin: Admin, open: Map<string, { tz: string; name: string }>, options: Options): Promise<number> {
  let sent = 0;
  for (const [businessId, salon] of open) {
    let query = admin
      .from("event_payments")
      .select(`id, event_id, kind, amount_cents, card_label, member:event_members(name, email, phone), event:events!inner(title, main_cents, client:clients(first_name, ${CONSENT_COLUMNS}))`)
      .eq("business_id", businessId)
      .eq("status", "paid")
      .is("receipt_sent_at", null);
    if (options.paymentId) query = query.eq("id", options.paymentId);
    const { data, error } = await query;
    if (error) throw error;
    for (const p of data) {
      let ok: boolean;
      if (p.kind === "member") {
        // A member paying their own gets theirs at the address the link went to.
        const { data: link } = await admin.from("event_links").select("channel, sent_to").eq("event_id", p.event_id).eq("kind", "member").eq("status", "done").order("done_at", { ascending: false }).limit(1).maybeSingle();
        const message = receiptMessage(salon.name, p.member?.name ?? "", p.event.title, "share", p.amount_cents, p.card_label, 0);
        ok = Boolean(link);
        if (link) await admin.from("outbox_messages").insert({ business_id: businessId, channel: link.channel, to_address: link.sent_to, subject: link.channel === "email" ? message.subject : null, body: link.channel === "sms" ? withStopLine(message.body) : message.body });
      } else {
        const { data: paid } = await admin.from("event_payments").select("amount_cents").eq("event_id", p.event_id).neq("kind", "member").eq("status", "paid");
        const left = p.event.main_cents - (paid ?? []).reduce((a, x) => a + x.amount_cents, 0);
        const client = p.event.client as ClientRow | null;
        ok = await send(admin, businessId, client, receiptMessage(salon.name, client?.first_name ?? "", p.event.title, PAYMENT_LABELS[p.kind as ScheduledKind], p.amount_cents, p.card_label, left));
      }
      if (ok) sent += 1;
      await admin.from("event_payments").update({ receipt_sent_at: new Date().toISOString() }).eq("id", p.id);
    }
  }
  return sent;
}
