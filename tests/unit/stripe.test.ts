import { describe, expect, it, vi } from "vitest";
import { stripeKeys } from "@/lib/live";
import { currentProvider, paymentsStatus, providerFor, staffCards } from "@/lib/payments";
import { cardLabel, createAccount, onboardingLink, parseCardRef, reasonFor, stripeProvider } from "@/lib/payments/stripe";
import { testProvider } from "@/lib/payments/test-provider";

// Stripe behind the payment provider layer, against a stand-in for
// Stripe's API: nothing here reaches Stripe.

const TEST_ENV = { NODE_ENV: "development", STRIPE_SECRET_KEY: "sk_test_abc", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_abc" };
const PROD = { NODE_ENV: "production", MAESTRA_ENV: "production", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" };
const LIVE_ENV = { ...PROD, STRIPE_SECRET_KEY: "sk_live_abc", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_abc" };
const KEYS = stripeKeys(TEST_ENV)!;
const LIVE_KEYS = stripeKeys(LIVE_ENV)!;
const ACCT = "acct_1Salon";
const CARD = `${ACCT}/cus_123/pm_456`;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stripe(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit; form: URLSearchParams }[] = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init, form: new URLSearchParams(typeof init.body === "string" ? init.body : (init.body as URLSearchParams | undefined)?.toString()) });
    return handler(url, init);
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, header: (i: number, name: string) => (calls[i].init.headers as Record<string, string>)[name] };
}

