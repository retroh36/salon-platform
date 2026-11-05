// Whether this deployment may ever send a real text or email, or charge a
// real card. Only the production site may (MAESTRA_ENV=production, set
// only on the real production project, built for production, on Vercel's
// production environment when on Vercel, against a hosted database), and
// never the public demo or the browser tests' server, whatever keys are
// set. A salon then still has to turn on "Go live" itself (Settings →
// Messages, Settings → Payments), and every sender and charge checks this
// again at the moment it goes out (docs/going-live.md).

import { isDemo } from "./demo.ts";

type Env = Record<string, string | undefined>;

export type Gate = { open: true } | { open: false; reason: string };

const closed = (reason: string): Gate => ({ open: false, reason });

export function liveGate(env: Env = process.env): Gate {
  if (isDemo(env)) return closed("This is the demo, so nothing real is ever sent or charged.");
  if (env.MAESTRA_TEST_SERVER === "true") return closed("This is a test server, so nothing real is ever sent or charged.");
  if (env.NODE_ENV !== "production") return closed("This is a development copy, so nothing real is ever sent or charged.");
  if (env.MAESTRA_ENV !== "production") return closed("Only the production site sends real messages and takes real payments.");
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "production") return closed("This is a preview copy, so nothing real is ever sent or charged.");
  if (isLocalDatabase(env.NEXT_PUBLIC_SUPABASE_URL)) return closed("This copy uses a local database, so nothing real is ever sent or charged.");
  return { open: true };
}

export function isLocalDatabase(url: string | undefined): boolean {
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(url ?? "").hostname);
  } catch {
    return false;
  }
}

// Texts (Twilio): the account, its token, and who they come from (a
// Messaging Service, else one number).
export type TwilioKeys = { accountSid: string; authToken: string; from: { messagingServiceSid: string } | { number: string } };

export function twilioKeys(env: Env = process.env): TwilioKeys | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const service = env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const number = env.TWILIO_FROM_NUMBER?.trim();
  if (!accountSid?.startsWith("AC") || !authToken || !(service?.startsWith("MG") || number)) return null;
  return { accountSid, authToken, from: service?.startsWith("MG") ? { messagingServiceSid: service } : { number: number! } };
}

// Email (Resend): the key and the address on the domain verified there.
export type ResendKeys = { apiKey: string; fromAddress: string };

export function resendKeys(env: Env = process.env): ResendKeys | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const fromAddress = env.EMAIL_FROM_ADDRESS?.trim();
  if (!apiKey?.startsWith("re_") || !fromAddress || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(fromAddress)) return null;
  return { apiKey, fromAddress };
}

// Payments (Stripe): the platform's secret key, the publishable key the
// card form uses, and the webhook secret. A test key (sk_test_) is Stripe's
// own test mode: no money moves, so it may run on staging too (never the
// demo); a live key (sk_live_) only ever charges through the gate.
export type StripeKeys = { secretKey: string; publishableKey: string; webhookSecret: string | null; live: boolean };

export function stripeKeys(env: Env = process.env): StripeKeys | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const publishableKey = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  if (!secretKey || !publishableKey) return null;
  const live = secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
  const test = secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_");
  if (!live && !test) return null;
  // A test secret key with a live publishable key (or the other way round)
  // can't work; treat it as not set rather than fail at the card form.
  if (publishableKey.startsWith(live ? "pk_test_" : "pk_live_")) return null;
  return { secretKey, publishableKey, webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || null, live };
}

// Whether Stripe may be used at all here: a live key only through the gate,
// a test key anywhere but the demo and the browser tests' server.
export function stripeUsable(keys: StripeKeys | null, env: Env = process.env): Gate {
  if (!keys) return closed("Stripe isn't set up on Maestra yet.");
  if (keys.live) return liveGate(env);
  if (isDemo(env)) return closed("This is the demo, so nothing real is ever sent or charged.");
  if (env.MAESTRA_TEST_SERVER === "true") return closed("This is a test server, so nothing real is ever sent or charged.");
  return { open: true };
}
