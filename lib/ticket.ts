// The checkout ticket: everything on a checkout as staff build it, saved as
// a draft (sale_drafts.ticket) and completed through complete_sale, which
// checks it all again. Grouping by stylist, totals, tips on each stylist's
// services, and what's still missing. Pure.

import { computeSale, lineDiscountCents, paymentStatus, type Discount, type SaleLine, type Tender } from "./checkout";
import { memberDiscountCents, type MemberPrices } from "./memberships";
import { applyPromotions, promotionProblem, stackingProblem, type Level, type PromoContext, type PromoLine, type PromoRule } from "./promotions";

export type TicketDiscount = { kind: "amount" | "percent"; value: number; reason: string } | null;

export type ServiceLine = {
  key: string;
  kind: "service";
  // Booked on the visit, or added at checkout (null).
  appointmentItemId: string | null;
  serviceId: string;
  name: string;
  staffId: string;
  unitPriceCents: number;
  // The booked price (or the stylist's price for an added service): a
  // different price needs a reason.
  basePriceCents: number;
  priceReason: string;
  quantity: number;
  discount: TicketDiscount;
  // Paid with a use of the client's package.
  packageItemId: string | null;
  // Or with what their membership includes this period.
  membershipCreditId?: string | null;
};

export type ProductLine = {
  key: string;
  kind: "product";
  productId: string;
  name: string;
  // Who gets the credit for the sale.
  staffId: string | null;
  unitPriceCents: number;
  quantity: number;
  discount: TicketDiscount;
};

export type GiftCardLine = { key: string; kind: "gift_card"; amountCents: number; physical: boolean; code: string; recipientName: string; recipientEmail: string };
export type ReloadLine = { key: string; kind: "gift_card_reload"; code: string; amountCents: number };
export type PackageLine = { key: string; kind: "package"; templateId: string; name: string; priceCents: number };
// A membership sold, with the card it renews on (a token at the provider).
export type MembershipLine = { key: string; kind: "membership"; planId: string; name: string; priceCents: number; provider: string; cardRef: string; cardLabel: string };

export type TicketLine = ServiceLine | ProductLine | GiftCardLine | ReloadLine | PackageLine | MembershipLine;

export type TicketPayment =
  | { key: string; method: "card"; amountCents: number; reference: string }
  | { key: string; method: "cash"; amountCents: number; tenderedCents: number }
  | { key: string; method: "gift_card"; amountCents: number; code: string; balanceCents: number };

export type Ticket = {
  lines: TicketLine[];
  // A discount on the whole sale (after line discounts).
  saleDiscount: TicketDiscount;
  // Staff id -> tip in cents.
  tips: Record<string, number>;
  payments: TicketPayment[];
  receiptEmail: string;
  // The next visit, booked before they left.
  rebook: { appointmentId: string; label: string } | null;
  // Promotions on the sale (ids), in the order they apply.
  promotions: string[];
};

export const EMPTY_TICKET: Ticket = { lines: [], saleDiscount: null, tips: {}, payments: [], receiptEmail: "", rebook: null, promotions: [] };

// What promotions need to price the ticket: the salon's live promotions,
// each service's category and stylist's level, and what's known about
// the client and visit (uses so far, for the limits).
export type PromoRates = {
  rules: PromoRule[];
  categoryOf: Record<string, string>;
  levelOf: Record<string, Level | null>;
  context: Omit<PromoContext, "uses" | "clientUses" | "subtotalCents">;
  uses: Record<string, { uses: number; clientUses: number }>;
};

// Tax, the client's member prices and promotions (taken off as
// complete_sale does). promoByKey is what promotions take off each line,
// worked out for the whole ticket by withPromotions.
export type Rates = { taxServicesBp: number; taxRetailBp: number; member?: MemberPrices | null; promo?: PromoRates | null; promoByKey?: Record<string, number> };

const NO_MEMBER: Rates = { taxServicesBp: 0, taxRetailBp: 0 };

// Paid for already: a package use or a membership service.
export const isCovered = (line: TicketLine) => line.kind === "service" && Boolean(line.packageItemId || line.membershipCreditId);

const asDiscount = (d: TicketDiscount): Discount => (d && d.value > 0 ? { kind: d.kind, value: d.value } : null);

// A line before any discount.
export function grossOf(line: TicketLine): number {
  switch (line.kind) {
    case "service":
    case "product":
      return line.unitPriceCents * line.quantity;
    case "gift_card":
    case "gift_card_reload":
      return line.amountCents;
    case "package":
    case "membership":
      return line.priceCents;
  }
}

