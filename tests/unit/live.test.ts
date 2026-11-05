import { describe, expect, it } from "vitest";
import { liveGate, resendKeys, stripeKeys, stripeUsable, twilioKeys } from "@/lib/live";

// Nothing real goes out unless this is the production site: never the demo,
// staging, previews, development or the tests, whatever keys are set.
const PROD = { NODE_ENV: "production", MAESTRA_ENV: "production", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" };

describe("the go-live gate", () => {
  it("opens only on the production site", () => {
    expect(liveGate(PROD)).toEqual({ open: true });
    // Not on Vercel at all (another host) still needs MAESTRA_ENV.
    const elsewhere = { ...PROD, VERCEL_ENV: undefined };
    expect(liveGate(elsewhere)).toEqual({ open: true });
  });

  it("stays shut on the demo, even as production with every key", () => {
    const gate = liveGate({ ...PROD, DEMO_MODE: "true", STRIPE_SECRET_KEY: "sk_live_x", TWILIO_ACCOUNT_SID: "ACx" });
    expect(gate.open).toBe(false);
    expect(!gate.open && gate.reason).toContain("demo");
  });

  it("stays shut on staging, previews, development, local databases and the test server", () => {
    for (const env of [
      { ...PROD, MAESTRA_ENV: "staging" },
      { ...PROD, MAESTRA_ENV: undefined },
      { ...PROD, VERCEL_ENV: "preview" },
      { ...PROD, NODE_ENV: "development" },
      { ...PROD, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
      { ...PROD, MAESTRA_TEST_SERVER: "true" },
    ]) {
      expect(liveGate(env).open).toBe(false);
    }
  });
});

describe("keys", () => {
  it("reads Twilio with a Messaging Service or a number", () => {
    expect(twilioKeys({ TWILIO_ACCOUNT_SID: "ACabc", TWILIO_AUTH_TOKEN: "t", TWILIO_MESSAGING_SERVICE_SID: "MGabc" })).toEqual({ accountSid: "ACabc", authToken: "t", from: { messagingServiceSid: "MGabc" } });
    expect(twilioKeys({ TWILIO_ACCOUNT_SID: "ACabc", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+13125550100" })?.from).toEqual({ number: "+13125550100" });
    expect(twilioKeys({ TWILIO_ACCOUNT_SID: "ACabc", TWILIO_AUTH_TOKEN: "t" })).toBeNull();
    expect(twilioKeys({ TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+1" })).toBeNull();
  });

  it("reads Resend only with a sending address", () => {
    expect(resendKeys({ RESEND_API_KEY: "re_x", EMAIL_FROM_ADDRESS: "hello@mail.maestra.app" })).toEqual({ apiKey: "re_x", fromAddress: "hello@mail.maestra.app" });
    expect(resendKeys({ RESEND_API_KEY: "re_x" })).toBeNull();
    expect(resendKeys({ RESEND_API_KEY: "re_x", EMAIL_FROM_ADDRESS: "not an address" })).toBeNull();
  });

  it("reads Stripe's keys as a matching live or test pair", () => {
    expect(stripeKeys({ STRIPE_SECRET_KEY: "sk_test_x", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_y" })).toMatchObject({ live: false, webhookSecret: null });
    expect(stripeKeys({ STRIPE_SECRET_KEY: "sk_live_x", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_y", STRIPE_WEBHOOK_SECRET: "whsec_z" })).toMatchObject({ live: true, webhookSecret: "whsec_z" });
    expect(stripeKeys({ STRIPE_SECRET_KEY: "sk_live_x", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_y" })).toBeNull();
    expect(stripeKeys({ STRIPE_SECRET_KEY: "sk_live_x" })).toBeNull();
  });

  it("uses Stripe's test mode off the demo, and live keys only through the gate", () => {
    const test = stripeKeys({ STRIPE_SECRET_KEY: "sk_test_x", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_y" });
    const live = stripeKeys({ STRIPE_SECRET_KEY: "sk_live_x", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_y" });
    expect(stripeUsable(test, { NODE_ENV: "development" }).open).toBe(true);
    expect(stripeUsable(test, { ...PROD, MAESTRA_ENV: "staging" }).open).toBe(true);
    expect(stripeUsable(test, { ...PROD, DEMO_MODE: "true" }).open).toBe(false);
    expect(stripeUsable(test, { MAESTRA_TEST_SERVER: "true" }).open).toBe(false);
    expect(stripeUsable(live, { ...PROD, MAESTRA_ENV: "staging" }).open).toBe(false);
    expect(stripeUsable(live, PROD).open).toBe(true);
    expect(stripeUsable(null, PROD).open).toBe(false);
  });
});
