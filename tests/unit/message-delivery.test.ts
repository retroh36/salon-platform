import { describe, expect, it, vi } from "vitest";
import { deliverOutbox } from "@/lib/messaging/deliver";
import { e164, fromHeader, resendDelivery, sendEmail, sendText, twilioDelivery } from "@/lib/messaging/providers";
import { stripeSignatureHeader, svixSign, validStripeSignature, validSvixSignature } from "@/lib/webhooks";

const TWILIO = { accountSid: "ACtest", authToken: "tok", from: { messagingServiceSid: "MGtest" } };
const RESEND = { apiKey: "re_test", fromAddress: "hello@mail.example.com" };
const PROD = {
  NODE_ENV: "production",
  MAESTRA_ENV: "production",
  VERCEL_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  TWILIO_ACCOUNT_SID: "ACtest",
  TWILIO_AUTH_TOKEN: "tok",
  TWILIO_MESSAGING_SERVICE_SID: "MGtest",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM_ADDRESS: "hello@mail.example.com",
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the text sender", () => {
  it("sends a US number through the Messaging Service, with the status callback", async () => {
    const fetchFn = vi.fn(async () => json(201, { sid: "SM123" }));
    expect(await sendText(TWILIO, { to: "(312) 555-0142", body: "Hi", statusCallback: "https://app.example/api/messages/status" }, fetchFn)).toEqual({ ok: true, id: "SM123" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("To")).toBe("+13125550142");
    expect(form.get("MessagingServiceSid")).toBe("MGtest");
    expect(form.get("StatusCallback")).toBe("https://app.example/api/messages/status");
  });

  it("refuses a number that isn't one, retries when Twilio is busy, not when it says no", async () => {
    expect(await sendText(TWILIO, { to: "12", body: "x", statusCallback: null }, vi.fn())).toEqual({ ok: false, code: "bad_number", retry: false });
    expect(await sendText(TWILIO, { to: "3125550142", body: "x", statusCallback: null }, async () => json(503, {}))).toEqual({ ok: false, code: "http_503", retry: true });
    expect(await sendText(TWILIO, { to: "3125550142", body: "x", statusCallback: null }, async () => json(400, { code: 21610 }))).toEqual({ ok: false, code: "21610", retry: false });
    expect(await sendText(TWILIO, { to: "3125550142", body: "x", statusCallback: null }, async () => { throw new Error("down"); })).toEqual({ ok: false, code: "unreachable", retry: true });
  });

  it("reads US numbers", () => {
    expect(e164("+1 312 555 0142")).toBe("+13125550142");
    expect(e164("0125550142")).toBeNull();
  });
});

describe("the email sender", () => {
  it("sends from the salon's name with the outbox id as the idempotency key", async () => {
    const fetchFn = vi.fn(async () => json(200, { id: "em_1" }));
    const result = await sendEmail(RESEND, { salon: 'Maple & Ash "Studio"', to: "a@b.co", subject: "Receipt", text: "Thanks", html: "<p>Thanks</p>", idempotencyKey: "outbox-1" }, fetchFn);
    expect(result).toEqual({ ok: true, id: "em_1" });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("outbox-1");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: '"Maple & Ash Studio" <hello@mail.example.com>', to: ["a@b.co"], subject: "Receipt", text: "Thanks", html: "<p>Thanks</p>" });
  });

  it("keeps the header safe", () => {
    expect(fromHeader("A<b>\r\nBcc: x", "h@x.co")).toBe('"AbBcc: x" <h@x.co>');
    expect(fromHeader(null, "h@x.co")).toBe("h@x.co");
  });
});

describe("delivery statuses", () => {
  it("maps Twilio's and Resend's", () => {
    expect(twilioDelivery("delivered")).toBe("delivered");
    expect(twilioDelivery("undelivered")).toBe("failed");
    expect(twilioDelivery("sent")).toBeNull();
    expect(resendDelivery("email.bounced")).toBe("bounced");
    expect(resendDelivery("email.complained")).toBe("complained");
    expect(resendDelivery("email.opened")).toBeNull();
  });
});