// The member price's part of a line's discount.
export function memberDiscountOf(line: TicketLine, rates: Rates = NO_MEMBER): number {
  if (!rates.member || isCovered(line)) return 0;
  if (line.kind === "service") return memberDiscountCents(grossOf(line), rates.member.servicePct);
  if (line.kind === "product") return memberDiscountCents(grossOf(line), rates.member.retailPct);
  return 0;
}

// The promotions on the ticket, in order (those still live).
export function ticketPromotions(ticket: Ticket, rates: Rates): PromoRule[] {
  return ticket.promotions.flatMap((id) => rates.promo?.rules.find((r) => r.id === id) ?? []);
}

// Each line as promotions see it: what's left after the member price.
function promoLines(ticket: Ticket, rates: Rates): PromoLine[] {
  return ticket.lines.map((l) => {
    const cents = grossOf(l) - memberDiscountOf(l, rates);
    if (l.kind === "service" && !isCovered(l))
      return { kind: "service", serviceId: l.serviceId, category: rates.promo?.categoryOf[l.serviceId] ?? null, staffId: l.staffId, level: rates.promo?.levelOf[l.staffId] ?? null, cents };
    if (l.kind === "product") return { kind: "product", productId: l.productId, cents };
    return { kind: "other", cents };
  });
}

// What each promotion takes off, per line and in all.
export function promotionsOn(ticket: Ticket, rates: Rates) {
  const rules = ticketPromotions(ticket, rates);
  return { rules, ...applyPromotions(rules, promoLines(ticket, rates)) };
}

// The rates with what promotions take off each line of this ticket.
export function withPromotions(ticket: Ticket, rates: Rates): Rates {
  if (!rates.promo || !ticket.promotions.length) return rates.promoByKey ? { ...rates, promoByKey: undefined } : rates;
  const { perLine } = promotionsOn(ticket, rates);
  return { ...rates, promoByKey: Object.fromEntries(ticket.lines.map((l, i) => [l.key, perLine[i]])) };
}

// The promotions' part of a line's discount (after withPromotions).
export const promoDiscountOf = (line: TicketLine, rates: Rates = NO_MEMBER) => (isCovered(line) ? 0 : (rates.promoByKey?.[line.key] ?? 0));

// Its own discount, in cents: the member price, then promotions, then
// what staff give on the rest.
export function ownDiscountOf(line: TicketLine, rates: Rates = NO_MEMBER): number {
  if (isCovered(line)) return 0;
  if (line.kind !== "service" && line.kind !== "product") return 0;
  const member = memberDiscountOf(line, rates);
  const promo = promoDiscountOf(line, rates);
  return member + promo + lineDiscountCents(grossOf(line) - member - promo, asDiscount(line.discount));
}

// The lines as the sale prices them: services paid with a package aren't
// taxed or discounted again; gift cards never are.
export function saleLines(ticket: Ticket, given: Rates): SaleLine[] {
  const rates = withPromotions(ticket, given);
  return ticket.lines.map((l) => {
    const gross = grossOf(l);
    switch (l.kind) {
      case "service":
        return isCovered(l)
          ? { grossCents: gross, taxBp: 0, discountable: false }
          : { grossCents: gross, taxBp: rates.taxServicesBp, discountable: true, lineDiscountCents: ownDiscountOf(l, rates) };
      case "product":
        return { grossCents: gross, taxBp: rates.taxRetailBp, discountable: true, lineDiscountCents: ownDiscountOf(l, rates) };
      case "package":
        return { grossCents: gross, taxBp: rates.taxServicesBp, discountable: true };
      case "membership":
        return { grossCents: gross, taxBp: rates.taxServicesBp, discountable: false };
      default:
        return { grossCents: gross, taxBp: 0, discountable: false };
    }
  });
}

export function totalsOf(ticket: Ticket, given: Rates) {
  const rates = withPromotions(ticket, given);
  const lines = saleLines(ticket, rates);
  const sale = computeSale(lines, asDiscount(ticket.saleDiscount), Object.values(ticket.tips));
  // What packages and memberships pay for (added as payments by the
  // database).
  const covered = ticket.lines.reduce((n, l, i) => n + (isCovered(l) ? sale.lines[i].totalCents : 0), 0);
  // Member prices: part of the discount, never counted against staff limits.
  const member = ticket.lines.reduce((n, l) => n + memberDiscountOf(l, rates), 0);
  // Promotions: also never counted against staff limits.
  const promo = ticket.lines.reduce((n, l) => n + promoDiscountOf(l, rates), 0);
  const tenders: Tender[] = ticket.payments.map((p) => ({ method: p.method, amountCents: p.amountCents, tenderedCents: p.method === "cash" ? p.tenderedCents : undefined }));
  const status = paymentStatus(sale.totalCents - covered, tenders);
  return { ...sale, coveredCents: covered, memberDiscountCents: member, promoDiscountCents: promo, ...status };
}

