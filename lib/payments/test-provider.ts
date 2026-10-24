// The test provider: no money moves. Which card decides what happens, like
// a real provider's test cards: …4242 always works, …0002 is declined,
// …9995 has insufficient funds. References are made from the idempotency
// key, so the same charge gives the same answer.

import { createHash } from "node:crypto";
import type { ChargeRequest, ChargeResult, PaymentProvider } from "./provider.ts";

export const TEST_CARDS = [
  { ref: "test_visa_4242", label: "Visa …4242", outcome: "Always works" },
  { ref: "test_visa_0002", label: "Visa …0002", outcome: "Declined" },
  { ref: "test_visa_9995", label: "Visa …9995", outcome: "Insufficient funds" },
] as const;

const FAILURES: Record<string, string> = {
  test_visa_0002: "The card was declined",
  test_visa_9995: "Insufficient funds",
};

export function testCharge(request: ChargeRequest): ChargeResult {
  if (!Number.isInteger(request.amountCents) || request.amountCents <= 0) return { ok: false, reason: "Nothing to charge" };
  if (!TEST_CARDS.some((c) => c.ref === request.paymentMethodRef)) return { ok: false, reason: "The card on file isn't valid" };
  const failure = FAILURES[request.paymentMethodRef];
  if (failure) return { ok: false, reason: failure };
  return { ok: true, reference: `test_ch_${createHash("sha256").update(request.idempotencyKey).digest("hex").slice(0, 24)}` };
}

export const testProvider: PaymentProvider = {
  id: "test",
  label: "Test mode",
  testMode: true,
  charge: async (request) => testCharge(request),
  refund: async (reference) => ({ ok: reference.startsWith("test_ch_") }),
  // Every test card saves (like a real provider, a card can save and still
  // be declined when it's charged later).
  saveCard: async (ref) => {
    const card = TEST_CARDS.find((c) => c.ref === ref);
    return card ? { ok: true, card: { ref: card.ref, label: card.label } } : { ok: false, reason: "Choose a card" };
  },
  testCards: TEST_CARDS,
};
