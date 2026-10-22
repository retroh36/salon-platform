// Denise's brain: the Claude API, used server-side only when
// ANTHROPIC_API_KEY is set. Without it Denise uses template wording and
// "Ask Denise" says she isn't connected.
//
// Claude never touches the database. It writes explanations of fixes the
// resolver already checked, and answers questions through tools
// (./assistant.ts) that call our scheduling functions; a booking it
// suggests is checked against the booking rules and recorded as a proposal
// for staff to approve.
//
// Privacy: Claude gets first names and scheduling facts only: never client
// phone numbers, emails, allergies or notes. The API key is never logged.

import Anthropic from "@anthropic-ai/sdk";
import type { FixFacts } from "./scan";

// A fast model for chat and short explanations.
export const CHAT_MODEL = "claude-haiku-5-5";

// The part of the SDK client Denise uses (tests pass a fake).
export type ClaudeClient = Pick<Anthropic, "messages">;

export function isConnected(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// A client, or null when Denise isn't connected.
export function claudeClient(): ClaudeClient | null {
  return isConnected() ? new Anthropic() : null;
}

// Keeps the calendar responsive if the API is slow.
const REQUEST = { timeout: 15_000, maxRetries: 1 };

export const VOICE =
  "You are Denise (short for DNIS, Digital Navigator of Issues and Scheduling), the scheduling assistant inside a hair salon's front-desk app. You speak to salon staff, never to clients. Speak in the first person, briefly and warmly, in plain English with no markdown.";

const EXPLAIN_SYSTEM = `${VOICE}

You'll get a list of schedule fixes the salon's scheduler has already worked out and checked. For each one, write one or two short sentences explaining to the front desk why it works, from the facts given: who moves where and why that's the least disruption. Don't invent facts, don't promise anything to clients, and don't repeat the problem word for word. Return one explanation per fix, in order.`;

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// Plain-English explanations for fixes, one per fact sheet (null where it
// couldn't). Used as the scan's Explainer.
export async function explainFixes(client: ClaudeClient, facts: FixFacts[]): Promise<(string | null)[]> {
  const response = await client.messages.create(
    {
      model: CHAT_MODEL,
      max_tokens: 2000,
      system: EXPLAIN_SYSTEM,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { explanations: { type: "array", items: { type: "string" } } },
            required: ["explanations"],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: "user", content: JSON.stringify({ fixes: facts }) }],
    },
    REQUEST,
  );
  if (response.stop_reason !== "end_turn") return facts.map(() => null);
  let parsed: { explanations?: unknown };
  try {
    parsed = JSON.parse(textOf(response.content));
  } catch {
    return facts.map(() => null);
  }
  const list = Array.isArray(parsed.explanations) ? parsed.explanations : [];
  return facts.map((_, i) => {
    const text = list[i];
    return typeof text === "string" && text.trim() ? text.trim().slice(0, 500) : null;
  });
}

export type ToolRunner = {
  tools: Anthropic.Tool[];
  run: (name: string, input: unknown) => Promise<string>;
};

const MAX_STEPS = 6;

// One answer to a staff question, letting Claude call tools along the way.
export async function converse(
  client: ClaudeClient,
  system: string,
  history: { role: "user" | "assistant"; text: string }[],
  runner: ToolRunner,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.text }));
  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.messages.create(
      { model: CHAT_MODEL, max_tokens: 2000, system, tools: runner.tools, output_config: { effort: "low" }, messages },
      REQUEST,
    );
    if (response.stop_reason === "refusal") return "I can't help with that one, sorry.";
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason !== "tool_use") return textOf(response.content) || "I'm not sure what to say to that one.";

    // Run every tool call, and send all the results back together.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      try {
        results.push({ type: "tool_result", tool_use_id: block.id, content: await runner.run(block.name, block.input) });
      } catch {
        results.push({ type: "tool_result", tool_use_id: block.id, content: "That didn't work.", is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return "That took me more steps than I expected. Could you ask in a simpler way?";
}