export type StylistGroup = { staffId: string | null; lines: { line: TicketLine; index: number }[]; subtotalCents: number };

// Lines grouped by who did them (or gets the credit), in the order they
// first appear; gift cards, packages and uncredited products last.
export function stylistGroups(ticket: Ticket, given: Rates = NO_MEMBER): StylistGroup[] {
  const rates = withPromotions(ticket, given);
  const groups = new Map<string | null, StylistGroup>();
  ticket.lines.forEach((line, index) => {
    const staffId = line.kind === "service" || line.kind === "product" ? line.staffId : null;
    const g = groups.get(staffId) ?? { staffId, lines: [], subtotalCents: 0 };
    g.lines.push({ line, index });
    g.subtotalCents += grossOf(line) - ownDiscountOf(line, rates);
    groups.set(staffId, g);
  });
  const all = [...groups.values()];
  return [...all.filter((g) => g.staffId !== null), ...all.filter((g) => g.staffId === null)];
}

// A stylist's services on the ticket, after their own discounts: what tip
// presets are worked out on.
export function servicesFor(ticket: Ticket, staffId: string, given: Rates = NO_MEMBER): number {
  const rates = withPromotions(ticket, given);
  return ticket.lines.reduce((n, l) => n + (l.kind === "service" && l.staffId === staffId ? grossOf(l) - ownDiscountOf(l, rates) : 0), 0);
}

// What stops the sale being completed, first thing first.
export function ticketProblems(ticket: Ticket, rates: Rates, hasClient: boolean): string[] {
  const problems: string[] = [];
  if (!ticket.lines.length) problems.push("Add something to the ticket.");
  for (const l of ticket.lines) {
    if ((l.kind === "service" || l.kind === "product") && l.unitPriceCents !== (l.kind === "service" ? l.basePriceCents : l.unitPriceCents)) {
      if (l.kind === "service" && !l.priceReason.trim()) problems.push(`Say why ${l.name}'s price changed.`);
    }
    if ((l.kind === "service" || l.kind === "product") && l.discount && l.discount.value > 0 && !l.discount.reason.trim()) problems.push(`Say why ${l.name} is discounted.`);
    if ((l.kind === "service" || l.kind === "product") && l.discount?.kind === "percent" && !Number.isInteger(l.discount.value)) problems.push(`Take a whole percent off ${l.name} (like 10 or 15).`);
    if ((l.kind === "gift_card" || l.kind === "gift_card_reload") && (l.amountCents < 500 || l.amountCents > 100_000)) problems.push("A gift card is $5 to $1,000.");
    if (l.kind === "gift_card" && l.physical && !/^[A-Z0-9]{8,32}$/.test(l.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase())) problems.push("Enter or scan the gift card's code.");
    if (l.kind === "gift_card" && !l.physical && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.recipientEmail.trim())) problems.push("Enter the email to send the digital gift card to.");
    if (l.kind === "package" && !hasClient) problems.push("Choose the client the package is for.");
    if (l.kind === "membership" && !hasClient) problems.push("Choose the client the membership is for.");
    if (l.kind === "membership" && !l.cardRef) problems.push(`Choose the card ${l.name} renews on.`);
  }
  if (ticket.saleDiscount && ticket.saleDiscount.value > 0 && !ticket.saleDiscount.reason.trim()) problems.push("Say why there's a discount.");
  // Percents are whole numbers in the sale (complete_sale takes them as integers).
  if (ticket.saleDiscount?.kind === "percent" && !Number.isInteger(ticket.saleDiscount.value)) problems.push("Take a whole percent off (like 10 or 15).");
  problems.push(...promotionProblems(ticket, rates));
  if (ticket.payments.some((p) => p.method === "gift_card") && ticket.lines.some((l) => l.kind === "gift_card" || l.kind === "gift_card_reload")) problems.push("Gift cards can't be paid for with a gift card.");
  for (const p of ticket.payments) {
    if (p.method === "gift_card" && p.amountCents > p.balanceCents) problems.push("That's more than is on the gift card.");
    if (p.method === "cash" && p.tenderedCents < p.amountCents) problems.push("The cash handed over is less than the amount.");
  }
  const t = totalsOf(ticket, rates);
  if (t.dueCents > 0) problems.push(`${dollars(t.dueCents)} still to pay.`);
  if (t.dueCents < 0) problems.push(`The payments are ${dollars(-t.dueCents)} more than the total.`);
  return problems;
}

