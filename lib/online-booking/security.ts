// Protection for the public booking site: secrets and codes, hashed request
// details for the log, and rate limits (counted in the database, so they
// hold across server instances).

import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import type { Database } from "@/lib/database.types";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// A random secret for a link or a browser session (only its hash is kept).
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// Keyed, so the log can tell repeat visitors apart without the address
// being recoverable from it.
function keyedHash(value: string): string {
  return createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "maestra").update(value).digest("hex").slice(0, 32);
}

export async function requestInfo(): Promise<{ ipHash: string; userAgent: string | null }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  return { ipHash: keyedHash(ip), userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

export function hashKey(value: string): string {
  return keyedHash(value);
}

// A booking attempt's key, made by the booking page (newSecret's shape).
export function isAttemptKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(value);
}

// The manage link's secret for a booking attempt, worked out from its key
// with the server's secret: a retry of the same attempt gets the same link
// back, and the link itself is never stored.
export function manageSecretFor(attemptKey: string): string {
  return createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "maestra").update(`manage:${attemptKey}`).digest("base64url");
}

// Counts a request against each limit; false if any is used up.
export async function withinLimits(
  admin: SupabaseClient<Database>,
  limits: readonly { key: string; limit: number; windowSeconds: number }[],
): Promise<boolean> {
  const results = await Promise.all(
    limits.map((l) => admin.rpc("hit_rate_limit", { p_key: l.key, p_limit: l.limit, p_window_seconds: l.windowSeconds })),
  );
  for (const r of results) if (r.error) throw r.error;
  return results.every((r) => r.data === true);
}
