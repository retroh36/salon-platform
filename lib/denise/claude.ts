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
// phone numbers, emails, addresses, allergies, notes or payment details.
// Every number comes from our code (lib/insights/, the tools); Claude
// decides what matters and says it. The API key is never logged.
//
// Every call goes through a metered client (./usage.ts) that logs tokens
// per salon and stops at the salon's daily limit; callers fall back to
// template wording then, or when the API is unreachable.

import Anthropic from "@anthropic-ai/sdk";
import type { BriefFacts } from "./brief";
import type { FixFacts } from "./scan";

// A fast model for chat and short explanations.
export const CHAT_MODEL = "claude-haiku-5-5";
// A stronger one for the morning brief and "why" questions.
export const ANALYSIS_MODEL = "claude-sonnet-5-5";

// The one SDK call Denise makes (tests and the meter stand in for it).
export type ClaudeClient = {
  messages: { create: (params: Anthropic.MessageCreateParamsNonStreaming, options?: Anthropic.RequestOptions) => Promise<Anthropic.Message> };
};

// Questions that ask for reasons or comparisons get the stronger model.
export function modelFor(question: string): string {
  return /\b(why|how come|explain|compare|trend|pattern|analy[sz]e|what's behind|reason)/i.test(question) ? ANALYSIS_MODEL : CHAT_MODEL;
}

// Haiku thinks little; Sonnet a bit more for analysis.
const effortFor = (model: string) => (model === ANALYSIS_MODEL ? "medium" : "low") as "low" | "medium";

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
  "You are Denise (short for DNIS, Digital Navigator of Issues and Scheduling), the scheduling assistant inside a hair salon's front-desk app. You speak to salon staff, never to clients. Speak in the first person, briefly and warmly, in plain English. Plain text only: no markdown, no ** or other asterisks (not even in lists) and no headings; a short list with dashes is fine. Don't assume anyone's gender, stylists included: use their name or \"they\" and \"their\" (\"Bridget's balayage\", \"their visits\"), never he, she, him, his or her. Say dates like \"Wed, Nov 4\", not 2026-11-04.";

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

const MAX_STEPS = 8;

// One answer to a staff question, letting Claude call tools along the way.
export async function converse(
  client: ClaudeClient,
  system: string,
  history: { role: "user" | "assistant"; text: string }[],
  runner: ToolRunner,
  model = CHAT_MODEL,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.text }));
  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.messages.create(
      { model, max_tokens: 3000, system, tools: runner.tools, output_config: { effort: effortFor(model) }, messages },
      model === ANALYSIS_MODEL ? { ...REQUEST, timeout: 45_000 } : REQUEST,
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

const BRIEF_SYSTEM = `${VOICE}

Write today's morning brief for the front desk from the facts given, which our scheduling system worked out. Two to four short sentences: what matters most first (risks to the day, clients who might not show, regulars to call back), then anything else worth a moment. Use only the facts and numbers given; don't add, estimate or calculate others. Name clients by first name only. You can't contact clients: suggest what staff might do, and never draft messages to clients.`;

// The brief in Denise's words, from the facts only (first names). Null if
// it couldn't be written.
export async function writeBrief(client: ClaudeClient, facts: BriefFacts): Promise<string | null> {
  const response = await client.messages.create(
    {
      model: ANALYSIS_MODEL,
      max_tokens: 1500,
      system: BRIEF_SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", properties: { brief: { type: "string" } }, required: ["brief"], additionalProperties: false } } },
      messages: [{ role: "user", content: JSON.stringify(firstNamesOnly(facts)) }],
    },
    { ...REQUEST, timeout: 30_000 },
  );
  if (response.stop_reason !== "end_turn") return null;
  try {
    const text = (JSON.parse(textOf(response.content)) as { brief?: unknown }).brief;
    return typeof text === "string" && text.trim() ? text.trim().slice(0, 1200) : null;
  } catch {
    return null;
  }
}

// "Emma S." -> "Emma": Claude gets first names only.
export function firstNamesOnly(f: BriefFacts): BriefFacts {
  const first = (name: string) => name.split(" ")[0];
  return {
    ...f,
    likelyNoShows: f.likelyNoShows.map((n) => ({ ...n, client: first(n.client) })),
    dueNotBooked: { ...f.dueNotBooked, top: f.dueNotBooked.top.map((d) => ({ ...d, client: first(d.client) })) },
  };
}
