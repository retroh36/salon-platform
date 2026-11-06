import { describe, expect, it } from "vitest";
import { lineDiscountCents, quickCash, tipFor } from "@/lib/checkout";
import { asTeamPurchase, productLine, saleInput, scansAs, servicesFor, stylistGroups, ticketProblems, totalsOf, EMPTY_TICKET, type ServiceLine, type Ticket, type TicketLine } from "@/lib/ticket";

const RATES = { taxServicesBp: 0, taxRetailBp: 1000 };

const service = (key: string, staffId: string, cents: number, more: Partial<ServiceLine> = {}): ServiceLine => ({
  key,
  kind: "service",
  appointmentItemId: `item-${key}`,
  serviceId: `svc-${key}`,
  name: key,
  staffId,
  unitPriceCents: cents,
  basePriceCents: cents,
  priceReason: "",
  quantity: 1,
  discount: null,
  packageItemId: null,
  ...more,
});
const product = (key: string, staffId: string | null, cents: number, quantity = 1): TicketLine => ({ key, kind: "product", productId: `p-${key}`, name: key, staffId, unitPriceCents: cents, quantity, discount: null });
const ticket = (lines: TicketLine[], more: Partial<Ticket> = {}): Ticket => ({ ...EMPTY_TICKET, lines, ...more });

describe("line discounts", () => {
  it("take a percent or an amount off the line, never more than it", () => {
    expect(lineDiscountCents(6500, { kind: "percent", value: 10 })).toBe(650);
    expect(lineDiscountCents(6500, { kind: "amount", value: 1000 })).toBe(1000);
    expect(lineDiscountCents(6500, { kind: "amount", value: 9000 })).toBe(6500);
    expect(lineDiscountCents(6500, null)).toBe(0);
  });
});

describe("the ticket", () => {
  // A cut with Bridget ($90, was $100), a gloss with Gil ($65, 10% off),
  // and two $20 sprays credited to Bridget.
  const t = ticket([
    service("cut", "bridget", 9000, { basePriceCents: 10000, priceReason: "Shorter visit" }),
    service("gloss", "gil", 6500, { discount: { kind: "percent", value: 10, reason: "Loyalty" } }),
    product("spray", "bridget", 2000, 2),
    { key: "gc", kind: "gift_card", amountCents: 5000, physical: true, code: "ABCD2345EFGH", recipientName: "", recipientEmail: "" },
  ]);

  it("groups lines by stylist with a subtotal each, uncredited lines last", () => {
    expect(stylistGroups(t).map((g) => [g.staffId, g.lines.map((l) => l.line.key), g.subtotalCents])).toEqual([
      ["bridget", ["cut", "spray"], 13000],
      ["gil", ["gloss"], 5850],
      [null, ["gc"], 5000],
    ]);
  });

  it("works out tips on each stylist's own services, after their discounts", () => {
    expect(servicesFor(t, "bridget")).toBe(9000);
    expect(servicesFor(t, "gil")).toBe(5850);
    expect(tipFor(servicesFor(t, "gil"), 18)).toBe(1053);
  });

  it("totals like the sale: line discounts, retail tax, tips, and what's left to pay", () => {
    const totals = totalsOf({ ...t, tips: { bridget: 1800 }, payments: [{ key: "1", method: "card", amountCents: 10000, reference: "" }] }, RATES);
    // $90 + $65 + $40 + $50 = $245; $6.50 off; 10% tax on $40; $18 tip.
    expect(totals).toMatchObject({ subtotalCents: 24500, discountCents: 650, taxCents: 400, tipCents: 1800, totalCents: 26050, dueCents: 16050 });
  });

  it("a service paid with a package is covered, not taxed or discounted again", () => {
    const pkg = ticket([service("blowout", "gil", 6500, { packageItemId: "pi-1" }), product("spray", "gil", 2000)]);
    expect(totalsOf(pkg, RATES)).toMatchObject({ totalCents: 8700, coveredCents: 6500, dueCents: 2200 });
  });

  it("says what's missing before it can be completed", () => {
    expect(ticketProblems(EMPTY_TICKET, RATES, true)).toEqual(["Add something to the ticket."]);
    const noReason = ticket([service("cut", "bridget", 9000, { basePriceCents: 10000 }), product("spray", null, 2000)]);
    expect(ticketProblems(noReason, RATES, true)).toEqual(["Say why cut's price changed.", "Choose how they're paying."]);
    const over = ticket([product("spray", null, 2000)], { payments: [{ key: "1", method: "cash", amountCents: 2500, tenderedCents: 2500 }] });
    expect(ticketProblems(over, RATES, true)).toEqual(["The payments are $3 more than the total."]);
    const paid = ticket([product("spray", null, 2000)], { payments: [{ key: "1", method: "cash", amountCents: 2200, tenderedCents: 4000 }] });
    expect(ticketProblems(paid, RATES, true)).toEqual([]);
    expect(totalsOf(paid, RATES).changeCents).toBe(1800);
  });

  it("takes whole percents off only, as the sale is recorded", () => {
    const half = ticket([product("spray", null, 2000)], { saleDiscount: { kind: "percent", value: 12.5, reason: "Loyalty" } });
    expect(ticketProblems(half, RATES, true)).toContain("Take a whole percent off (like 10 or 15).");
    const line = ticket([{ ...product("spray", null, 2000), discount: { kind: "percent", value: 7.5, reason: "Damaged box" } } as TicketLine]);
    expect(ticketProblems(line, RATES, true)).toContain("Take a whole percent off spray (like 10 or 15).");
  });

  it("sends complete_sale the lines, the stylist credit, discounts, tips and the rebooking", () => {
    const input = saleInput({ ...t, tips: { bridget: 1800, gil: 0 }, rebook: { appointmentId: "next", label: "Fri" } }, { draftId: "d", appointmentId: "a", clientId: "c" });
    expect(input).toMatchObject({ draft_id: "d", appointment_id: "a", client_id: "c", rebook_appointment_id: "next", tips: [{ staff_id: "bridget", amount_cents: 1800 }] });
    expect(input.lines[1]).toMatchObject({ kind: "service", staff_id: "gil", discount: { kind: "percent", value: 10, reason: "Loyalty" } });
    expect(input.lines[2]).toEqual({ kind: "product", product_id: "p-spray", staff_id: "bridget", quantity: 2, discount: null });
  });
});

