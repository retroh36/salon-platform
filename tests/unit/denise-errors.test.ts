// When Denise fails. First the bug behind "How do I ring up a gift card?"
// getting "Something went wrong on my end": the meter called the SDK's
// stream() detached from its object, so every streamed Ask Denise answer
// failed with "Cannot read properties of undefined (reading '_client')".
// These use the real SDK with a stand-in for the network (no API calls).
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_MODEL, converse } from "@/lib/denise/claude";
import { FAILURE_TEXT, failureDetails, failureKind, failureReason } from "@/lib/denise/errors";
import { FAILURE_REASONS, failureText, healthStatus, needsCheck } from "@/lib/denise/health";
import { DailyLimitReached, metered } from "@/lib/denise/usage";

afterEach(() => vi.restoreAllMocks());

const sse = (events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");

// A streamed reply of one text, as the API sends it.
function streamed(text: string) {
  return sse([
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: CHAT_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 6 } },
    { type: "message_stop" },
  ]);
}

// The real SDK client, its requests answered by `respond`.
function sdk(respond: () => Response) {
  const fetch = vi.fn(async () => respond());
  return { client: new Anthropic({ apiKey: "test-key-not-real", fetch: fetch as never, maxRetries: 0 }), fetch };
}

function admin() {
  const rpc = vi.fn(async (name: string) => (name === "ai_usage_today" ? { data: [{ used: 0, daily_limit: 100_000 }], error: null } : { data: null, error: null }));
  return { admin: { rpc } as never, rpc };
}

