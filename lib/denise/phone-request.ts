// Denise reads a line the front desk types while a client is on the phone
// ("Maria Lopez, balayage + cut with Bridget next week, afternoons"):
// Claude says only what the line asks for (services and stylist from the
// salon's own lists, by short codes, and when as words: "next week",
// "Tuesday"), in a fixed shape that's checked here. Our code works out the
// dates, finds the client and the times (lib/phone-booking.ts,
// lib/scheduling/phone.ts). The client's name, phone numbers and emails are
// taken out of the line before it's sent. Without her (no key, the daily
// limit, the API failing, or an answer that doesn't check out) the panel
// asks for the same fields instead.

import type Anthropic from "@anthropic-ai/sdk";
import type { When } from "@/lib/phone-booking";
import type { PartOfDay } from "@/lib/scheduling/phone";
import { STAFF_LEVELS, type StaffLevel } from "@/lib/schedule-forms";
import { CHAT_MODEL, type ClaudeClient } from "./claude";

export type PhoneMenu = {
  services: readonly { id: string; name: string; category: string }[];
  stylists: readonly { id: string; firstName: string; level: StaffLevel | null }[];
};

// What the line asks for, before our code works out dates and the client.
export type PhoneParse = {
  sameAsLast: boolean;
  serviceIds: string[];
  staffId: string | null;
  level: StaffLevel | null;
  when: When | null;
  part: PartOfDay | null;
  after: number | null;
  before: number | null;
  earliest: boolean;
};

const WHEN_KINDS = ["soon", "today", "tomorrow", "this_week", "next_week", "weekend", "weekday", "date"] as const;
const PARTS = ["morning", "afternoon", "evening"] as const;

function system(menu: PhoneMenu): string {
  const services = menu.services.map((s, n) => `s${n + 1}: ${s.name} (${s.category})`).join("\n");
  const stylists = menu.stylists.map((s, n) => `t${n + 1}: ${s.firstName}${s.level ? ` (${s.level})` : ""}`).join("\n");
  return `You read one line a salon's front desk typed while a client is on the phone asking for an appointment, and return what it asks for in the given JSON shape. Only what the line says: leave a field null (or false, or empty) when it isn't said, and never work anything out yourself: don't turn "next week" or "Tuesday" into a date. "[client]" stands for the client's name.

service_codes: the services asked for, in the order said, as codes from this menu. "cut" alone is a women's cut unless it says men's, kids or a fade; "color" alone is all-over color; "highlights" alone is full highlights. "same as last time" means same_as_last_time is true and service_codes stays empty unless services are also named.
${services}

stylist_code: the stylist asked for by name, as a code from this list, else null. level: master, senior or artisan when the line asks for a level of stylist ("any master stylist"), else null. "anyone" or "whoever" means both are null.
${stylists}

when: soon (no day said, or "asap", "earliest"), today, tomorrow, this_week, next_week, weekend, weekday (a day of the week: weekday is 1 for Monday to 7 for Sunday, and next is true only when it says "next Tuesday"), or date (a date written as a month and day: month 1-12, day 1-31). part_of_day: morning, afternoon or evening if said. after_hour and before_hour: 0-23 when it says "after 3" (15) or "before noon" (12); a bare number from 1 to 7 means pm. earliest is true when it asks for the earliest or soonest time.`;
}

function schema(menu: PhoneMenu) {
  const serviceCodes = menu.services.map((_, n) => `s${n + 1}`);
  const stylistCodes = menu.stylists.map((_, n) => `t${n + 1}`);
  return {
    type: "object",
    properties: {
      same_as_last_time: { type: "boolean" },
      service_codes: { type: "array", items: { type: "string", enum: serviceCodes } },
      stylist_code: { type: ["string", "null"], enum: [...stylistCodes, null] },
      level: { type: ["string", "null"], enum: [...STAFF_LEVELS, null] },
      when: { type: ["string", "null"], enum: [...WHEN_KINDS, null] },
      weekday: { type: ["integer", "null"] },
      next: { type: "boolean" },
      month: { type: ["integer", "null"] },
      day: { type: ["integer", "null"] },
      part_of_day: { type: ["string", "null"], enum: [...PARTS, null] },
      after_hour: { type: ["integer", "null"] },
      before_hour: { type: ["integer", "null"] },
      earliest: { type: "boolean" },
    },
    required: ["same_as_last_time", "service_codes", "stylist_code", "level", "when", "weekday", "next", "month", "day", "part_of_day", "after_hour", "before_hour", "earliest"],
    additionalProperties: false,
  };
}

const intIn = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
const code = (v: unknown, prefix: string, list: readonly { id: string }[]): string | null | undefined => {
  if (v === null) return null;
  const m = typeof v === "string" ? v.match(new RegExp(`^${prefix}(\\d+)$`)) : null;
  return m ? list[Number(m[1]) - 1]?.id : undefined;
};

// Claude's answer, checked field by field; null if it isn't the shape.
export function checkedParse(raw: unknown, menu: PhoneMenu): PhoneParse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.service_codes)) return null;
  const serviceIds: string[] = [];
  for (const c of r.service_codes.slice(0, 4)) {
    const id = code(c, "s", menu.services);
    if (!id) return null;
    if (!serviceIds.includes(id)) serviceIds.push(id);
  }
  const staffId = code(r.stylist_code, "t", menu.stylists);
  if (staffId === undefined) return null;
  const level = STAFF_LEVELS.find((l) => l === r.level) ?? null;
  const kind = WHEN_KINDS.find((k) => k === r.when) ?? null;
  let when: When | null = null;
  if (kind === "weekday") {
    const weekday = intIn(r.weekday, 1, 7);
    when = weekday ? { kind, weekday, next: r.next === true } : null;
  } else if (kind === "date") {
    const month = intIn(r.month, 1, 12);
    const day = intIn(r.day, 1, 31);
    when = month && day ? { kind, month, day } : null;
  } else if (kind) when = { kind };
  const hour = (v: unknown) => {
    const h = intIn(v, 0, 23);
    return h === null ? null : h * 60;
  };
  return {
    sameAsLast: r.same_as_last_time === true,
    serviceIds,
    staffId,
    level,
    when,
    part: PARTS.find((p) => p === r.part_of_day) ?? null,
    after: hour(r.after_hour),
    before: hour(r.before_hour),
    earliest: r.earliest === true,
  };
}

// The masked line read by Claude, or null when she can't (staff fill in
// the fields instead).
export async function readPhoneRequest(client: ClaudeClient | null, masked: string, menu: PhoneMenu, onError: (error: unknown) => void = () => {}): Promise<PhoneParse | null> {
  if (!client) return null;
  try {
    const response = await client.messages.create(
      {
        model: CHAT_MODEL,
        max_tokens: 600,
        system: system(menu),
        output_config: { effort: "low", format: { type: "json_schema", schema: schema(menu) } },
        messages: [{ role: "user", content: masked.slice(0, 500) }],
      },
      { timeout: 15_000, maxRetries: 1 },
    );
    if (response.stop_reason !== "end_turn") return null;
    const body = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return checkedParse(JSON.parse(body), menu);
  } catch (error) {
    onError(error);
    return null;
  }
}