describe("webhook signatures", () => {
  it("checks Stripe's, and refuses an old or changed one", () => {
    const body = '{"type":"account.updated"}';
    const header = stripeSignatureHeader("whsec_abc", body);
    expect(validStripeSignature("whsec_abc", body, header)).toBe(true);
    expect(validStripeSignature("whsec_abc", body + " ", header)).toBe(false);
    expect(validStripeSignature("whsec_other", body, header)).toBe(false);
    expect(validStripeSignature("whsec_abc", body, header, Date.now() + 10 * 60_000)).toBe(false);
    expect(validStripeSignature("whsec_abc", body, null)).toBe(false);
  });

  it("checks Resend's (Svix)", () => {
    const secret = `whsec_${Buffer.from("secret-bytes").toString("base64")}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"email.bounced"}';
    const signature = `v1,${svixSign(secret, "msg_1", ts, body)}`;
    expect(validSvixSignature(secret, body, { id: "msg_1", timestamp: ts, signature })).toBe(true);
    expect(validSvixSignature(secret, body, { id: "msg_2", timestamp: ts, signature })).toBe(false);
    expect(validSvixSignature(secret, body, { id: "msg_1", timestamp: String(Number(ts) - 3600), signature })).toBe(false);
  });
});

// A stand-in for the database: queued messages to claim, suppressions,
// and what was recorded.
function fakeAdmin(messages: { id: string; channel: "sms" | "email"; to_address: string; attempts?: number }[], suppressed: { phones?: string[]; emails?: string[] } = {}) {
  const recorded: Record<string, unknown>[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "claim_outbox_messages") return { data: messages.map((m) => ({ business_id: "b", salon: "Maple & Ash", subject: "Hi", body: "Hello", html: null, attempts: 1, ...m })), error: null };
    if (fn === "record_outbox_result") recorded.push(args);
    return { data: null, error: null };
  });
  const from = (table: string) => ({
    select: () => ({
      in: async () => ({ data: table === "sms_suppressions" ? (suppressed.phones ?? []).map((p) => ({ phone_digits: p })) : (suppressed.emails ?? []).map((e) => ({ email: e })) }),
    }),
  });
  return { admin: { rpc, from } as never, rpc, recorded };
}

describe("the outbox sender", () => {
  it("sends nothing off the production site, not even claiming a message", async () => {
    for (const env of [{ ...PROD, DEMO_MODE: "true" }, { ...PROD, MAESTRA_ENV: "staging" }, { ...PROD, VERCEL_ENV: "preview" }]) {
      const { admin, rpc } = fakeAdmin([{ id: "m1", channel: "sms", to_address: "3125550142" }]);
      const fetchFn = vi.fn();
      const counts = await deliverOutbox(admin, env, fetchFn);
      expect(counts.sent).toBe(0);
      expect(counts.skipped).toBeTruthy();
      expect(rpc).not.toHaveBeenCalled();
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it("sends texts and email, skipping a STOP'd number and a bounced address", async () => {
    const { admin, recorded } = fakeAdmin(
      [
        { id: "m1", channel: "sms", to_address: "3125550142" },
        { id: "m2", channel: "sms", to_address: "3125550199" },
        { id: "m3", channel: "email", to_address: "Gone@Example.com" },
        { id: "m4", channel: "email", to_address: "ok@example.com" },
      ],
      { phones: ["3125550199"], emails: ["gone@example.com"] },
    );
    const fetchFn = vi.fn(async (url: string) => (url.includes("twilio") ? json(201, { sid: "SM1" }) : json(200, { id: "em_1" })));
    expect(await deliverOutbox(admin, PROD, fetchFn as never)).toEqual({ sent: 2, failed: 0, suppressed: 2, retrying: 0, held: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(recorded).toEqual([
      { p_id: "m1", p_status: "sent", p_provider: "twilio", p_provider_id: "SM1", p_error: null },
      { p_id: "m2", p_status: "suppressed", p_provider: null, p_provider_id: null, p_error: "suppressed" },
      { p_id: "m3", p_status: "suppressed", p_provider: null, p_provider_id: null, p_error: "suppressed" },
      { p_id: "m4", p_status: "sent", p_provider: "resend", p_provider_id: "em_1", p_error: null },
    ]);
  });

  it("tries a busy provider again, up to three times, and keeps a channel without keys in the outbox", async () => {
    const { admin, recorded } = fakeAdmin([
      { id: "m1", channel: "sms", to_address: "3125550142", attempts: 1 },
      { id: "m2", channel: "sms", to_address: "3125550142", attempts: 3 },
      { id: "m3", channel: "email", to_address: "ok@example.com" },
    ]);
    const noEmail = { ...PROD, RESEND_API_KEY: undefined };
    const counts = await deliverOutbox(admin, noEmail, (async () => json(503, {})) as never);
    expect(counts).toEqual({ sent: 0, failed: 1, suppressed: 0, retrying: 1, held: 1 });
    expect(recorded.map((r) => [r.p_id, r.p_status, r.p_error])).toEqual([
      ["m1", "queued", "http_503"],
      ["m2", "failed", "http_503"],
      ["m3", "held", "not_connected"],
    ]);
  });
});

describe("Settings → Messages", () => {
  it("is in the outbox until the salon goes live on the production site with keys", async () => {
    const { messagingStatus } = await import("@/lib/messaging/status");
    const none = messagingStatus({ messages_live: false }, { ...PROD, TWILIO_ACCOUNT_SID: undefined, RESEND_API_KEY: undefined });
    expect(none).toMatchObject({ texts: { label: "Not connected" }, email: { label: "Not connected" }, sending: false });
    expect(none.cantGoLive).toContain("aren't connected");
    const ready = messagingStatus({ messages_live: false }, PROD);
    expect(ready).toMatchObject({ texts: { label: "Connected" }, email: { label: "Connected" }, sending: false, cantGoLive: null });
    expect(messagingStatus({ messages_live: true }, PROD)).toMatchObject({ sending: true, summary: "Texts and emails are going to clients." });
    // The demo, with every key and the switch on, still sends nothing.
    const demo = messagingStatus({ messages_live: true }, { ...PROD, DEMO_MODE: "true" });
    expect(demo.sending).toBe(false);
    expect(demo.cantGoLive).toContain("demo");
    expect(demo.summary).toContain("nothing is sent from here");
  });
});