describe("a streamed answer through the meter (the gift card question)", () => {
  it("reaches the SDK and comes back word by word, with its usage logged", async () => {
    const { client, fetch } = sdk(() => new Response(streamed("Here's how to sell one."), { headers: { "content-type": "text/event-stream" } }));
    const { admin: a, rpc } = admin();
    const pieces: string[] = [];
    const text = await converse(metered(client, a, "biz", "ask_denise"), "system", [{ role: "user", text: "How do I ring up a gift card" }], { tools: [], run: async () => "" }, CHAT_MODEL, {
      onText: (t) => pieces.push(t),
    });
    expect(text).toBe("Here's how to sell one.");
    expect(pieces).toEqual(["Here's how to sell one."]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_ai_usage", expect.objectContaining({ p_feature: "ask_denise", p_input: 12, p_output: 6 }));
  });
});

describe("what kind of failure", () => {
  const apiError = (status: number, type: string) => Anthropic.APIError.generate(status, { type: "error", error: { type, message: "x" } }, undefined, new Headers({ "request-id": "req_42" }));

  it("tells a limit, a busy API, a setup problem and our own bug apart", () => {
    expect(failureKind(new DailyLimitReached())).toBe("limit");
    expect(failureKind(apiError(429, "rate_limit_error"))).toBe("busy");
    expect(failureKind(apiError(529, "overloaded_error"))).toBe("busy");
    expect(failureKind(apiError(500, "api_error"))).toBe("busy");
    expect(failureKind(new Anthropic.APIConnectionTimeoutError())).toBe("busy");
    expect(failureKind(new Anthropic.APIConnectionError({ message: "offline" }))).toBe("busy");
    expect(failureKind(apiError(401, "authentication_error"))).toBe("setup");
    expect(failureKind(apiError(400, "invalid_request_error"))).toBe("setup");
    expect(failureKind(apiError(400, "billing_error"))).toBe("setup");
    expect(failureKind(new TypeError("Cannot read properties of undefined (reading '_client')"))).toBe("bug");
  });

  it("logs enough to diagnose: status, the API's error type and request id, and where in our code", async () => {
    const { client } = sdk(() => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529, headers: { "request-id": "req_77", "content-type": "application/json" } }));
    const error = await client.messages.create({ model: CHAT_MODEL, max_tokens: 10, messages: [{ role: "user", content: "hi" }] }).catch((e) => e);
    const details = failureDetails(error, { where: "ask", businessId: "biz", ref: "D-ABC123" });
    expect(details).toMatchObject({ where: "ask", businessId: "biz", ref: "D-ABC123", kind: "busy", status: 529, apiType: "overloaded_error", requestId: "req_77" });
    expect(String(details.stack)).not.toBe("");
  });

  it("says something useful for each", () => {
    expect(FAILURE_TEXT.limit).toMatch(/today's thinking.*tomorrow/);
    expect(FAILURE_TEXT.busy).toMatch(/minute and ask again/);
    expect(FAILURE_TEXT.setup).toMatch(/logged it/);
    expect(FAILURE_TEXT.bug).toMatch(/^Something went wrong on my end, and I've logged it/);
  });
});

// Settings said "Connected: Yes" with a key set, whatever happened to her
// calls (on the demo every owner's question was refused). Now the meter
// keeps each call's outcome and Settings words the latest one.
describe("whether Denise is really working", () => {
  const apiError = (status: number, type: string) => Anthropic.APIError.generate(status, { type: "error", error: { type, message: "x" } }, undefined, new Headers());

  it("names why a call failed, in a code Settings can word", () => {
    expect(failureReason(apiError(401, "authentication_error"))).toBe("key_invalid");
    expect(failureReason(apiError(403, "permission_error"))).toBe("key_not_allowed");
    expect(failureReason(apiError(400, "billing_error"))).toBe("no_credit");
    expect(failureReason(apiError(404, "not_found_error"))).toBe("model_missing");
    expect(failureReason(apiError(400, "invalid_request_error"))).toBe("request_refused");
    expect(failureReason(apiError(429, "rate_limit_error"))).toBe("busy");
    expect(failureReason(apiError(529, "overloaded_error"))).toBe("busy");
    expect(failureReason(apiError(500, "api_error"))).toBe("down");
    expect(failureReason(new Anthropic.APIConnectionTimeoutError())).toBe("unreachable");
    // Stopped by us when the person left: not a failure.
    expect(failureReason(new Anthropic.APIUserAbortError())).toBeNull();
    expect(failureText("key_invalid")).toBe("Denise can't reach her AI service: the key is invalid.");
    for (const r of FAILURE_REASONS) expect(failureText(r)).not.toMatch(/Claude|API|Anthropic/);
  });

  it("is working only when the latest call worked", () => {
    expect(healthStatus(false, null)).toEqual({ kind: "off" });
    expect(healthStatus(true, null)).toEqual({ kind: "unknown" });
    const ok = "2026-11-02T01:48:21.000+00:00";
    const failed = "2026-11-02T01:49:39.000+00:00";
    expect(healthStatus(true, { lastOkAt: ok, lastFailedAt: failed, lastFailure: "request_refused" })).toMatchObject({ kind: "failing", why: expect.stringContaining("turned down a request") });
    expect(healthStatus(true, { lastOkAt: failed, lastFailedAt: ok, lastFailure: "busy" })).toEqual({ kind: "working", at: failed });
    // Checked again on opening Settings after an hour with nothing tried.
    expect(needsCheck({ kind: "unknown" }, Date.parse(ok))).toBe(true);
    expect(needsCheck({ kind: "working", at: ok }, Date.parse(ok) + 30 * 60_000)).toBe(false);
    expect(needsCheck({ kind: "working", at: ok }, Date.parse(ok) + 61 * 60_000)).toBe(true);
    expect(needsCheck({ kind: "off" }, Date.parse(ok))).toBe(false);
  });

  it("records a refused call as failed, with why, and still throws it to the caller", async () => {
    const { client } = sdk(() => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Too many strict tools (22)." } }), { status: 400, headers: { "content-type": "application/json" } }));
    const { admin: a, rpc } = admin();
    const m = metered(client, a, "biz", "ask_denise");
    await expect(m.messages.create({ model: CHAT_MODEL, max_tokens: 10, messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect(rpc).toHaveBeenCalledWith("record_ai_failure", { p_business_id: "biz", p_model: CHAT_MODEL, p_feature: "ask_denise", p_reason: "request_refused" });
    expect(rpc).not.toHaveBeenCalledWith("record_ai_usage", expect.anything());
    // The same for a streamed answer.
    rpc.mockClear();
    const stream = m.messages.stream!({ model: CHAT_MODEL, max_tokens: 10, messages: [{ role: "user", content: "hi" }] });
    await expect((async () => { for await (const _ of stream) void _; })()).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect(rpc).toHaveBeenCalledWith("record_ai_failure", expect.objectContaining({ p_reason: "request_refused" }));
  });
});
