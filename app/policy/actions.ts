"use server";

// Staff actions on the cancellation policy, from booking details, the
// client profile and the policy page: send a secure card (and deposit)
// link, waive a fee with a reason, try a failed one again, take a card
// off file. The database checks who may do each; charging and refunds run
// with the service role straight after (lib/policy-billing.ts).

import { blockedReason } from "@/lib/messaging/send";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { siteUrl } from "@/lib/branding";
import { normalEmail, phoneDigits } from "@/lib/online-booking/contact";
import { newSecret, sha256 } from "@/lib/online-booking/security";
import { isUuid } from "@/lib/ids";
import { CARD_LINK_HOURS, cardLinkMessage } from "@/lib/policy";
import { runPolicyCharges } from "@/lib/policy-billing";
import { loadVisitPolicies } from "@/lib/policy-visits";
import { policyForBooking, type BookingPolicy } from "@/lib/booking-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { partToken } from "@/lib/finish-links";

export type PolicyActionResult = { ok: true; message: string } | { ok: false; message: string };
export type CardLinkSent = { ok: true; message: string; depositCents: number } | { ok: false; message: string };

const NOT_ALLOWED = "You don't have permission to do that.";

function refresh() {
  revalidatePath("/calendar", "layout");
  revalidatePath("/policy");
  revalidatePath("/clients", "layout");
}

// What the cancellation policy asks of a booking before it's made (a card
// on file, a deposit), for the booking form and Denise's chat. The prices
// only size the deposit shown; the link works its amount out again from
// the visit once it's booked.
export async function bookingPolicy(clientId: string, lines: { serviceId: string; staffId: string; priceCents: number }[]): Promise<BookingPolicy | null> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role) || !isUuid(clientId) || !Array.isArray(lines)) return null;
  const clean = lines
    .filter((l) => l && isUuid(String(l.serviceId)) && isUuid(String(l.staffId)))
    .slice(0, 12)
    .map((l) => ({ serviceId: String(l.serviceId), staffId: String(l.staffId), priceCents: Number.isInteger(l.priceCents) && l.priceCents > 0 ? l.priceCents : 0 }));
  return policyForBooking(supabase, me.business_id, me.role, clientId, clean);
}

// A link for the client to add a card (and pay the deposit this visit
// needs), by text or email. With finishToken it's the card part of a
// "Finish your booking" link (lib/finish-links.ts): its token comes from
// that one and nothing is sent here.
export async function sendCardLink(input: { clientId: string; appointmentId: string | null; channel: "sms" | "email"; to: string; finishToken?: string }): Promise<CardLinkSent> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.clientId) || (input.appointmentId && !isUuid(input.appointmentId))) return { ok: false, message: "That client no longer exists." };
  const to = input.channel === "sms" ? phoneDigits(input.to) : normalEmail(input.to);
  if (!to) return { ok: false, message: input.channel === "sms" ? "Enter a 10-digit mobile number." : "Enter an email address like name@example.com." };

  // Never a text to a number that replied STOP, or on a channel they turned off.
  const { data: who } = await supabase.from("clients").select("first_name").eq("id", input.clientId).maybeSingle();
  const blocked = await blockedReason(createAdminClient(), input.channel, to, who ? { id: input.clientId, firstName: who.first_name } : null);
  if (blocked) return { ok: false, message: blocked };

  // The deposit is worked out here, never taken from the browser.
  let deposit = 0;
  if (input.appointmentId) {
    const { data: a, error } = await supabase
      .from("appointments")
      .select("id, client_id, status, created_at, starts_at, deposit_cents, deposit_paid_cents, appointment_items(service_id, staff_id, price_cents)")
      .eq("id", input.appointmentId)
      .single();
    if (error || a.client_id !== input.clientId) return { ok: false, message: "That visit no longer exists." };
    const policies = await loadVisitPolicies(supabase, me.business_id, me.role, [
      {
        id: a.id,
        clientId: a.client_id,
        status: a.status,
        serviceIds: a.appointment_items.map((i) => i.service_id),
        staffIds: [...new Set(a.appointment_items.map((i) => i.staff_id))],
        visitCents: a.appointment_items.reduce((sum, i) => sum + i.price_cents, 0),
        serviceDepositCents: a.deposit_cents,
        depositPaidCents: a.deposit_paid_cents,
        bookedAt: a.created_at,
        startsAt: a.starts_at,
      },
    ]);
    deposit = policies.get(a.id)?.depositNeededCents ?? 0;
  }

  const token = input.finishToken ? partToken(input.finishToken, "card") : newSecret();
  const { error } = await supabase.rpc("create_card_request", {
    p_client_id: input.clientId,
    p_appointment_id: input.appointmentId ?? (null as never),
    p_token_hash: sha256(token),
    p_deposit_cents: deposit,
    p_channel: input.channel,
    p_to: input.to.trim(),
    p_hours: CARD_LINK_HOURS,
  });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "55000") return { ok: false, message: error.message };
  if (error) throw error;
  if (input.finishToken) return { ok: true, message: "Card link made.", depositCents: deposit };
  const { data: business } = await supabase.from("businesses").select("name").eq("id", me.business_id).single();
  const message = cardLinkMessage(business?.name ?? "The salon", `${siteUrl()}/card/${token}`, deposit, input.channel);
  // The outbox is written with the service role (texts and email aren't
  // connected yet).
  const { error: outError } = await createAdminClient().from("outbox_messages").insert({ business_id: me.business_id, channel: input.channel, to_address: input.to.trim(), subject: message.subject, body: message.body });
  if (outError) throw outError;
  refresh();
  return { ok: true, message: `${deposit > 0 ? "Deposit and card link" : "Card link"} sent to ${input.to.trim()}.`, depositCents: deposit };
}

export async function waiveFee(feeId: string, reason: string): Promise<PolicyActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(feeId)) return { ok: false, message: "That fee no longer exists." };
  if (!reason.trim()) return { ok: false, message: "Say why the fee is waived." };
  const { data, error } = await supabase.rpc("waive_policy_fee", { p_fee_id: feeId, p_reason: reason.trim().slice(0, 300) });
  if (error?.code === "42501") return { ok: false, message: "Your salon doesn't let your role waive fees. Ask a manager or owner." };
  if (error?.code === "55000" || error?.code === "22023") return { ok: false, message: error.message };
  if (error) throw error;
  const refund = (data as { refund_due: boolean }).refund_due;
  // Give a charged fee back now.
  if (refund) after(() => runPolicyCharges(createAdminClient(), { feeId }).then(() => undefined));
  refresh();
  return { ok: true, message: refund ? "Fee waived. It's being refunded to the card." : "Fee waived. It won't be charged." };
}

export async function retryFee(feeId: string): Promise<PolicyActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(feeId)) return { ok: false, message: "That fee no longer exists." };
  const { error } = await supabase.rpc("retry_policy_fee", { p_fee_id: feeId });
  if (error?.hint === "no_card") return { ok: false, message: "There's no card on file. Send them a card link first." };
  if (error?.code === "55000") return { ok: false, message: error.message };
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error) throw error;
  const s = await runPolicyCharges(createAdminClient(), { feeId });
  refresh();
  return s.charged ? { ok: true, message: "Charged. A receipt is on its way to the client." } : { ok: false, message: "It didn't go through again. Ask the client for another card." };
}

export async function removeCard(clientId: string): Promise<PolicyActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(clientId)) return { ok: false, message: "That client no longer exists." };
  const { error } = await supabase.rpc("remove_client_card", { p_client_id: clientId });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error) throw error;
  refresh();
  return { ok: true, message: "Card removed." };
}
