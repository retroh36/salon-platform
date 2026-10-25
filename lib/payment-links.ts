// Text-to-pay (pure, unit-tested): what a payment link holds (the ticket
// as sent, what the page shows), the tip choices for each stylist, and the
// total the client pays. complete_payment_link completes the sale through
// complete_sale, which checks it all again.

import { TIP_PERCENTS, tipFor } from "./checkout";
import { grossOf, isCovered, ownDiscountOf, saleInput, servicesFor, totalsOf, withPromotions, type Rates, type Ticket } from "./ticket";

// How long a link works.
export const LINK_HOURS = 24;
// The most anyone can tip one stylist through a link.
export const MAX_TIP_CENTS = 100_000;

export type LinkLine = { name: string; detail: string; quantity: number; totalCents: number };
export type LinkStylist = { staffId: string; firstName: string; servicesCents: number };

export type LinkSnapshot = {
  // What complete_sale is sent (without the draft, tips and payments).
  input: Pick<ReturnType<typeof saleInput>, "appointment_id" | "client_id" | "rebook_appointment_id" | "lines" | "discount" | "receipt_email">;
  lines: LinkLine[];
  stylists: LinkStylist[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  // Paid already by packages or memberships.
  coveredCents: number;
  // What's left to pay before tips.
  dueCents: number;
  rates: Rates;
  clientFirstName: string | null;
};

// The ticket as the link shows and completes it. Only a ticket with
// nothing paid yet, and something to pay, can be sent.
export function linkSnapshot(
  ticket: Ticket,
  given: Rates,
  ids: { appointmentId: string | null; clientId: string | null },
  staff: { id: string; firstName: string }[],
  clientFirstName: string | null,
): LinkSnapshot | { problem: string } {
  if (!ticket.lines.length) return { problem: "Add something to the ticket first." };
  if (ticket.payments.length) return { problem: "Remove the payments taken first: a link pays the whole ticket." };
  const bare: Ticket = { ...ticket, tips: {}, payments: [] };
  const rates = withPromotions(bare, given);
  const totals = totalsOf(bare, rates);
  const due = totals.totalCents - totals.coveredCents;
  if (due <= 0) return { problem: "There's nothing left to pay." };
  const name = (id: string | null) => staff.find((s) => s.id === id)?.firstName ?? null;
  const full = saleInput(bare, { draftId: "", ...ids });
  const input = { appointment_id: full.appointment_id, client_id: full.client_id, rebook_appointment_id: full.rebook_appointment_id, promotion_ids: full.promotion_ids, lines: full.lines, discount: full.discount, receipt_email: full.receipt_email };
  return {
    input,
    lines: bare.lines.map((l) => ({
      name: l.kind === "gift_card" ? "Gift card" : l.kind === "gift_card_reload" ? "Gift card reload" : l.name,
      detail:
        l.kind === "service"
          ? [name(l.staffId) && `with ${name(l.staffId)}`, isCovered(l) && (l.packageItemId ? "paid with package" : "included in membership")].filter(Boolean).join(" · ")
          : l.kind === "product" && ownDiscountOf(l, rates) > 0
            ? `${l.quantity > 1 ? `${l.quantity} × ` : ""}$${(l.unitPriceCents / 100).toFixed(2)}, less discount`
            : "",
      quantity: l.kind === "service" || l.kind === "product" ? l.quantity : 1,
      totalCents: isCovered(l) ? 0 : grossOf(l) - ownDiscountOf(l, rates),
    })),
    stylists: staff.filter((s) => servicesFor(bare, s.id, rates) > 0).map((s) => ({ staffId: s.id, firstName: s.firstName, servicesCents: servicesFor(bare, s.id, rates) })),
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    taxCents: totals.taxCents,
    coveredCents: totals.coveredCents,
    dueCents: due,
    rates,
    clientFirstName,
  };
}

// Tip choices for a stylist: the usual percents of their services.
export const tipChoices = (servicesCents: number) => TIP_PERCENTS.map((percent) => ({ percent, cents: tipFor(servicesCents, percent) }));

// Tips the client chose, checked: only stylists on the ticket, whole
// cents, nothing silly.
export function parseTips(tips: Record<string, number>, snapshot: Pick<LinkSnapshot, "stylists">): { staff_id: string; amount_cents: number }[] | null {
  const out: { staff_id: string; amount_cents: number }[] = [];
  for (const [staffId, cents] of Object.entries(tips)) {
    if (!snapshot.stylists.some((s) => s.staffId === staffId)) return null;
    if (!Number.isInteger(cents) || cents < 0 || cents > MAX_TIP_CENTS) return null;
    if (cents > 0) out.push({ staff_id: staffId, amount_cents: cents });
  }
  return out;
}

// What the client pays: what's due, plus tips.
export const linkTotal = (snapshot: Pick<LinkSnapshot, "dueCents">, tips: readonly { amount_cents: number }[]) => snapshot.dueCents + tips.reduce((n, t) => n + t.amount_cents, 0);

const dollars = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : `$${(cents / 100).toFixed(2)}`);

// The message with the link (a fixed template: payment requests are never
// written by the AI).
export function linkMessage(salon: string, dueCents: number, url: string, channel: "sms" | "email"): { subject: string | null; body: string } {
  const body = `${salon}: your total today is ${dollars(dueCents)}. Add a tip if you'd like and pay securely here: ${url} (the link works once and expires in ${LINK_HOURS} hours).`;
  return { subject: channel === "email" ? `Your total from ${salon}` : null, body };
}
