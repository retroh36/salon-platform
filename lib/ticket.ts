// The checkout ticket: everything on a checkout as staff build it, saved as
// a draft (sale_drafts.ticket) and completed through complete_sale, which
// checks it all again. Grouping by stylist, totals, tips on each stylist's
// services, and what's still missing. Pure.

import { computeSale, lineDiscountCents, paymentStatus, type Discount, type SaleLine, type Tender } from "./checkout";

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

export type TicketLine = ServiceLine | ProductLine | GiftCardLine | ReloadLine | PackageLine;

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
};

export const EMPTY_TICKET: Ticket = { lines: [], saleDiscount: null, tips: {}, payments: [], receiptEmail: "", rebook: null };

export type Rates = { taxServicesBp: number; taxRetailBp: number };

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
      return line.priceCents;
  }
}

// Its own discount, in cents.
export function ownDiscountOf(line: TicketLine): number {
  if (line.kind === "service" && line.packageItemId) return 0;
  return line.kind === "service" || line.kind === "product" ? lineDiscountCents(grossOf(line), asDiscount(line.discount)) : 0;
}

// The lines as the sale prices them: services paid with a package aren't
// taxed or discounted again; gift cards never are.
export function saleLines(ticket: Ticket, rates: Rates): SaleLine[] {
  return ticket.lines.map((l) => {
    const gross = grossOf(l);
    switch (l.kind) {
      case "service":
        return l.packageItemId
          ? { grossCents: gross, taxBp: 0, discountable: false }
          : { grossCents: gross, taxBp: rates.taxServicesBp, discountable: true, lineDiscountCents: ownDiscountOf(l) };
      case "product":
        return { grossCents: gross, taxBp: rates.taxRetailBp, discountable: true, lineDiscountCents: ownDiscountOf(l) };
      case "package":
        return { grossCents: gross, taxBp: rates.taxServicesBp, discountable: true };
      default:
        return { grossCents: gross, taxBp: 0, discountable: false };
    }
  });
}

export function totalsOf(ticket: Ticket, rates: Rates) {
  const lines = saleLines(ticket, rates);
  const sale = computeSale(lines, asDiscount(ticket.saleDiscount), Object.values(ticket.tips));
  // What packages pay for (added as payments by the database).
  const covered = ticket.lines.reduce((n, l, i) => n + (l.kind === "service" && l.packageItemId ? sale.lines[i].totalCents : 0), 0);
  const tenders: Tender[] = ticket.payments.map((p) => ({ method: p.method, amountCents: p.amountCents, tenderedCents: p.method === "cash" ? p.tenderedCents : undefined }));
  const status = paymentStatus(sale.totalCents - covered, tenders);
  return { ...sale, coveredCents: covered, ...status };
}

export type StylistGroup = { staffId: string | null; lines: { line: TicketLine; index: number }[]; subtotalCents: number };

// Lines grouped by who did them (or gets the credit), in the order they
// first appear; gift cards, packages and uncredited products last.
export function stylistGroups(ticket: Ticket): StylistGroup[] {
  const groups = new Map<string | null, StylistGroup>();
  ticket.lines.forEach((line, index) => {
    const staffId = line.kind === "service" || line.kind === "product" ? line.staffId : null;
    const g = groups.get(staffId) ?? { staffId, lines: [], subtotalCents: 0 };
    g.lines.push({ line, index });
    g.subtotalCents += grossOf(line) - ownDiscountOf(line);
    groups.set(staffId, g);
  });
  const all = [...groups.values()];
  return [...all.filter((g) => g.staffId !== null), ...all.filter((g) => g.staffId === null)];
}

// A stylist's services on the ticket, after their own discounts: what tip
// presets are worked out on.
export function servicesFor(ticket: Ticket, staffId: string): number {
  return ticket.lines.reduce((n, l) => n + (l.kind === "service" && l.staffId === staffId ? grossOf(l) - ownDiscountOf(l) : 0), 0);
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
    if ((l.kind === "gift_card" || l.kind === "gift_card_reload") && (l.amountCents < 500 || l.amountCents > 100_000)) problems.push("A gift card is $5 to $1,000.");
    if (l.kind === "gift_card" && l.physical && !/^[A-Z0-9]{8,32}$/.test(l.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase())) problems.push("Enter or scan the gift card's code.");
    if (l.kind === "gift_card" && !l.physical && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.recipientEmail.trim())) problems.push("Enter the email to send the digital gift card to.");
    if (l.kind === "package" && !hasClient) problems.push("Choose the client the package is for.");
  }
  if (ticket.saleDiscount && ticket.saleDiscount.value > 0 && !ticket.saleDiscount.reason.trim()) problems.push("Say why there's a discount.");
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

const dollars = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// What complete_sale is sent.
export function saleInput(ticket: Ticket, ids: { draftId: string; appointmentId: string | null; clientId: string | null }) {
  return {
    draft_id: ids.draftId,
    appointment_id: ids.appointmentId,
    client_id: ids.clientId,
    rebook_appointment_id: ticket.rebook?.appointmentId ?? null,
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
  };
}
