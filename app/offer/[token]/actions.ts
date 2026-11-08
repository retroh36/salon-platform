"use server";

import { siteUrl } from "@/lib/branding";
import { appointmentChannel } from "@/lib/messaging/send";
import { withStopLine } from "@/lib/messaging/templates";
import { phoneDigits } from "@/lib/online-booking/contact";
import { newSecret, sha256 } from "@/lib/online-booking/security";
import { offerTerms } from "@/lib/offer-terms";
import { providerFor, salonProvider } from "@/lib/payments";
import { bookOnline, cancelOnline } from "@/lib/scheduling/online-book";
import { createAdminClient } from "@/lib/supabase/admin";
import { answerNotice, loadOffer, offerWhen } from "@/lib/waitlist-offers";

export type OfferAnswer = { ok: true; taken: boolean; manageUrl: string | null } | { ok: false; message: string };

// The client's answer to a waitlist offer, from its link. Taking it books
// the time by the booking rules, like an online booking (so if someone
// else has just booked it, it's gone); either way the desk is told in the
// app. When the cancellation policy needs a card for it (and a deposit),
// that comes first, as on the booking site: they agree, the card is saved
// (or the one on file used) and the deposit charged, refunded if the
// booking then fails; a card that doesn't go through leaves the offer open
// and them on the waitlist. Public, with the service role, by the link's
// token.
export async function answerOffer(token: string, take: boolean, pay: { cardRef?: string; agreed?: boolean } = {}): Promise<OfferAnswer> {
  const admin = createAdminClient();
  const offer = await loadOffer(admin, token);
  if (!offer) return { ok: false, message: "This link doesn't work." };
  if (offer.status !== "open" || offer.expired) return { ok: false, message: `This offer is no longer open. Call ${offer.salon.name} if you'd still like a time.` };
  const when = offerWhen(offer.startsAt, offer.location.timezone);
  const client = `${offer.clientFirstName} ${offer.clientLastName}`.trim();

  if (!take) {
    const { error } = await admin.rpc("answer_waitlist_offer", {
      p_offer_id: offer.id,
      p_take: false,
      p_appointment_id: null as never,
      p_notice: answerNotice(false, client, offer.stylist, when),
    });
    if (error?.code === "55000") return { ok: false, message: `${error.message}.` };
    if (error) throw error;
    return { ok: true, taken: false, manageUrl: null };
  }

  const terms = await offerTerms(admin, offer);
  let card: { provider: string; ref: string; label?: string; save: boolean } | null = null;
  let deposit: { amount_cents: number; provider: string; reference: string } | null = null;
  const stillWaiting = `You haven't been charged, and you're still on ${offer.salon.name}'s waitlist.`;
  if (terms.cardNeeded) {
    if (!pay.agreed) return { ok: false, message: "Please agree to the cancellation policy first." };
    if (pay.cardRef) {
      const provider = await salonProvider(admin, offer.businessId);
      const saved = await provider.saveCard(pay.cardRef);
      if (!saved.ok) return { ok: false, message: `${saved.reason}. ${stillWaiting}` };
      card = { provider: provider.id, ref: saved.card.ref, label: saved.card.label, save: true };
    } else if (terms.cardOnFile) {
      card = { provider: terms.cardOnFile.provider, ref: terms.cardOnFile.ref, save: false };
    } else return { ok: false, message: "Add a card to hold the time." };
    if (terms.depositCents > 0) {
      const charged = await providerFor(card.provider).charge({ amountCents: terms.depositCents, paymentMethodRef: card.ref, description: "Deposit", idempotencyKey: `offer-deposit:${offer.id}:${newSecret()}` });
      if (!charged.ok) return { ok: false, message: `${charged.reason}. ${stillWaiting} Try another card.` };
      deposit = { amount_cents: terms.depositCents, provider: card.provider, reference: charged.reference };
    }
  }
  const refund = async () => {
    if (deposit) await providerFor(deposit.provider).refund(deposit.reference);
  };

  const manage = newSecret();
  const booked = await bookOnline(admin, offer.location, {
    clientId: offer.clientId,
    notes: "Booked from a waitlist offer.",
    request: { serviceIds: offer.serviceIds, staffId: offer.staffId, stylistIds: [offer.staffId] },
    start: new Date(offer.startsAt),
    manageTokenHash: sha256(manage),
    source: "waitlist",
  });
  if (!booked.ok) {
    await refund();
    return {
      ok: false,
      message:
        booked.error === "patch_test"
          ? `This service needs a patch test first. Call ${offer.salon.name} to sort it out.`
          : `Sorry, that time has just been taken.${deposit ? " You haven't been charged." : ""} You're still on ${offer.salon.name}'s waitlist.`,
    };
  }
  if (terms.cardNeeded) {
    // What they agreed to and when, the card, and the deposit, as online.
    const { error: cardError } = await admin.rpc("record_online_card", {
      p_appointment_id: booked.appointmentId,
      p_card: (card?.save ? { provider: card.provider, ref: card.ref, label: card.label } : null) as never,
      p_consent: { policy_text: terms.lines.join("\n"), terms: { ...terms.terms, deposit_cents: terms.depositCents, visit_cents: terms.visitCents }, ip_hash: null },
      p_deposit: deposit as never,
    });
    if (cardError) {
      await cancelOnline(admin, booked.appointmentId, sha256(manage));
      await refund();
      throw cardError;
    }
  }
  const { error } = await admin.rpc("answer_waitlist_offer", {
    p_offer_id: offer.id,
    p_take: true,
    p_appointment_id: booked.appointmentId,
    p_notice: answerNotice(true, client, offer.stylist, when),
  });
  if (error) throw error;
  const manageUrl = offer.slug ? `/book/${offer.slug}/manage/${manage}` : null;
  // The client started this, so their confirmation goes by itself, in our words.
  const to = await appointmentChannel(admin, offer.clientId);
  if (to) {
    const paid = deposit ? ` Deposit paid: $${(deposit.amount_cents / 100).toFixed(2)}.` : "";
    const body = `${offer.salon.name}: you're booked for ${when} with ${offer.stylist}.${paid}${manageUrl ? ` View, change or cancel: ${siteUrl()}${manageUrl}` : ""}`;
    const { error: outError } = await admin.from("outbox_messages").insert({
      business_id: offer.businessId,
      channel: to.channel,
      to_address: to.channel === "sms" ? (phoneDigits(to.to) ?? to.to) : to.to,
      subject: to.channel === "email" ? `You're booked at ${offer.salon.name}` : null,
      body: to.channel === "sms" ? withStopLine(body) : body,
    });
    if (outError) console.error(`[offer] confirmation not recorded: ${outError.code ?? "unknown"}`);
  }
  return { ok: true, taken: true, manageUrl };
}
