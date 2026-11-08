"use server";

import { siteUrl } from "@/lib/branding";
import { appointmentChannel } from "@/lib/messaging/send";
import { withStopLine } from "@/lib/messaging/templates";
import { phoneDigits } from "@/lib/online-booking/contact";
import { newSecret, sha256 } from "@/lib/online-booking/security";
import { bookOnline } from "@/lib/scheduling/online-book";
import { createAdminClient } from "@/lib/supabase/admin";
import { answerNotice, loadOffer, offerWhen } from "@/lib/waitlist-offers";

export type OfferAnswer = { ok: true; taken: boolean; manageUrl: string | null } | { ok: false; message: string };

// The client's answer to a waitlist offer, from its link. Taking it books
// the time by the booking rules, like an online booking (so if someone
// else has just booked it, it's gone); either way the desk is told in the
// app. Public, with the service role, by the link's token.
export async function answerOffer(token: string, take: boolean): Promise<OfferAnswer> {
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
    return {
      ok: false,
      message:
        booked.error === "patch_test"
          ? `This service needs a patch test first. Call ${offer.salon.name} to sort it out.`
          : `Sorry, that time has just been taken. You're still on ${offer.salon.name}'s waitlist.`,
    };
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
    const body = `${offer.salon.name}: you're booked for ${when} with ${offer.stylist}.${manageUrl ? ` View, change or cancel: ${siteUrl()}${manageUrl}` : ""}`;
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
