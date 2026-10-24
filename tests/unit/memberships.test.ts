import { describe, expect, it } from "vitest";
import { addInterval, benefitsText, earliestEnd, historyText, memberPrices, membershipReport, monthlyCents, parsePlanForm, priceText, type MembershipRow, type PlanForm } from "@/lib/memberships";
import { currentProvider, providerFor } from "@/lib/payments";
import { testCharge, TEST_CARDS } from "@/lib/payments/test-provider";
import { EMPTY_TICKET, saleInput, ticketProblems, totalsOf, type Rates, type Ticket } from "@/lib/ticket";

describe("billing periods", () => {
  it("adds weeks and months as Postgres does, clamping to the month's end", () => {
    expect(addInterval("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(addInterval("2028-01-31", "month", 1)).toBe("2028-02-29");
    expect(addInterval("2026-01-31", "month", 2)).toBe("2026-03-31");
    expect(addInterval("2026-11-15", "month", 3)).toBe("2027-02-15");
    expect(addInterval("2026-10-23", "week", 2)).toBe("2026-11-06");
    expect(addInterval("2026-10-23", "month", 12)).toBe("2027-10-23");
  });

  it("words the price and period", () => {
    expect(priceText(8900, "month", 1)).toBe("$89 a month");
    expect(priceText(2550, "week", 2)).toBe("$25.50 every 2 weeks");
    expect(priceText(90000, "month", 12)).toBe("$900 a year");
    expect(benefitsText({ services: [{ name: "Blowout", quantity: 2, rollover: false }], serviceDiscountPct: 0, retailDiscountPct: 10, intervalUnit: "month", intervalCount: 1 })).toBe(
      "2 Blowouts a month, 10% off retail",
    );
  });
});

describe("ending a membership", () => {
  const m = { startedOn: "2026-08-10", anchorOn: "2026-08-10", periodsPaid: 3, currentPeriodEnd: "2026-11-10", intervalUnit: "month" as const, intervalCount: 1, minTermPeriods: 0, cancelNoticeDays: 0 };

  it("ends at the end of the period that's paid for", () => {
    expect(earliestEnd(m, "2026-10-23")).toBe("2026-11-10");
  });

  it("waits out the minimum term and the notice, always to a period's end", () => {
    // Six months from August 10: not before February 10.
    expect(earliestEnd({ ...m, minTermPeriods: 6 }, "2026-10-23")).toBe("2027-02-10");
    // 30 days' notice from October 23 is November 22: the next period end.
    expect(earliestEnd({ ...m, cancelNoticeDays: 30 }, "2026-10-23")).toBe("2026-12-10");
    // Anchored on the 31st, periods don't drift.
    expect(earliestEnd({ ...m, startedOn: "2026-01-31", anchorOn: "2026-01-31", periodsPaid: 1, currentPeriodEnd: "2026-02-28", minTermPeriods: 2 }, "2026-02-10")).toBe("2026-03-31");
  });
});

describe("member prices", () => {
  it("are the best of the client's active memberships", () => {
    const prices = memberPrices([
      { status: "active", name: "Blowout Club", serviceDiscountPct: 0, retailDiscountPct: 10 },
      { status: "active", name: "Color Club", serviceDiscountPct: 10, retailDiscountPct: 15 },
      { status: "past_due", name: "VIP", serviceDiscountPct: 50, retailDiscountPct: 50 },
    ]);
    expect(prices).toEqual({ name: "Color Club", servicePct: 10, retailPct: 15 });
    expect(memberPrices([{ status: "paused", name: "X", serviceDiscountPct: 10, retailDiscountPct: 10 }])).toBeNull();
  });

  it("come off the ticket automatically, before staff discounts, and pay for included services", () => {
    const rates: Rates = { taxServicesBp: 0, taxRetailBp: 1000, member: { name: "Color Club", servicePct: 10, retailPct: 15 } };
    const ticket: Ticket = {
      ...EMPTY_TICKET,
      lines: [
        // $95 root touch-up, included this month.
        { key: "a", kind: "service", appointmentItemId: "i1", serviceId: "s1", name: "Root Touch-Up", staffId: "st", unitPriceCents: 9500, basePriceCents: 9500, priceReason: "", quantity: 1, discount: null, packageItemId: null, membershipCreditId: "c1" },
        // $60 gloss: 10% member price, then a $5 staff discount.
        { key: "b", kind: "service", appointmentItemId: "i2", serviceId: "s2", name: "Gloss", staffId: "st", unitPriceCents: 6000, basePriceCents: 6000, priceReason: "", quantity: 1, discount: { kind: "amount", value: 500, reason: "Running late" }, packageItemId: null },
        // $40 retail: 15% off, then taxed.
        { key: "c", kind: "product", productId: "p", name: "Spray", staffId: null, unitPriceCents: 4000, quantity: 1, discount: null },
      ],
    };
    const t = totalsOf(ticket, rates);
    expect(t.memberDiscountCents).toBe(600 + 600);
    // Gloss 6000 - 600 - 500 = 4900; spray 4000 - 600 = 3400 + 340 tax.
    expect(t.totalCents).toBe(9500 + 4900 + 3400 + 340);
    expect(t.coveredCents).toBe(9500);
    expect(t.dueCents).toBe(4900 + 3400 + 340);
    expect(t.discountCents - t.memberDiscountCents).toBe(500);
    const input = saleInput(ticket, { draftId: "d", appointmentId: "a", clientId: "c" });
    expect(input.lines[0]).toMatchObject({ membership_credit_id: "c1" });
  });

  it("sells a membership with the card it renews on, for a client", () => {
    const ticket: Ticket = { ...EMPTY_TICKET, lines: [{ key: "m", kind: "membership", planId: "p1", name: "Blowout Club", priceCents: 8900, provider: "test", cardRef: "test_visa_4242", cardLabel: "Visa …4242" }] };
    const rates: Rates = { taxServicesBp: 0, taxRetailBp: 0 };
    expect(totalsOf(ticket, rates).totalCents).toBe(8900);
    expect(ticketProblems(ticket, rates, false)).toContain("Choose the client the membership is for.");
    expect(saleInput(ticket, { draftId: "d", appointmentId: null, clientId: "c" }).lines[0]).toEqual({
      kind: "membership",
      plan_id: "p1",
      provider: "test",
      payment_method_ref: "test_visa_4242",
      card_label: "Visa …4242",
    });
  });
});

describe("the owners' numbers", () => {
  const row = (over: Partial<MembershipRow>): MembershipRow => ({
    status: "active",
    planId: "blow",
    name: "Blowout Club",
    priceCents: 8900,
    intervalUnit: "month",
    intervalCount: 1,
    startedOn: "2026-06-01",
    endedOn: null,
    voided: false,
    ...over,
  });

  it("counts members, monthly recurring revenue and churn over a period", () => {
    const r = membershipReport(
      [
        row({}),
        row({ status: "past_due" }),
        row({ status: "paused" }),
        // Every two weeks: $40 → $86.67 a month.
        row({ planId: "wk", name: "Weekly", priceCents: 4000, intervalUnit: "week", intervalCount: 2 }),
        // Left in October (churned), and left before it (not counted).
        row({ status: "canceled", endedOn: "2026-10-12" }),
        row({ status: "canceled", endedOn: "2026-09-12" }),
        // Joined in October: not part of churn's starting members.
        row({ startedOn: "2026-10-05" }),
        // Voided at the desk: never a member.
        row({ status: "canceled", startedOn: "2026-09-01", endedOn: "2026-10-03", voided: true }),
      ],
      "2026-10-01",
      "2026-10-31",
    );
    expect(r.members).toBe(5);
    expect(r.pastDue).toBe(1);
    expect(r.paused).toBe(1);
    expect(r.mrrCents).toBe(Math.round(8900 * 3 + (4000 * 52) / 12 / 2));
    expect(r.joined).toBe(1);
    expect(r.startingMembers).toBe(5);
    expect(r.churned).toBe(1);
    expect(r.churnPercent).toBe(20);
    expect(r.plans[0]).toEqual({ name: "Blowout Club", members: 4, mrrCents: 8900 * 3 });
    expect(monthlyCents({ priceCents: 90000, intervalUnit: "month", intervalCount: 12 })).toBe(7500);
  });
});

describe("the plan form", () => {
  const form: PlanForm = {
    name: " Blowout Club ",
    description: "",
    price: "$89",
    intervalUnit: "month",
    intervalCount: "1",
    serviceDiscountPct: "",
    retailDiscountPct: "10",
    minTermPeriods: "",
    cancelNoticeDays: "",
    allowPause: true,
    maxPausePeriods: "2",
    isActive: true,
    services: [{ serviceId: "s1", quantity: "2", rollover: false }],
  };

  it("parses what owners type", () => {
    const r = parsePlanForm(form);
    expect(r).toEqual({
      ok: true,
      plan: {
        name: "Blowout Club",
        description: null,
        price_cents: 8900,
        interval_unit: "month",
        interval_count: 1,
        service_discount_pct: 0,
        retail_discount_pct: 10,
        min_term_periods: 0,
        cancel_notice_days: 0,
        allow_pause: true,
        max_pause_periods: 2,
        is_active: true,
        services: [{ service_id: "s1", quantity: 2, rollover: false }],
      },
    });
  });

  it("says what's wrong", () => {
    expect(parsePlanForm({ ...form, price: "0.50" })).toEqual({ ok: false, message: "Enter a price from $1 to $1,000." });
    expect(parsePlanForm({ ...form, retailDiscountPct: "12.5" })).toEqual({ ok: false, message: "Member discounts are whole percents from 0 to 100." });
    expect(parsePlanForm({ ...form, services: [form.services[0], form.services[0]] })).toEqual({ ok: false, message: "List each included service once." });
    expect(parsePlanForm({ ...form, services: [], retailDiscountPct: "" })).toEqual({ ok: false, message: "Add an included service or a member discount." });
  });

  it("words the history", () => {
    expect(historyText({ kind: "renewed", detail: null }, "$89")).toBe("Renewed ($89)");
    expect(historyText({ kind: "payment_failed", detail: "The card was declined" })).toBe("Payment failed: The card was declined");
    expect(historyText({ kind: "credit_used", detail: null, service: "Blowout" })).toBe("Used: Blowout");
  });
});

describe("the payment provider layer", () => {
  it("uses the test provider until Stripe is connected", () => {
    expect(currentProvider({}).id).toBe("test");
    expect(currentProvider({}).testMode).toBe(true);
    expect(currentProvider({ STRIPE_SECRET_KEY: "sk_test_x" }).id).toBe("stripe");
    expect(providerFor("unknown").id).toBe("test");
  });

  it("answers by test card, the same way for the same charge", () => {
    const charge = (ref: string, key = "k1") => testCharge({ amountCents: 8900, paymentMethodRef: ref, description: "Blowout Club", idempotencyKey: key });
    const ok = charge("test_visa_4242");
    expect(ok.ok).toBe(true);
    expect(charge("test_visa_4242")).toEqual(ok);
    expect(charge("test_visa_4242", "k2")).not.toEqual(ok);
    expect(charge("test_visa_0002")).toEqual({ ok: false, reason: "The card was declined" });
    expect(charge("test_visa_9995")).toEqual({ ok: false, reason: "Insufficient funds" });
    expect(charge("4242424242424242")).toEqual({ ok: false, reason: "The card on file isn't valid" });
    expect(testCharge({ amountCents: 0, paymentMethodRef: "test_visa_4242", description: "", idempotencyKey: "z" }).ok).toBe(false);
    expect(TEST_CARDS.map((c) => c.label)).toEqual(["Visa …4242", "Visa …0002", "Visa …9995"]);
  });
});
