"use server";

// Staff actions on the cancellation policy, from booking details, the
// client profile and the policy page: send a secure card (and deposit)
// link, waive a fee with a reason, try a failed one again, take a card
// off file. The database checks who may do each; charging and refunds run
// with the service role straight after (lib/policy-billing.ts).

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
import { createAdminClient } from "@/lib/supabase/admin";

export type PolicyActionResult = { ok: true; message: string } | { ok: false; message: string };

const NOT_ALLOWED = "You don't have permission to do that.";

function refresh() {
  revalidatePath("/calendar", "layout");
  revalidatePath("/policy");
  revalidatePath("/clients", "layout");
}

// A link for the client to add a card (and pay the deposit this visit
// needs), by text or email.
export async function sendCardLink(input: { clientId: string; appointmentId: string | null; channel: "sms" | "email"; to: string }): Promise<PolicyActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.clientId) || (input.appointmentId && !isUuid(input.appointmentId))) return { ok: false, message: "That client no longer exists." };
  const to = input.channel === "sms" ? phoneDigits(input.to) : normalEmail(input.to);
  if (!to) return { ok: false, message: input.channel === "sms" ? "Enter a 10-digit mobile number." : "Enter an email address like name@example.com." };

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

  const token = newSecret();
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
  const { data: business } = await supabase.from("businesses").select("name").eq("id", me.business_id).single();
  const message = cardLinkMessage(business?.name ?? "The salon", `${siteUrl()}/card/${token}`, deposit, input.channel);
  // The outbox is written with the service role (texts and email aren't
  // connected yet).
  const { error: outError } = await createAdminClient().from("outbox_messages").insert({ business_id: me.business_id, channel: input.channel, to_address: input.to.trim(), subject: message.subject, body: message.body });
  if (outError) throw outError;
  refresh();
  return { ok: true, message: `${deposit > 0 ? "Deposit and card link" : "Card link"} sent to ${input.to.trim()}.` };
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
