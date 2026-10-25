"use server";

import { after } from "next/server";
import { chargeDuePayments, runEventBilling } from "@/lib/events/billing";
import { releaseBusyTeam } from "@/lib/events/clashes";
import { loadEventLink } from "@/lib/events/links";
import { requestInfo } from "@/lib/online-booking/security";
import { currentProvider } from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";

export type EventLinkResult = { ok: true; message: string } | { ok: false; message: string };

// Whether a charge is the one the event has on record (paid at the same
// moment in another tab with the same card gives the same charge): if so,
// it paid and stays.
async function recorded(admin: ReturnType<typeof createAdminClient>, reference: string) {
  const { data } = await admin.from("event_payments").select("id").eq("provider_reference", reference).limit(1);
  return (data ?? []).length > 0;
}

const CHANGED = "The proposal changed since you opened it. Reload the page to see it again.";

// The client agreed to the terms: the card is saved with the provider and
// the deposit charged, then recorded with exactly what they agreed to
// (accept_event_proposal). If that can't be recorded, the deposit is given
// back. Public, with the service role.
export async function acceptProposal(token: string, input: { typedName: string; agreed: boolean; cardRef: string; shownTotalCents: number }): Promise<EventLinkResult> {
  if (!input.agreed) return { ok: false, message: "Please read and agree to the terms." };
  const name = input.typedName.trim();
  if (name.length < 2 || !/\s/.test(name)) return { ok: false, message: "Type your full name to sign." };
  const admin = createAdminClient();
  const link = await loadEventLink(admin, token);
  if (!link || link.kind !== "proposal") return { ok: false, message: "This link doesn't work." };
  if (link.status === "done") return { ok: false, message: "You've already agreed. Thank you." };
  if (link.status !== "open" || link.expired) return { ok: false, message: `This link is no longer active. Ask ${link.salon.name} for a new one.` };
  if (link.totals.totalCents !== input.shownTotalCents) return { ok: false, message: CHANGED };

  const provider = currentProvider();
  const saved = await provider.saveCard(input.cardRef);
  if (!saved.ok) return { ok: false, message: `${saved.reason}.` };
  const deposit = link.totals.depositCents;
  let charge: { amount_cents: number; provider: string; reference: string } | null = null;
  if (deposit > 0) {
    const result = await provider.charge({ amountCents: deposit, paymentMethodRef: saved.card.ref, description: `Deposit for ${link.title}`, idempotencyKey: `event-deposit:${link.id}:${saved.card.ref}` });
    if (!result.ok) return { ok: false, message: `${result.reason}. You haven't been charged; try another card.` };
    charge = { amount_cents: deposit, provider: provider.id, reference: result.reference };
  }
  const { ipHash } = await requestInfo();
  const { error } = await admin.rpc("accept_event_proposal", {
    p_link_id: link.id,
    p_input: { typed_name: name, total_cents: link.totals.totalCents, ip_hash: ipHash, card: { provider: provider.id, ref: saved.card.ref, label: saved.card.label }, deposit: charge },
  });
  if (error) {
    if (charge && !(await recorded(admin, charge.reference))) await provider.refund(charge.reference);
    if (error.hint === "used") return { ok: false, message: "You've already agreed. Thank you." };
    if (error.hint === "changed") return { ok: false, message: CHANGED };
    if (error.hint === "expired") return { ok: false, message: `This link is no longer active. Ask ${link.salon.name} for a new one.` };
    return { ok: false, message: `We couldn't book it, and you haven't been charged. Please let ${link.salon.name} know.` };
  }
  // Nobody on the team is double-booked: anyone who's become busy since
  // the proposal comes off the event, and the desk is told.
  try {
    await releaseBusyTeam(admin, link.eventId);
  } catch (e) {
    console.error("[events] couldn't check the team after booking", e instanceof Error ? e.message : "unknown");
  }
  // The receipt (and anything already due, when the event is close).
  after(() => runEventBilling(createAdminClient(), { businessId: link.businessId }));
  return { ok: true, message: deposit > 0 ? `You're booked. ${saved.card.label} paid the deposit and is kept for the rest, as agreed.` : `You're booked. ${saved.card.label} is kept for the payments, as agreed.` };
}

