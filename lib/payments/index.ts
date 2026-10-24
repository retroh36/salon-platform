// Which payment provider handles a charge. The test provider until Stripe
// is connected (STRIPE_SECRET_KEY); a membership remembers its provider, so
// switching later doesn't strand anyone.

import type { PaymentProvider } from "./provider.ts";
import { testProvider } from "./test-provider.ts";

export type { ChargeRequest, ChargeResult, PaymentProvider, SavedCard } from "./provider.ts";

// Stripe plugs in here (Connect for payouts, saved cards through Terminal
// and Checkout). Until then, nothing is charged for real.
const stripeProvider: PaymentProvider = {
  id: "stripe",
  label: "Stripe",
  testMode: false,
  charge: async () => ({ ok: false, reason: "Stripe isn't connected yet" }),
  refund: async () => ({ ok: false }),
  testCards: [],
};

const PROVIDERS: Record<string, PaymentProvider> = { test: testProvider, stripe: stripeProvider };

export function providerFor(id: string): PaymentProvider {
  return PROVIDERS[id] ?? testProvider;
}

// The provider new memberships and payment links use.
export function currentProvider(env: Record<string, string | undefined> = process.env): PaymentProvider {
  return env.STRIPE_SECRET_KEY ? stripeProvider : testProvider;
}
