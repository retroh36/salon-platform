// The messages the system sends about events: fixed templates, filled in
// by our code (never written by Denise or Claude), through the outbox.
// Texts get the stop line where they're sent.

import { formatPrice } from "../services.ts";
import { SCHEDULED_LABELS, type ScheduledKind } from "./pricing.ts";

type Channel = "sms" | "email";
export type EventMessage = { subject: string | null; body: string };

// How long links work.
export const PROPOSAL_LINK_DAYS = 14;
export const MEMBER_LINK_DAYS = 14;
export const CARD_LINK_DAYS = 7;

export function proposalMessage(salon: string, firstName: string, title: string, url: string, channel: Channel): EventMessage {
  return {
    subject: channel === "email" ? `Your proposal from ${salon}` : null,
    body: `Hi ${firstName}, here's ${salon}'s proposal for ${title}: the party, timeline, prices and terms. To book, agree to the terms and pay the deposit on the page: ${url} (the link works for ${PROPOSAL_LINK_DAYS} days).`,
  };
}

export function memberLinkMessage(salon: string, name: string, title: string, amountCents: number, url: string, channel: Channel): EventMessage {
  return {
    subject: channel === "email" ? `Your share for ${title}` : null,
    body: `Hi ${name}, ${salon} has you down for ${title}. Your share is ${formatPrice(amountCents)}; you can pay it here: ${url} (the link works for ${MEMBER_LINK_DAYS} days).`,
  };
}

export function cardLinkMessage(salon: string, firstName: string, title: string, url: string, channel: Channel): EventMessage {
  return {
    subject: channel === "email" ? `Your card for ${title}` : null,
    body: `Hi ${firstName}, ${salon} here: a payment for ${title} didn't go through. You can add another card here: ${url} (the link works for ${CARD_LINK_DAYS} days).`,
  };
}

// A few days before a scheduled payment is charged.
export function reminderMessage(salon: string, firstName: string, title: string, kind: ScheduledKind, amountCents: number, dueOn: string, cardLabel: string | null): EventMessage {
  return {
    subject: `${SCHEDULED_LABELS[kind]} for ${title}`,
    body: `Hi ${firstName}, a reminder from ${salon}: the ${SCHEDULED_LABELS[kind].toLowerCase()} of ${formatPrice(amountCents)} for ${title} will be charged to ${cardLabel ?? "your card on file"} on ${dueOn}, as agreed. Questions? Just reply or call us.`,
  };
}

export function receiptMessage(salon: string, firstName: string, title: string, what: string, amountCents: number, cardLabel: string | null, leftCents: number): EventMessage {
  return {
    subject: `Your receipt from ${salon}`,
    body: `Hi ${firstName}, ${salon} received your ${what.toLowerCase()} of ${formatPrice(amountCents)} for ${title}${cardLabel ? `, charged to ${cardLabel}` : ""}. ${leftCents > 0 ? `${formatPrice(leftCents)} is left to pay.` : "That's everything paid."} Thank you.`,
  };
}

export const PAYMENT_LABELS: Record<ScheduledKind | "member", string> = { ...SCHEDULED_LABELS, member: "Share" };
