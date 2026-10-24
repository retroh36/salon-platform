// The payment provider layer: everything that takes money without the
// client at the desk (membership renewals, payment links) goes through a
// PaymentProvider. A test provider stands in until Stripe is connected; the
// rest of the app only knows this interface. Cards are tokens at the
// provider (a payment method reference); card numbers never come here.

export type ChargeRequest = {
  amountCents: number;
  // The saved card at the provider.
  paymentMethodRef: string;
  description: string;
  // The same key never charges twice (the provider's idempotency).
  idempotencyKey: string;
};

export type ChargeResult = { ok: true; reference: string } | { ok: false; reason: string };

export type SavedCard = { ref: string; label: string };

export interface PaymentProvider {
  id: string;
  // Shown to staff: "Test mode" until a real provider is connected.
  label: string;
  testMode: boolean;
  // Charges a saved card (or one the client enters on a payment page).
  charge(request: ChargeRequest): Promise<ChargeResult>;
  // Gives a charge back in full (when what it paid for couldn't be
  // completed).
  refund(reference: string): Promise<{ ok: boolean }>;
  // Cards staff can choose in test mode (a real provider saves the card
  // on its own reader or page instead).
  testCards: readonly (SavedCard & { outcome: string })[];
}
