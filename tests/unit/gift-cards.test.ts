import { describe, expect, it } from "vitest";
import { cardProblem, codeHint, formatCode, giftCardEmail, isCardCode, normalizeCode, type GiftCardLookup } from "@/lib/gift-cards";

describe("gift card codes", () => {
  it("are stored as letters and digits, and shown in groups of four", () => {
    expect(normalizeCode(" k7qm-3xrp 9twd_fh2c ")).toBe("K7QM3XRP9TWDFH2C");
    expect(formatCode("K7QM3XRP9TWDFH2C")).toBe("K7QM-3XRP-9TWD-FH2C");
    expect(formatCode("ABCDEFGHJ")).toBe("ABCD-EFGH-J");
    expect(codeHint("K7QM3XRP9TWDFH2C")).toBe("…FH2C");
  });

  it("accept a card's own code of 8 to 32 characters", () => {
    expect(isCardCode("1234-5678")).toBe(true);
    expect(isCardCode("1234567")).toBe(false);
    expect(isCardCode("A".repeat(33))).toBe(false);
  });
});

describe("whether a card can be used", () => {
  const card: GiftCardLookup = { id: "c", code: "X", kind: "purchased", status: "active", balance_cents: 1000, initial_cents: 5000, expires_at: null, expired: false };
  it("says why not", () => {
    expect(cardProblem(card)).toBeNull();
    expect(cardProblem({ ...card, status: "voided" })).toBe("That gift card was voided.");
    expect(cardProblem({ ...card, expired: true })).toBe("That gift card has expired.");
    expect(cardProblem({ ...card, balance_cents: 0 })).toBe("That gift card has nothing left on it.");
  });
});

describe("the digital card's email", () => {
  it("shows the amount and code in the salon's colors, and escapes what it's given", () => {
    const email = giftCardEmail({
      code: "K7QM3XRP9TWDFH2C",
      amountCents: 5000,
      recipientName: "Ava <script>",
      expiresOn: "Friday, October 22, 2027",
      salon: { name: "Maple & Ash", locationName: "Downtown", accentColor: "#7A1F55", bookingUrl: "https://example.com/book/maple" },
    });
    expect(email.subject).toBe("Ava <script>, here's a $50 gift card for Maple & Ash");
    expect(email.text).toContain("Your code: K7QM-3XRP-9TWD-FH2C");
    expect(email.text).toContain("Use it by Friday, October 22, 2027.");
    expect(email.html).toContain("K7QM-3XRP-9TWD-FH2C");
    expect(email.html).toContain("background:#7A1F55");
    expect(email.html).toContain("Maple &amp; Ash");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Powered by Maestra");
  });
});
