// Stripe behind the payment provider layer (Stripe Connect: each salon's
// own Standard account, so its money goes straight to the salon). Plain
// HTTPS to Stripe's API, no SDK; `fetch` is passed in so tests never reach
// Stripe. Every call checks the go-live gate first (lib/live.ts): a live
// key never charges off the production site, and nothing runs on the demo.
//
// References carry the salon's account, so a refund or a later charge needs
// nothing else: a card is "acct_…/cus_…/pm_…", a charge "acct_…/pi_…". The
// client types their card into Stripe's own form (the card form, through a
// SetupIntent on the salon's account), so card numbers never reach us.

import { stripeUsable, type StripeKeys } from "../live.ts";
import type { CardForm, ChargeRequest, ChargeResult, PaymentProvider, SavedCard } from "./provider.ts";

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export type StripeError = { type?: string; code?: string; decline_code?: string; message?: string };
export type StripeResult<T> = { ok: true; data: T } | { ok: false; status: number; error: StripeError };

const ACCOUNT = /^acct_[A-Za-z0-9]{1,60}$/;
const ID = (prefix: string) => new RegExp(`^${prefix}_[A-Za-z0-9]{1,100}$`);

// One request to Stripe's API, as the platform or (with `account`) on the
// salon's connected account.
export async function stripeRequest<T>(
  keys: StripeKeys,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: [string, string][] = [],
  options: { account?: string | null; idempotencyKey?: string } = {},
  fetchFn: Fetch = fetch,
): Promise<StripeResult<T>> {
  const body = new URLSearchParams(params);
  const url = method === "GET" && params.length ? `https://api.stripe.com${path}?${body}` : `https://api.stripe.com${path}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${keys.secretKey}`, "Stripe-Version": "2025-03-31.basil" };
  if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (options.account) headers["Stripe-Account"] = options.account;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  let res: Response;
  try {
    res = await fetchFn(url, { method, headers, body: method === "GET" ? undefined : body, signal: AbortSignal.timeout(20_000) });
  } catch {
    return { ok: false, status: 0, error: { type: "api_connection_error", message: "Stripe couldn't be reached" } };
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: StripeError }) | null;
  if (res.ok && json && !json.error) return { ok: true, data: json };
  return { ok: false, status: res.status, error: json?.error ?? {} };
}

// Why a charge or card didn't go through, in words for staff and clients.
export function reasonFor(error: StripeError): string {
  const code = error.decline_code ?? error.code;
  switch (code) {
    case "insufficient_funds":
      return "Insufficient funds";
    case "expired_card":
      return "The card has expired";
    case "incorrect_cvc":
    case "invalid_cvc":
      return "The security code is wrong";
    case "authentication_required":
      return "The card needs the client to approve it. Send them a new card link";
    case "card_declined":
    case "generic_decline":
    case "do_not_honor":
      return "The card was declined";
    case "processing_error":
      return "The card couldn't be processed. Try again";
    default:
      return error.type === "api_connection_error" ? "Stripe couldn't be reached. Try again" : "The card couldn't be charged";
  }
}

export function parseCardRef(ref: string): { account: string; customer: string; paymentMethod: string } | null {
  const [account, customer, paymentMethod, extra] = ref.split("/");
  if (extra !== undefined || !ACCOUNT.test(account ?? "") || !ID("cus").test(customer ?? "") || !ID("pm").test(paymentMethod ?? "")) return null;
  return { account, customer, paymentMethod };
}

export function parseChargeRef(ref: string): { account: string; paymentIntent: string } | null {
  const [account, paymentIntent, extra] = ref.split("/");
  if (extra !== undefined || !ACCOUNT.test(account ?? "") || !ID("pi").test(paymentIntent ?? "")) return null;
  return { account, paymentIntent };
}

const BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay" };

export const cardLabel = (card: { brand?: string; last4?: string } | undefined) => `${BRANDS[card?.brand ?? ""] ?? "Card"} …${card?.last4 ?? ""}`;

type PaymentIntent = { id: string; status: string; last_payment_error?: StripeError };
type SetupIntent = { id: string; status: string; client_secret: string; payment_method: string | { id: string; card?: { brand?: string; last4?: string } } | null };

