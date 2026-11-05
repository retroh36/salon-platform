// Checking that a webhook really came from Stripe or Resend (pure,
// unit-tested): each signs the raw body with a secret only it and we know,
// with a timestamp so an old request can't be replayed. Twilio's own check
// is in lib/messaging/inbound.ts.

import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300;

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const fresh = (timestamp: number, now: number) => Number.isFinite(timestamp) && Math.abs(now / 1000 - timestamp) <= TOLERANCE_SECONDS;

// Stripe: "Stripe-Signature: t=1700000000,v1=<hex>,v1=<hex>", HMAC-SHA256
// of "<t>.<body>" with the endpoint's secret (whsec_…).
export function validStripeSignature(secret: string, body: string, header: string | null, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const given = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!fresh(t, now) || given.length === 0) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");
  return given.some((g) => same(g, expected));
}

export function stripeSignatureHeader(secret: string, body: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex")}`;
}

// Resend (through Svix): svix-id, svix-timestamp and svix-signature
// ("v1,<base64> v1,<base64>"), HMAC-SHA256 of "<id>.<timestamp>.<body>"
// with the secret after "whsec_", base64-decoded.
export function validSvixSignature(secret: string, body: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, now = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !fresh(Number(timestamp), now)) return false;
  const expected = svixSign(secret, id, timestamp, body);
  return signature
    .split(" ")
    .map((s) => s.split(","))
    .some(([version, sig]) => version === "v1" && !!sig && same(sig, expected));
}

export function svixSign(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`, "utf8").digest("base64");
}