describe("products' own prices and tax", () => {
  const shampoo = { id: "shampoo", name: "Shampoo", priceCents: 3000, employeePriceCents: 1800, taxBp: null };
  const gift = { id: "gift", name: "Gift box", priceCents: 4000, employeePriceCents: null, taxBp: 0 };
  const oil = { id: "oil", name: "Oil", priceCents: 2000, employeePriceCents: 1200, taxBp: 500 };

  it("taxes each product at its own rate, or the salon's", () => {
    const t = ticket([productLine("a", shampoo, "bridget", false), productLine("b", gift, "bridget", false), productLine("c", oil, "bridget", false)]);
    // 10% on $30, nothing on $40, 5% on $20.
    expect(totalsOf(t, RATES).taxCents).toBe(300 + 0 + 100);
  });

  it("prices a team purchase at employee prices, credited to nobody, and back again", () => {
    const t = asTeamPurchase(ticket([productLine("a", shampoo, "bridget", false), productLine("b", gift, "bridget", false)], { walkIn: true }), "jordan");
    expect(t.walkIn).toBe(false);
    expect(t.lines.map((l) => (l.kind === "product" ? [l.unitPriceCents, l.staffId] : null))).toEqual([
      [1800, null],
      [4000, null],
    ]);
    expect(saleInput(t, { draftId: "d", appointmentId: null, clientId: null })).toMatchObject({ employee_id: "jordan", lines: [{ staff_id: null }, { staff_id: null }] });
    expect(ticketProblems(t, RATES, true)).toContain("A team purchase has no client. Remove the client first.");
    expect(ticketProblems(t, RATES, false)).not.toContain("A team purchase has no client. Remove the client first.");
    const back = asTeamPurchase(t, null);
    expect(back.lines.map((l) => (l.kind === "product" ? l.unitPriceCents : null))).toEqual([3000, 4000]);
    expect(productLine("c", oil, "bridget", true)).toMatchObject({ unitPriceCents: 1200, staffId: null });
    // A line saved before prices were kept stays at its price.
    expect(asTeamPurchase(ticket([product("old", null, 2500)]), "jordan").lines[0]).toMatchObject({ unitPriceCents: 2500 });
  });

  it("scans any of a product's barcodes", () => {
    const p = { barcode: "0123456789", otherBarcodes: ["555555"] };
    expect(scansAs(p, " 0123456789 ")).toBe(true);
    expect(scansAs(p, "555555")).toBe(true);
    expect(scansAs(p, "")).toBe(false);
    expect(scansAs({ barcode: null, otherBarcodes: [] }, "555555")).toBe(false);
  });
});

describe("quick cash amounts", () => {
  it("are the exact amount, then the next $20, $50 and $100", () => {
    expect(quickCash(13560)).toEqual([13560, 14000, 15000, 20000]);
    expect(quickCash(5000)).toEqual([5000, 6000, 10000]);
    expect(quickCash(0)).toEqual([]);
  });
});
