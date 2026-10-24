// When Denise fails: what kind of failure it was, what she tells staff, and
// what's logged to diagnose it. Logs carry the error's own details (name,
// status, the API's error type and request id, where in our code) and what
// she was doing, never the question, client names or the API key. Pure,
// apart from logDeniseError writing to the server log.

import Anthropic from "@anthropic-ai/sdk";
import { DailyLimitReached } from "./usage";

// limit: the salon's daily allowance is used up. busy: the API is rate
// limiting, overloaded, down or unreachable for now (worth trying again).
// setup: the key, account or a request we built is wrong (needs us).
// bug: anything else, in our own code.
export type FailureKind = "limit" | "busy" | "setup" | "bug";

export function failureKind(error: unknown): FailureKind {
  if (error instanceof DailyLimitReached) return "limit";
  if (error instanceof Anthropic.APIConnectionError) return "busy"; // includes timeouts
  if (error instanceof Anthropic.APIError) {
    const type = apiErrorType(error);
    if (type === "billing_error") return "setup";
    if (error.status === 429 || error.status === 529 || type === "overloaded_error" || type === "rate_limit_error" || (error.status ?? 0) >= 500) return "busy";
    return "setup";
  }
  return "bug";
}

function apiErrorType(error: InstanceType<typeof Anthropic.APIError>): string | null {
  const body = error.error as { error?: { type?: unknown }; type?: unknown } | undefined;
  const type = body?.error?.type ?? body?.type;
  return typeof type === "string" ? type : null;
}

export const FAILURE_TEXT: Record<FailureKind, string> = {
  limit: "I've used up today's thinking for the salon, so I'll be back for questions tomorrow. I'm still watching the calendar for clashes in the meantime.",
  busy: "I'm swamped right now and couldn't get an answer through. Give it a minute and ask again. The calendar works as normal in the meantime.",
  setup: "I can't think straight right now: something in how I'm connected needs fixing on our side. I've logged it for the team. The calendar works as normal in the meantime.",
  bug: "Something went wrong on my end, and I've logged it so it can be fixed. Anything you changed is saved; try again in a moment.",
};

// A short code staff can quote, matching the log line.
export function failureRef(): string {
  return `D-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export type FailureContext = {
  // What she was doing: "ask", "report_late", "explain_fixes", "tool:find_openings"…
  where: string;
  businessId?: string;
  model?: string;
  ref?: string;
};

// Everything worth knowing about an error, without anything from the request.
export function failureDetails(error: unknown, context: FailureContext): Record<string, unknown> {
  const e = error instanceof Error ? error : null;
  const details: Record<string, unknown> = {
    ...context,
    kind: failureKind(error),
    name: e?.name ?? typeof error,
    message: (e?.message ?? String(error)).slice(0, 500),
  };
  if (error instanceof Anthropic.APIError) {
    details.status = error.status ?? null;
    details.apiType = apiErrorType(error);
    details.requestId = error.requestID ?? null;
  }
  // Our own frames first: where it broke.
  if (e?.stack) details.stack = e.stack.split("\n").slice(1, 8).map((l) => l.trim()).join(" | ");
  const cause = (e as { cause?: unknown } | null)?.cause;
  if (cause instanceof Error) details.cause = `${cause.name}: ${cause.message}`.slice(0, 300);
  return details;
}

export function logDeniseError(error: unknown, context: FailureContext): FailureKind {
  const details = failureDetails(error, context);
  // A daily limit is expected, not a fault.
  if (details.kind === "limit") console.warn("[denise]", JSON.stringify(details));
  else console.error("[denise]", JSON.stringify(details));
  return details.kind as FailureKind;
}
