// Denise reads a one-line event description ("June 14 wedding, ready by
// 2pm, bride plus 5 bridesmaids hair and makeup, at the Grand Hotel"):
// Claude says only what the line says (the date as said, the ready-by time,
// where, who and what each wants), in a fixed shape that's checked here;
// our code then works out the date, packages, timeline, team and price
// (lib/events/describe.ts, the builder). Without her (no key, the daily
// limit, the API failing or an answer that doesn't check out) the same
// shape comes from parseDescription. Contact details are taken out of the
// line before it's sent. Nothing is saved: the draft fills the builder.

import type Anthropic from "@anthropic-ai/sdk";
import { parseDescription, type EventDescription, type ServiceWanted } from "@/lib/events/describe";
import { PARTY_ROLES, type PartyRole } from "@/lib/events/types";
import { CHAT_MODEL, type ClaudeClient } from "./claude";

const SYSTEM = `You read one line a salon's front desk typed about a wedding or other event they're planning hair and makeup for, and return what it says in the given JSON shape. Only what the line says: leave a field null when it isn't said, never guess or work anything out (don't turn "next Saturday" into a date: leave the date null). month is 1-12 and day 1-31 as written; year only if written. ready_hour is 0-23 (2pm is 14), for the time everyone must be ready by. venue is the place named after "at", without the word "at"; in_salon is true only if it says it's at the salon. kind is one word such as wedding, prom, engagement, shoot or party. name is a family or first name the event is called by ("the Rossi wedding" is Rossi), else null. groups lists who is in the party in the order said, with how many and what they want: hair, makeup or hair_makeup (null if not said). party_role is one of: ${PARTY_ROLES.join(", ")} (mother covers mother of the bride or groom; guest covers anyone else).`;

const SCHEMA = {
  type: "object",
  properties: {
    month: { type: ["integer", "null"] },
    day: { type: ["integer", "null"] },
    year: { type: ["integer", "null"] },
    ready_hour: { type: ["integer", "null"] },
    ready_minute: { type: ["integer", "null"] },
    venue: { type: ["string", "null"] },
    in_salon: { type: "boolean" },
    kind: { type: ["string", "null"] },
    name: { type: ["string", "null"] },
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          party_role: { type: "string", enum: PARTY_ROLES },
          count: { type: "integer" },
          services: { type: ["string", "null"], enum: ["hair", "makeup", "hair_makeup", null] },
        },
        required: ["party_role", "count", "services"],
        additionalProperties: false,
      },
    },
  },
  required: ["month", "day", "year", "ready_hour", "ready_minute", "venue", "in_salon", "kind", "name", "groups"],
  additionalProperties: false,
} as const;

// Phone numbers and emails never go to Claude.
export function withoutContacts(line: string): string {
  return line
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\+?\(?\d[\d\s().-]{7,}\d/g, "[phone]")
    .slice(0, 500);
}

const intIn = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// Claude's answer, checked field by field; null if it isn't the shape.
export function checkedDescription(raw: unknown): EventDescription | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.groups)) return null;
  const groups: EventDescription["groups"] = [];
  for (const g of r.groups) {
    const x = g as Record<string, unknown>;
    const role = PARTY_ROLES.find((p) => p === x?.party_role);
    const count = intIn(x?.count, 1, 30);
    if (!role || !count) return null;
    const services = (["hair", "makeup", "hair_makeup"] as const).find((s) => s === x.services) ?? null;
    groups.push({ partyRole: role as PartyRole, count, services: services as ServiceWanted | null });
  }
  return {
    month: intIn(r.month, 1, 12),
    day: intIn(r.day, 1, 31),
    year: intIn(r.year, 2000, 2100),
    readyHour: intIn(r.ready_hour, 0, 23),
    readyMinute: r.ready_hour == null ? null : (intIn(r.ready_minute, 0, 59) ?? 0),
    venue: text(r.venue, 200),
    inSalon: r.in_salon === true,
    kind: text(r.kind, 30)?.toLowerCase() ?? null,
    name: text(r.name, 40),
    groups,
  };
}

export type Described = { description: EventDescription; by: "denise" | "parser" };

export async function describeEvent(client: ClaudeClient | null, line: string, onError: (error: unknown) => void = () => {}): Promise<Described> {
  const fallback = (): Described => ({ description: parseDescription(line), by: "parser" });
  if (!client) return fallback();
  try {
    const response = await client.messages.create(
      {
        model: CHAT_MODEL,
        max_tokens: 1000,
        system: SYSTEM,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
        messages: [{ role: "user", content: withoutContacts(line) }],
      },
      { timeout: 15_000, maxRetries: 1 },
    );
    if (response.stop_reason !== "end_turn") return fallback();
    const body = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const described = checkedDescription(JSON.parse(body));
    // An answer with nobody in the party is no help: read it ourselves.
    return described && described.groups.length ? { description: described, by: "denise" } : fallback();
  } catch (error) {
    onError(error);
    return fallback();
  }
}
