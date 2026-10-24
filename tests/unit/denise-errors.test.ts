// When Denise fails. First the bug behind "How do I ring up a gift card?"
// getting "Something went wrong on my end": the meter called the SDK's
// stream() detached from its object, so every streamed Ask Denise answer
// failed with "Cannot read properties of undefined (reading '_client')".
// These use the real SDK with a stand-in for the network (no API calls).
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_MODEL, converse } from "@/lib/denise/claude";
import { FAILURE_TEXT, failureDetails, failureKind } from "@/lib/denise/errors";
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