describe("charging a saved card", () => {
  it("charges off session on the salon's account, once per key", async () => {
    const s = stripe(() => json(200, { id: "pi_789", status: "succeeded" }));
    const result = await stripeProvider(KEYS, null, TEST_ENV, s.fetchFn).charge({ amountCents: 4000, paymentMethodRef: CARD, description: "No-show fee", idempotencyKey: "fee:1" });
    expect(result).toEqual({ ok: true, reference: `${ACCT}/pi_789` });
    expect(s.calls[0].url).toBe("https://api.stripe.com/v1/payment_intents");
    expect(s.header(0, "Stripe-Account")).toBe(ACCT);
    expect(s.header(0, "Idempotency-Key")).toBe("fee:1");
    expect(Object.fromEntries(s.calls[0].form)).toMatchObject({ amount: "4000", currency: "usd", customer: "cus_123", payment_method: "pm_456", confirm: "true", off_session: "true" });
  });

  it("says why a card was declined", async () => {
    const s = stripe(() => json(402, { error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds" } }));
    expect(await stripeProvider(KEYS, null, TEST_ENV, s.fetchFn).charge({ amountCents: 4000, paymentMethodRef: CARD, description: "x", idempotencyKey: "k" })).toEqual({ ok: false, reason: "Insufficient funds" });
    expect(reasonFor({ code: "authentication_required" })).toContain("card link");
    expect(reasonFor({ type: "api_connection_error" })).toContain("couldn't be reached");
  });

  it("refuses a reference that isn't a saved card, without calling Stripe", async () => {
    const s = stripe(() => json(200, {}));
    expect(await stripeProvider(KEYS, null, TEST_ENV, s.fetchFn).charge({ amountCents: 4000, paymentMethodRef: "test_visa_4242", description: "x", idempotencyKey: "k" })).toEqual({ ok: false, reason: "The card on file isn't valid" });
    expect(s.calls).toHaveLength(0);
    expect(parseCardRef("acct_1/cus_2/pm_3/extra")).toBeNull();
  });

  it("refunds by the reference's account", async () => {
    const s = stripe(() => json(200, { id: "re_1", status: "succeeded" }));
    expect(await stripeProvider(KEYS, null, TEST_ENV, s.fetchFn).refund(`${ACCT}/pi_789`)).toEqual({ ok: true });
    expect(s.header(0, "Stripe-Account")).toBe(ACCT);
    expect(s.calls[0].form.get("payment_intent")).toBe("pi_789");
    expect(await stripeProvider(KEYS, null, TEST_ENV, s.fetchFn).refund("test_ch_abc")).toEqual({ ok: false });
  });
});

describe("the gate", () => {
  it("never charges or refunds on the demo, even with Stripe's keys", async () => {
    const s = stripe(() => json(200, { id: "pi_1", status: "succeeded" }));
    const demo = { ...TEST_ENV, DEMO_MODE: "true" };
    const provider = stripeProvider(KEYS, ACCT, demo, s.fetchFn);
    expect((await provider.charge({ amountCents: 4000, paymentMethodRef: CARD, description: "x", idempotencyKey: "k" })).ok).toBe(false);
    expect(await provider.refund(`${ACCT}/pi_1`)).toEqual({ ok: false });
    expect((await provider.cardForm()).kind).toBe("unavailable");
    expect(s.calls).toHaveLength(0);
  });

  it("never charges with live keys off the production site", async () => {
    const s = stripe(() => json(200, { id: "pi_1", status: "succeeded" }));
    const staging = { ...LIVE_ENV, MAESTRA_ENV: "staging" };
    const result = await stripeProvider(LIVE_KEYS, ACCT, staging, s.fetchFn).charge({ amountCents: 4000, paymentMethodRef: CARD, description: "x", idempotencyKey: "k" });
    expect(result.ok).toBe(false);
    expect(s.calls).toHaveLength(0);
  });
});

describe("saving a card from Stripe's form", () => {
  it("reads the confirmed SetupIntent and keeps the card on a customer of its own", async () => {
    const s = stripe((url) =>
      url.includes("/v1/setup_intents/")
        ? json(200, { id: "seti_1", status: "succeeded", client_secret: "x", payment_method: { id: "pm_9", card: { brand: "visa", last4: "4242" } } })
        : json(200, { id: "cus_9" }),
    );
    const saved = await stripeProvider(KEYS, ACCT, TEST_ENV, s.fetchFn).saveCard(`${ACCT}/seti_1`);
    expect(saved).toEqual({ ok: true, card: { ref: `${ACCT}/cus_9/pm_9`, label: "Visa …4242" } });
    expect(s.calls[0].url).toBe("https://api.stripe.com/v1/setup_intents/seti_1?expand%5B%5D=payment_method");
    expect(s.calls[1].form.get("payment_method")).toBe("pm_9");
    expect(s.header(1, "Stripe-Account")).toBe(ACCT);
  });

  it("refuses another salon's account, or a SetupIntent that didn't finish", async () => {
    const unfinished = stripe(() => json(200, { id: "seti_1", status: "requires_action", client_secret: "x", payment_method: null }));
    expect((await stripeProvider(KEYS, ACCT, TEST_ENV, unfinished.fetchFn).saveCard(`${ACCT}/seti_1`)).ok).toBe(false);
    const other = stripe(() => json(200, {}));
    expect(await stripeProvider(KEYS, ACCT, TEST_ENV, other.fetchFn).saveCard("acct_Other/seti_1")).toEqual({ ok: false, reason: "Enter your card" });
    expect(other.calls).toHaveLength(0);
  });

  it("gives the card form a SetupIntent on the salon's account", async () => {
    const s = stripe(() => json(200, { id: "seti_2", status: "requires_payment_method", client_secret: "seti_2_secret", payment_method: null }));
    expect(await stripeProvider(KEYS, ACCT, TEST_ENV, s.fetchFn).cardForm()).toEqual({ kind: "stripe", publishableKey: "pk_test_abc", account: ACCT, clientSecret: "seti_2_secret", testMode: true });
    expect(s.calls[0].form.get("usage")).toBe("off_session");
  });

  it("labels cards", () => {
    expect(cardLabel({ brand: "amex", last4: "0005" })).toBe("American Express …0005");
    expect(cardLabel(undefined)).toBe("Card …");
  });
});

describe("connecting a salon", () => {
  it("creates a Standard account once per salon, then its onboarding link", async () => {
    const s = stripe((url) => (url.endsWith("/v1/accounts") ? json(200, { id: ACCT, charges_enabled: false, details_submitted: false }) : json(200, { url: "https://connect.stripe.com/setup/x" })));
    expect(await createAccount(KEYS, "b1", s.fetchFn)).toEqual({ ok: true, data: { id: ACCT, chargesEnabled: false, detailsSubmitted: false } });
    expect(s.calls[0].form.get("type")).toBe("standard");
    expect(s.header(0, "Idempotency-Key")).toBe("account:b1");
    expect(await onboardingLink(KEYS, ACCT, "https://app/settings/payments?connected=1", "https://app/settings/payments?refresh=1", s.fetchFn)).toEqual({ ok: true, data: "https://connect.stripe.com/setup/x" });
  });
});

describe("which provider a salon uses", () => {
  const connected = { payments_live: false, stripe_account_id: ACCT, stripe_charges_enabled: true };

  it("is Stripe's test mode once connected with test keys, never on the demo", () => {
    expect(currentProvider(connected, TEST_ENV)).toMatchObject({ id: "stripe", testMode: true });
    expect(currentProvider(connected, { ...TEST_ENV, DEMO_MODE: "true" }).id).toBe("test");
    expect(currentProvider({ ...connected, stripe_charges_enabled: false }, TEST_ENV).id).toBe("test");
  });

  it("is live only with live keys, on production, once the salon goes live", () => {
    expect(currentProvider(connected, LIVE_ENV).id).toBe("test");
    expect(currentProvider({ ...connected, payments_live: true }, LIVE_ENV)).toMatchObject({ id: "stripe", testMode: false });
    expect(currentProvider({ ...connected, payments_live: true }, { ...LIVE_ENV, VERCEL_ENV: "preview" }).id).toBe("test");
  });

  it("says Not connected, Test mode or Live", () => {
    expect(paymentsStatus({ payments_live: false, stripe_account_id: null, stripe_charges_enabled: false }, TEST_ENV)).toMatchObject({ label: "Not connected", cantConnect: null });
    expect(paymentsStatus(connected, TEST_ENV)).toMatchObject({ label: "Test mode", live: false });
    expect(paymentsStatus(connected, TEST_ENV).cantGoLive).toContain("test keys");
    expect(paymentsStatus(connected, LIVE_ENV)).toMatchObject({ label: "Test mode", cantGoLive: null });
    expect(paymentsStatus({ ...connected, payments_live: true }, LIVE_ENV)).toMatchObject({ label: "Live", live: true });
    expect(paymentsStatus({ ...connected, stripe_charges_enabled: false }, LIVE_ENV)).toMatchObject({ onboarding: true, cantGoLive: "Finish setting up your Stripe account first." });
    const demo = paymentsStatus(connected, { ...LIVE_ENV, DEMO_MODE: "true" });
    expect(demo.cantConnect).toContain("demo");
    expect(demo.label).toBe("Test mode");
  });

  it("charges stored Stripe records only where Stripe is set up", async () => {
    expect(providerFor("stripe", {}).id).toBe("stripe");
    expect((await providerFor("stripe", {}).charge({ amountCents: 100, paymentMethodRef: CARD, description: "x", idempotencyKey: "k" })).ok).toBe(false);
    expect(providerFor("test", TEST_ENV)).toBe(testProvider);
  });

  it("offers staff the client's card on file, and test cards in test mode", () => {
    const onFile = { provider: "stripe", payment_method_ref: CARD, label: "Visa …4242" };
    expect(staffCards(stripeProvider(KEYS, ACCT, TEST_ENV), onFile)).toEqual([{ ref: CARD, label: "Visa …4242", outcome: "On file" }]);
    expect(staffCards(stripeProvider(KEYS, ACCT, TEST_ENV), null)).toEqual([]);
    expect(staffCards(testProvider, onFile).map((c) => c.ref)).toEqual(["test_visa_4242", "test_visa_0002", "test_visa_9995"]);
    expect(staffCards(testProvider, { provider: "test", payment_method_ref: "test_visa_0002", label: "Visa …0002" })[0]).toEqual({ ref: "test_visa_0002", label: "Visa …0002", outcome: "On file" });
  });
});