// A member paying their own share by link.
export async function payShare(token: string, input: { cardRef: string; shownCents: number }): Promise<EventLinkResult> {
  const admin = createAdminClient();
  const link = await loadEventLink(admin, token);
  if (!link || link.kind !== "member" || !link.member) return { ok: false, message: "This link doesn't work." };
  if (link.status === "done" || link.member.paid) return { ok: false, message: "Your share is already paid. Thank you." };
  if (link.status !== "open" || link.expired) return { ok: false, message: `This link is no longer active. Ask ${link.salon.name} for a new one.` };
  if (link.member.shareCents !== input.shownCents) return { ok: false, message: "Your share changed since you opened the page. Reload it to see it again." };

  const provider = currentProvider();
  const saved = await provider.saveCard(input.cardRef);
  if (!saved.ok) return { ok: false, message: `${saved.reason}.` };
  const result = await provider.charge({ amountCents: link.member.shareCents, paymentMethodRef: saved.card.ref, description: `Your share for ${link.title}`, idempotencyKey: `event-share:${link.id}:${saved.card.ref}` });
  if (!result.ok) return { ok: false, message: `${result.reason}. You haven't been charged; try another card.` };
  const { error } = await admin.rpc("pay_event_member", {
    p_link_id: link.id,
    p_payment: { amount_cents: link.member.shareCents, provider: provider.id, reference: result.reference, card_label: saved.card.label },
  });
  if (error) {
    if (!(await recorded(admin, result.reference))) await provider.refund(result.reference);
    if (error.hint === "used") return { ok: false, message: "Your share is already paid. Thank you." };
    if (error.hint === "changed") return { ok: false, message: "Your share changed since you opened the page. Reload it to see it again." };
    return { ok: false, message: `We couldn't take the payment, and you haven't been charged. Please let ${link.salon.name} know.` };
  }
  after(() => runEventBilling(createAdminClient(), { businessId: link.businessId }));
  return { ok: true, message: `Paid with ${saved.card.label}. Thank you.` };
}

// A new card for a booked event (after a payment didn't go through): kept
// on the event, then what failed is charged to it straight away.
export async function updateCard(token: string, cardRef: string): Promise<EventLinkResult> {
  const admin = createAdminClient();
  const link = await loadEventLink(admin, token);
  if (!link || link.kind !== "card") return { ok: false, message: "This link doesn't work." };
  if (link.status !== "open" || link.expired) return { ok: false, message: `This link is no longer active. Ask ${link.salon.name} for a new one.` };
  const provider = currentProvider();
  const saved = await provider.saveCard(cardRef);
  if (!saved.ok) return { ok: false, message: `${saved.reason}.` };
  const { error } = await admin.rpc("update_event_card", { p_link_id: link.id, p_card: { provider: provider.id, ref: saved.card.ref, label: saved.card.label } });
  if (error) {
    if (error.hint === "expired") return { ok: false, message: `This link is no longer active. Ask ${link.salon.name} for a new one.` };
    throw error;
  }
  const charged = await chargeDuePayments(admin, { businessId: link.businessId });
  after(() => runEventBilling(createAdminClient(), { businessId: link.businessId }));
  if (charged.failed) return { ok: false, message: `${saved.card.label} is saved, but the payment didn't go through${charged.reasons[0] ? ` (${charged.reasons[0]})` : ""}. Try another card, or call ${link.salon.name}.` };
  return { ok: true, message: link.owed?.failedCents ? `${saved.card.label} is saved and paid what was due.` : `${saved.card.label} is saved for the payments, as agreed.` };
}
