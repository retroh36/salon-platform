import { describe, expect, it } from "vitest";
import { closeout, giftCardActivity, giftCardLiability, unusedPackageValue } from "@/lib/reports";

const NOW = new Date("2026-10-23T12:00:00Z");

describe("what's owed on gift cards", () => {
  it("counts live purchased balances apart from promotional credit and expired cards", () => {
    const l = giftCardLiability(
      [
        { kind: "purchased", status: "active", balance_cents: 5000, expires_at: null },
        { kind: "purchased", status: "active", balance_cents: 2500, expires_at: "2027-01-01T00:00:00Z" },
        { kind: "purchased", status: "active", balance_cents: 0, expires_at: null },
        { kind: "purchased", status: "voided", balance_cents: 9999, expires_at: null },
        { kind: "purchased", status: "active", balance_cents: 1200, expires_at: "2026-10-01T00:00:00Z" },
        { kind: "promotional", status: "active", balance_cents: 2000, expires_at: "2026-12-01T00:00:00Z" },
      ],
      NOW,
    );
    expect(l).toEqual({ purchased: { cents: 7500, count: 2 }, promotional: { cents: 2000, count: 1 }, expired: { cents: 1200, count: 1 } });
  });
});

describe("unused packages", () => {
  it("values the uses left on active, unexpired packages", () => {
    const v = unusedPackageValue(
      [
        { client_id: "a", status: "active", expires_at: null, total: 5, used: 2, use_value_cents: 4000 },
        { client_id: "a", status: "active", expires_at: null, total: 3, used: 3, use_value_cents: 5000 },
        { client_id: "b", status: "active", expires_at: "2027-01-01T00:00:00Z", total: 3, used: 0, use_value_cents: 5500 },
        { client_id: "c", status: "canceled", expires_at: null, total: 5, used: 0, use_value_cents: 4000 },
        { client_id: "d", status: "active", expires_at: "2026-01-01T00:00:00Z", total: 5, used: 0, use_value_cents: 4000 },
      ],
      NOW,
    );
    expect(v).toEqual({ cents: 3 * 4000 + 3 * 5500, uses: 6, clients: 2 });
  });
});

describe("gift card activity", () => {
  it("adds up sales, reloads and use, net of what was put back", () => {
    const a = giftCardActivity([
      { kind: "sold", amount_cents: 5000, card_kind: "purchased" },
      { kind: "sold", amount_cents: 2500, card_kind: "purchased" },
      { kind: "reloaded", amount_cents: 1000, card_kind: "purchased" },
      { kind: "redeemed", amount_cents: -3000, card_kind: "purchased" },
      { kind: "refunded", amount_cents: 500, card_kind: "purchased" },
      { kind: "issued", amount_cents: 2000, card_kind: "promotional" },
      { kind: "redeemed", amount_cents: -2000, card_kind: "promotional" },
    ]);
    expect(a).toEqual({ soldCents: 7500, soldCount: 2, reloadedCents: 1000, redeemedCents: 2500, promoIssuedCents: 2000, promoRedeemedCents: 2000 });
  });
});

describe("closing out the day", () => {
  it("totals each tender, refunds and voids taken off, with the cash that should be in the drawer", () => {
    const c = closeout([
      { method: "cash", amount_cents: 4500 },
      { method: "cash", amount_cents: 2000 },
      { method: "cash", amount_cents: -2000 },
      { method: "card", amount_cents: 12000 },
      { method: "gift_card", amount_cents: 3000 },
      { method: "package", amount_cents: 4500 },
    ]);
    expect(c.expectedCashCents).toBe(4500);
    expect(c.byMethod.find((m) => m.method === "cash")).toEqual({ method: "cash", takenCents: 6500, refundedCents: 2000, netCents: 4500 });
    expect(c.netCents).toBe(4500 + 12000 + 3000 + 4500);
  });
});
