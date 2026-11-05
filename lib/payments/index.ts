// Which payment provider handles a charge. Each salon uses the test
// provider until it connects its own Stripe account (Settings → Payments)
// and, with Stripe's live keys, turns on "Go live" on the production site
// (lib/live.ts). Records remember their provider ("test" or "stripe"), and a
// Stripe reference carries the salon's account, so a renewal, fee or
// refund later goes back through the same one.

import { stripeKeys, stripeUsable } from "../live.ts";
import type { PaymentProvider } from "./provider.ts";
import { stripeProvider } from "./stripe.ts";
import { testProvider } from "./test-provider.ts";

export type { CardForm, ChargeRequest, ChargeResult, PaymentProvider, SavedCard } from "./provider.ts";

type Env = Record<string, string | undefined>;

// Stripe records when Stripe's keys aren't set here (a copy of the data
// somewhere else): nothing can be charged or refunded.
const stripeMissing: PaymentProvider = {
  id: "stripe",
  label: "Stripe",
  testMode: false,
  charge: async () => ({ ok: false, reason: "Stripe isn't connected here" }),
  refund: async () => ({ ok: false }),
  saveCard: async () => ({ ok: false, reason: "Stripe isn't connected here" }),
  cardForm: async () => ({ kind: "unavailable", reason: "Card payments aren't set up for this salon yet" }),
  testCards: [],
};

// The provider a stored record was made with (its `provider` column).
export function providerFor(id: string, env: Env = process.env): PaymentProvider {
  if (id !== "stripe") return testProvider;
  const keys = stripeKeys(env);
  return keys ? stripeProvider(keys, null, env) : stripeMissing;
}

// What a salon's payments need to know about it.
export const PAYMENT_COLUMNS = "payments_live, stripe_account_id, stripe_charges_enabled";
export type PaymentsBusiness = { payments_live: boolean; stripe_account_id: string | null; stripe_charges_enabled: boolean };

// The provider for anything new at a salon (cards, deposits, links,
// memberships, fees): its Stripe account once it's connected and able to
// take payments, with test keys anywhere but the demo, with live keys only
// once it's gone live through the gate. Otherwise the test provider.
export function currentProvider(business: PaymentsBusiness | null, env: Env = process.env): PaymentProvider {
  const keys = stripeKeys(env);
  if (!business?.stripe_account_id || !business.stripe_charges_enabled || !keys) return testProvider;
  if (!stripeUsable(keys, env).open) return testProvider;
  if (keys.live && !business.payments_live) return testProvider;
  return stripeProvider(keys, business.stripe_account_id, env);
}

type PaymentsClient = {
  from: (table: "businesses") => {
    select: (columns: typeof PAYMENT_COLUMNS) => { eq: (column: "id", value: string) => { maybeSingle: () => PromiseLike<{ data: PaymentsBusiness | null }> } };
  };
};

// currentProvider for a salon by its id.
export async function salonProvider(client: unknown, businessId: string, env: Env = process.env): Promise<PaymentProvider> {
  const { data } = await (client as PaymentsClient).from("businesses").select(PAYMENT_COLUMNS).eq("id", businessId).maybeSingle();
  return currentProvider(data, env);
}

// What Settings → Payments says: Not connected (no Stripe account, test
// cards only), Test mode (connected, but no real money: Stripe's test keys,
// or not live yet), or Live.
export type PaymentsStatus = {
  label: "Not connected" | "Test mode" | "Live";
  connected: boolean;
  // Connected but Stripe still needs details before it takes payments.
  onboarding: boolean;
  live: boolean;
  // Why Connect can't be used here, or null.
  cantConnect: string | null;
  // Why Go live can't be turned on, or null.
  cantGoLive: string | null;
  summary: string;
};

export function paymentsStatus(business: PaymentsBusiness, env: Env = process.env): PaymentsStatus {
  const keys = stripeKeys(env);
  const usable = stripeUsable(keys, env);
  const cantConnect = usable.open ? null : usable.reason;
  const connected = !!business.stripe_account_id;
  const onboarding = connected && !business.stripe_charges_enabled;
  const provider = currentProvider(business, env);
  const live = provider.id === "stripe" && !provider.testMode;
  let cantGoLive: string | null = null;
  if (!keys?.live) cantGoLive = keys ? "Maestra is using Stripe's test keys, so there's no live mode here." : (cantConnect ?? "Stripe isn't set up on Maestra yet.");
  else if (cantConnect) cantGoLive = cantConnect;
  else if (!connected) cantGoLive = "Connect your Stripe account first.";
  else if (onboarding) cantGoLive = "Finish setting up your Stripe account first.";
  const label = !connected ? "Not connected" : live ? "Live" : "Test mode";
  let summary: string;
  if (live) summary = "Card payments go to your Stripe account. Clients' cards are charged for real.";
  else if (provider.id === "stripe") summary = "Connected to Stripe in test mode: Stripe's test cards work and no money moves.";
  else if (onboarding) summary = "Stripe still needs a few details before your account can take payments. Until then, only test cards work.";
  else if (connected) summary = "Connected. Until you go live, only test cards work and no money moves.";
  else summary = "Only test cards work, and no money moves. Connect your Stripe account to take real payments.";
  return { label, connected, onboarding, live, cantConnect, cantGoLive, summary };
}

// The cards staff can choose for a client (the card a membership renews
// on): the client's card on file when it's with this provider, and the
// test cards in test mode. With Stripe, a card the client hasn't saved
// comes through a card link (staff never type card numbers).
export type StaffCard = { ref: string; label: string; outcome: string };

export function staffCards(provider: PaymentProvider, onFile: { provider: string; payment_method_ref: string; label: string } | null): StaffCard[] {
  const theirs = onFile && onFile.provider === provider.id ? [{ ref: onFile.payment_method_ref, label: onFile.label, outcome: "On file" }] : [];
  return [...theirs, ...provider.testCards.filter((c) => c.ref !== onFile?.payment_method_ref).map((c) => ({ ref: c.ref, label: c.label, outcome: c.outcome }))];
}

type CardsClient = {
  from: (table: "client_cards") => {
    select: (columns: "provider, payment_method_ref, label") => {
      eq: (column: "client_id", value: string) => { is: (column: "removed_at", value: null) => { maybeSingle: () => PromiseLike<{ data: { provider: string; payment_method_ref: string; label: string } | null }> } };
    };
  };
};

// A client's card on file (front of house read it).
export async function cardOnFile(client: unknown, clientId: string) {
  const { data } = await (client as CardsClient).from("client_cards").select("provider, payment_method_ref, label").eq("client_id", clientId).is("removed_at", null).maybeSingle();
  return data;
}