// The provider for one salon's connected account (`account`), or for
// stored references only (null: charges and refunds use the account in the
// reference; saving a card needs the salon's).
export function stripeProvider(keys: StripeKeys, account: string | null, env: Env = process.env, fetchFn: Fetch = fetch): PaymentProvider {
  const closed = () => {
    const gate = stripeUsable(keys, env);
    return gate.open ? null : gate.reason.replace(/\.$/, "");
  };
  return {
    id: "stripe",
    label: keys.live ? "Stripe" : "Stripe test mode",
    testMode: !keys.live,
    testCards: [],

    async charge(request: ChargeRequest): Promise<ChargeResult> {
      const off = closed();
      if (off) return { ok: false, reason: off };
      if (!Number.isInteger(request.amountCents) || request.amountCents < 50) return { ok: false, reason: "Nothing to charge" };
      const card = parseCardRef(request.paymentMethodRef);
      if (!card) return { ok: false, reason: "The card on file isn't valid" };
      const res = await stripeRequest<PaymentIntent>(
        keys,
        "POST",
        "/v1/payment_intents",
        [
          ["amount", String(request.amountCents)],
          ["currency", "usd"],
          ["customer", card.customer],
          ["payment_method", card.paymentMethod],
          ["confirm", "true"],
          ["off_session", "true"],
          ["description", request.description.slice(0, 200)],
          ["metadata[maestra]", "1"],
        ],
        { account: card.account, idempotencyKey: request.idempotencyKey },
        fetchFn,
      );
      if (!res.ok) return { ok: false, reason: reasonFor(res.error) };
      if (res.data.status !== "succeeded") return { ok: false, reason: reasonFor(res.data.last_payment_error ?? { code: "authentication_required" }) };
      return { ok: true, reference: `${card.account}/${res.data.id}` };
    },

    async refund(reference: string) {
      if (closed()) return { ok: false };
      const charge = parseChargeRef(reference);
      if (!charge) return { ok: false };
      const res = await stripeRequest<{ status: string }>(keys, "POST", "/v1/refunds", [["payment_intent", charge.paymentIntent]], { account: charge.account, idempotencyKey: `refund:${reference}` }, fetchFn);
      return { ok: res.ok && ["succeeded", "pending"].includes(res.data.status) };
    },

    // The client finished Stripe's card form: "acct_…/seti_…". The card is
    // kept on a customer of its own on the salon's account.
    async saveCard(ref: string): Promise<{ ok: true; card: SavedCard } | { ok: false; reason: string }> {
      const off = closed();
      if (off) return { ok: false, reason: off };
      const [refAccount, setupIntent, extra] = ref.split("/");
      if (!account || refAccount !== account || extra !== undefined || !ID("seti").test(setupIntent ?? "")) return { ok: false, reason: "Enter your card" };
      const got = await stripeRequest<SetupIntent>(keys, "GET", `/v1/setup_intents/${setupIntent}`, [["expand[]", "payment_method"]], { account }, fetchFn);
      if (!got.ok) return { ok: false, reason: reasonFor(got.error) };
      const pm = got.data.payment_method;
      if (got.data.status !== "succeeded" || !pm || typeof pm === "string") return { ok: false, reason: "The card wasn't saved. Try again" };
      const customer = await stripeRequest<{ id: string }>(keys, "POST", "/v1/customers", [["payment_method", pm.id], ["metadata[maestra]", "1"]], { account, idempotencyKey: `customer:${setupIntent}` }, fetchFn);
      if (!customer.ok) return { ok: false, reason: reasonFor(customer.error) };
      return { ok: true, card: { ref: `${account}/${customer.data.id}/${pm.id}`, label: cardLabel(pm.card) } };
    },

    // Stripe's card form for this salon: a SetupIntent the client confirms
    // in the browser (3D Secure there if the bank asks).
    async cardForm(): Promise<CardForm> {
      const off = closed();
      if (off || !account) return { kind: "unavailable", reason: off ?? "Card payments aren't set up for this salon yet" };
      const res = await stripeRequest<SetupIntent>(keys, "POST", "/v1/setup_intents", [["usage", "off_session"], ["payment_method_types[]", "card"], ["metadata[maestra]", "1"]], { account }, fetchFn);
      if (!res.ok) return { kind: "unavailable", reason: reasonFor(res.error) };
      return { kind: "stripe", publishableKey: keys.publishableKey, account, clientSecret: res.data.client_secret, testMode: !keys.live };
    },
  };
}

// Connecting a salon (Settings → Payments): a Standard account of its own,
// then Stripe's onboarding (Account Links), and its status afterwards.
export type AccountStatus = { id: string; chargesEnabled: boolean; detailsSubmitted: boolean };

export async function createAccount(keys: StripeKeys, businessId: string, fetchFn: Fetch = fetch): Promise<StripeResult<AccountStatus>> {
  const res = await stripeRequest<{ id: string; charges_enabled: boolean; details_submitted: boolean }>(
    keys,
    "POST",
    "/v1/accounts",
    [["type", "standard"], ["country", "US"], ["metadata[maestra_business]", businessId]],
    { idempotencyKey: `account:${businessId}` },
    fetchFn,
  );
  return res.ok ? { ok: true, data: { id: res.data.id, chargesEnabled: res.data.charges_enabled, detailsSubmitted: res.data.details_submitted } } : res;
}

export async function onboardingLink(keys: StripeKeys, account: string, returnUrl: string, refreshUrl: string, fetchFn: Fetch = fetch): Promise<StripeResult<string>> {
  const res = await stripeRequest<{ url: string }>(
    keys,
    "POST",
    "/v1/account_links",
    [["account", account], ["type", "account_onboarding"], ["return_url", returnUrl], ["refresh_url", refreshUrl]],
    {},
    fetchFn,
  );
  return res.ok ? { ok: true, data: res.data.url } : res;
}

export async function accountStatus(keys: StripeKeys, account: string, fetchFn: Fetch = fetch): Promise<StripeResult<AccountStatus>> {
  const res = await stripeRequest<{ id: string; charges_enabled: boolean; details_submitted: boolean }>(keys, "GET", `/v1/accounts/${account}`, [], {}, fetchFn);
  return res.ok ? { ok: true, data: { id: res.data.id, chargesEnabled: res.data.charges_enabled, detailsSubmitted: res.data.details_submitted } } : res;
}