// What stops the promotions on the ticket (as complete_sale checks them).
export function promotionProblems(ticket: Ticket, rates: Rates): string[] {
  if (!ticket.promotions.length) return [];
  if (!rates.promo) return ["Promotions can't be checked right now."];
  const { rules, perPromotion } = promotionsOn(ticket, rates);
  if (rules.length < ticket.promotions.length) return ["A promotion on the sale has ended. Take it off."];
  const spend = ticket.lines.reduce((n, l) => n + ((l.kind === "service" && !isCovered(l)) || l.kind === "product" ? grossOf(l) : 0), 0);
  const staffDiscount =
    Boolean(ticket.saleDiscount && ticket.saleDiscount.value > 0) || ticket.lines.some((l) => (l.kind === "service" || l.kind === "product") && !isCovered(l) && l.discount && l.discount.value > 0);
  const out = rules.flatMap((r) => {
    const used = rates.promo!.uses[r.id] ?? { uses: 0, clientUses: 0 };
    const problem = promotionProblem(r, { ...rates.promo!.context, ...used, subtotalCents: spend });
    if (problem) return [problem];
    return perPromotion[r.id] > 0 ? [] : [`${r.name} doesn't cover anything on this sale.`];
  });
  const stacking = stackingProblem(rules, staffDiscount);
  return stacking ? [...out, stacking] : out;
}

const dollars = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// What complete_sale is sent.
export function saleInput(ticket: Ticket, ids: { draftId: string; appointmentId: string | null; clientId: string | null }) {
  return {
    draft_id: ids.draftId,
    appointment_id: ids.appointmentId,
    client_id: ids.clientId,
    rebook_appointment_id: ticket.rebook?.appointmentId ?? null,
    promotion_ids: ticket.promotions,
    lines: ticket.lines.map((l) => {
      switch (l.kind) {
        case "service":
          return {
            kind: "service",
            appointment_item_id: l.appointmentItemId,
            service_id: l.serviceId,
            staff_id: l.staffId,
            quantity: l.quantity,
            unit_price_cents: l.unitPriceCents,
            price_reason: l.priceReason,
            package_item_id: l.packageItemId,
            membership_credit_id: l.membershipCreditId ?? null,
            discount: l.discount && l.discount.value > 0 ? l.discount : null,
          };
        case "product":
          return { kind: "product", product_id: l.productId, staff_id: l.staffId, quantity: l.quantity, discount: l.discount && l.discount.value > 0 ? l.discount : null };
        case "gift_card":
          return { kind: "gift_card", amount_cents: l.amountCents, code: l.physical ? l.code : null, recipient_name: l.recipientName || null, recipient_email: l.physical ? null : l.recipientEmail };
        case "gift_card_reload":
          return { kind: "gift_card_reload", code: l.code, amount_cents: l.amountCents };
        case "package":
          return { kind: "package", template_id: l.templateId };
        case "membership":
          return { kind: "membership", plan_id: l.planId, provider: l.provider, payment_method_ref: l.cardRef, card_label: l.cardLabel };
      }
    }),
    discount: ticket.saleDiscount && ticket.saleDiscount.value > 0 ? ticket.saleDiscount : null,
    tips: Object.entries(ticket.tips)
      .filter(([, c]) => c > 0)
      .map(([staff_id, amount_cents]) => ({ staff_id, amount_cents })),
    payments: ticket.payments.map((p) =>
      p.method === "cash"
        ? { method: "cash", amount_cents: p.amountCents, tendered_cents: p.tenderedCents }
        : p.method === "card"
          ? { method: "card", amount_cents: p.amountCents, reference: p.reference || null }
          : { method: "gift_card", amount_cents: p.amountCents, code: p.code },
    ),
    receipt_email: ticket.receiptEmail.trim() || null,
  };
}

// Parses a saved ticket (from sale_drafts), keeping only what fits.
export function parseTicket(json: unknown): Ticket {
  const t = (json ?? {}) as Partial<Ticket>;
  return {
    lines: Array.isArray(t.lines) ? t.lines : [],
    saleDiscount: t.saleDiscount ?? null,
    tips: t.tips && typeof t.tips === "object" ? t.tips : {},
    payments: Array.isArray(t.payments) ? t.payments : [],
    receiptEmail: typeof t.receiptEmail === "string" ? t.receiptEmail : "",
    rebook: t.rebook ?? null,
    promotions: Array.isArray(t.promotions) ? t.promotions.filter((p): p is string => typeof p === "string") : [],
  };
}
