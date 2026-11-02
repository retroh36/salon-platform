// Whether Denise's thinking is working, in plain words for Settings. Every
// call's outcome is recorded by the meter (./usage.ts): a call that worked
// stamps ai_health.last_ok_at, one that failed keeps when and a reason code
// from failureReason in ./errors.ts (never the error's own text). Settings shows "Working"
// only when the latest outcome was a call that worked, and says why not
// otherwise. Pure.

export type FailureReason = "key_invalid" | "key_not_allowed" | "no_credit" | "model_missing" | "request_refused" | "busy" | "down" | "unreachable" | "unknown";

export const FAILURE_REASONS: FailureReason[] = ["key_invalid", "key_not_allowed", "no_credit", "model_missing", "request_refused", "busy", "down", "unreachable", "unknown"];

const WHY: Record<FailureReason, string> = {
  key_invalid: "Denise can't reach her AI service: the key is invalid.",
  key_not_allowed: "Denise can't reach her AI service: the key isn't allowed to use her AI models.",
  no_credit: "Denise can't reach her AI service: the account it's billed to has run out of credit.",
  model_missing: "Denise can't reach her AI service: the AI model she uses isn't available to this key.",
  request_refused: "Denise's AI service turned down a request from Maestra. That's a fault on our side, and it's logged for us to fix.",
  busy: "Denise's AI service was too busy to answer. It usually clears in a minute or two.",
  down: "Denise's AI service is having problems on its side. It usually comes back on its own.",
  unreachable: "Maestra couldn't connect to Denise's AI service.",
  unknown: "Something unexpected went wrong reaching Denise's AI service, and it's logged for us to fix.",
};

export function failureText(reason: string | null): string {
  return WHY[(reason ?? "unknown") as FailureReason] ?? WHY.unknown;
}

export type Health = { lastOkAt: string | null; lastFailedAt: string | null; lastFailure: string | null };

// Off (no key), unknown (set up, nothing tried yet), working, or not
// working and why: whichever happened last.
export type HealthStatus = { kind: "off" } | { kind: "unknown" } | { kind: "working"; at: string } | { kind: "failing"; at: string; why: string };

export function healthStatus(configured: boolean, h: Health | null): HealthStatus {
  if (!configured) return { kind: "off" };
  const ok = h?.lastOkAt ?? null;
  const failed = h?.lastFailedAt ?? null;
  if (!ok && !failed) return { kind: "unknown" };
  if (failed && (!ok || Date.parse(failed) > Date.parse(ok))) return { kind: "failing", at: failed, why: failureText(h!.lastFailure) };
  return { kind: "working", at: ok! };
}

// Worth checking again: nothing tried in the last hour.
export const CHECK_AFTER_MS = 60 * 60 * 1000;

export function needsCheck(status: HealthStatus, now: number): boolean {
  if (status.kind === "off") return false;
  if (status.kind === "unknown") return true;
  return now - Date.parse(status.at) > CHECK_AFTER_MS;
}
