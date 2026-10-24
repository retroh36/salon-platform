import { describe, expect, it } from "vitest";
import { linkMessage, linkSnapshot, linkTotal, parseTips, tipChoices } from "@/lib/payment-links";
import { EMPTY_TICKET, type Ticket } from "@/lib/ticket";

const rates = { taxServicesBp: 0, taxRetailBp: 1000, member: null };
const staff = [
  { id: "bri", firstName: "Bridget" },
  { id: "gil", firstName: "Gil" },
];
const ids = { appointmentId: "a1", clientId: "c1" };

// A $100 cut with Bridget, a $40 gloss with Gil paid by a package, and a
// $20 spray.
const ticket: Ticket = {
  ...EMPTY_TICKET,
  lines: [
    { key: "a", kind: "service", appointmentItemId: "i1", serviceId: "s1", name: "Cut", staffId: "bri", unitPriceCents: 10000, basePriceCents: 10000, priceReason: "", quantity: 1, discount: null, packageItemId: null },
    { key: "b", kind: "service", appointmentItemId: "i2", serviceId: "s2", name: "Gloss", staffId: "gil", unitPriceCents: 4000, basePriceCents: 4000, priceReason: "", quantity: 1, discount: null, packageItemId: "p1" },
    { key: "c", kind: "product", productId: "pr", name: "Spray", staffId: null, unitPriceCents: 2000, quantity: 1, discount: null },
  ],
  tips: { bri: 999 },
};

describe("what a link holds", () => {
  it("is the ticket as sent: lines, totals, what's left to pay and who can be tipped", () => {
    const s = linkSnapshot(ticket, rates, ids, staff, "Ava");
    if ("problem" in s) throw new Error(s.problem);
    // $100 + $20 + $2 tax; the gloss was paid by the package. Tips on the
    // ticket aren't carried: the client chooses on the page.
    expect(s.dueCents).toBe(12200);
    expect(s.coveredCents).toBe(4000);
    expect(s.lines.map((l) => [l.name, l.detail, l.totalCents])).toEqual([
      ["Cut", "with Bridget", 10000],
      ["Gloss", "with Gil · paid with package", 0],
      ["Spray", "", 2000],
    ]);
    // Stylists can be tipped on services a package paid for, as at the desk.
    expect(s.stylists).toEqual([
      { staffId: "bri", firstName: "Bridget", servicesCents: 10000 },
      { staffId: "gil", firstName: "Gil", servicesCents: 4000 },
    ]);
    expect(s.input).toMatchObject({ appointment_id: "a1", client_id: "c1" });
    expect(s.input).not.toHaveProperty("payments");
    expect(s.clientFirstName).toBe("Ava");
  });

  it("can't be sent with payments already taken, or nothing to pay", () => {
    expect(linkSnapshot({ ...ticket, payments: [{ key: "p", method: "cash", amountCents: 100, tenderedCents: 100 }] }, rates, ids, staff, null)).toEqual({
      problem: "Remove the payments taken first: a link pays the whole ticket.",
    });
    expect(linkSnapshot(EMPTY_TICKET, rates, ids, staff, null)).toEqual({ problem: "Add something to the ticket first." });
    expect(linkSnapshot({ ...ticket, lines: [ticket.lines[1]] }, rates, ids, staff, null)).toEqual({ problem: "There's nothing left to pay." });
  });
});

describe("tips on the page", () => {
  const snapshot = { stylists: [{ staffId: "bri", firstName: "Bridget", servicesCents: 10000 }], dueCents: 12200 };

  it("offers the usual percents of each stylist's services", () => {
    expect(tipChoices(10000)).toEqual([
      { percent: 18, cents: 1800 },
      { percent: 20, cents: 2000 },
      { percent: 25, cents: 2500 },
    ]);
  });

  it("takes only stylists on the ticket, whole cents, and sensible amounts", () => {
    expect(parseTips({ bri: 2000 }, snapshot)).toEqual([{ staff_id: "bri", amount_cents: 2000 }]);
    expect(parseTips({ bri: 0 }, snapshot)).toEqual([]);
    expect(parseTips({ gil: 500 }, snapshot)).toBeNull();
    expect(parseTips({ bri: -100 }, snapshot)).toBeNull();
    expect(parseTips({ bri: 10.5 }, snapshot)).toBeNull();
    expect(parseTips({ bri: 100_001 }, snapshot)).toBeNull();
    expect(linkTotal(snapshot, [{ amount_cents: 2000 }])).toBe(14200);
  });
});

describe("the message", () => {
  it("is a fixed template with the total and the link", () => {
    expect(linkMessage("Maple & Ash", 12200, "https://x/pay/t", "sms")).toEqual({
      subject: null,
      body: "Maple & Ash: your total today is $122. Add a tip if you'd like and pay securely here: https://x/pay/t (the link works once and expires in 24 hours).",
    });
    expect(linkMessage("Maple & Ash", 12250, "https://x/pay/t", "email").subject).toBe("Your total from Maple & Ash");
  });
});
