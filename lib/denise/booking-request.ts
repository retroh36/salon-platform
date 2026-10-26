// Denise reads a booking request typed in her chat ("Maria Lopez, balayage
// + cut with Bridget next week, afternoons", "earliest balayage with any
// senior next week"), and the follow-ups to one ("anything later?", "what
// about Friday?", "with Bridget instead?"): Claude says only whether the
// line asks for a booking and what it asks for (services and stylist from
// the salon's own lists, by short codes, and when as words: "next week",
// "Tuesday"), in a fixed shape that's checked here. Our code works out the
// dates, finds the client and the times (lib/phone-booking.ts,
// lib/scheduling/phone.ts, ./booking-chat.ts). The client's name, phone
// numbers and emails are taken out of the line before it's sent. When she
// can't read it, the reader says why (`ReadMiss`: offline, today's limit,
// or an answer that doesn't check out) and the chat shows a form for the
// same fields instead, saying so.

import type Anthropic from "@anthropic-ai/sdk";
import type { PhoneRequest, When } from "@/lib/phone-booking";
import type { PartOfDay } from "@/lib/scheduling/phone";
import { STAFF_LEVELS, type StaffLevel } from "@/lib/schedule-forms";
import { formatMinute, weekdayOf } from "@/lib/scheduling/time";
import { CHAT_MODEL, type ClaudeClient } from "./claude";
import { failureKind } from "./errors";

export type BookingMenu = {
  services: readonly { id: string; name: string; category: string }[];
  stylists: readonly { id: string; firstName: string; level: StaffLevel | null }[];
};

// "booking": a new request for an appointment. "change": a follow-up that
// changes the request already on screen. "other": anything else (a
// question for Ask Denise).
export type BookingIntent = "booking" | "change" | "other";

// What the line asks for, before our code works out dates and the client.
// For a change, only what the line changes (the rest is null or empty), with
// anyStylist and anyTime when it drops a stylist or a time of day.
export type BookingParse = {
  intent: BookingIntent;
  sameAsLast: boolean;
  serviceIds: string[];
  staffId: string | null;
  level: StaffLevel | null;
  anyStylist: boolean;
  when: When | null;
  part: PartOfDay | null;
  after: number | null;
  before: number | null;
  anyTime: boolean;
  earliest: boolean;
  // "Anything later?": after the times already shown.
  later: boolean;
};

const WHEN_KINDS = ["soon", "today", "tomorrow", "this_week", "next_week", "weekend", "weekday", "date"] as const;
const PARTS = ["morning", "afternoon", "evening"] as const;
const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// The request on screen, in the same codes Claude answers with.
export function describeCurrent(r: PhoneRequest, menu: BookingMenu): string {
  const code = (prefix: string, list: readonly { id: string }[], id: string) => `${prefix}${list.findIndex((x) => x.id === id) + 1}`;
  const parts = [
    `services ${r.serviceIds.length ? r.serviceIds.map((id) => code("s", menu.services, id)).join(", ") : "none yet"}`,
    r.staffId ? `stylist ${code("t", menu.stylists, r.staffId)}` : r.level ? `any ${r.level} stylist` : "any stylist",
    r.from === r.to ? `on ${WEEKDAYS[weekdayOf(r.from)]}` : "over a range of days",
    r.part ? `${r.part}s` : r.after !== null ? `after ${formatMinute(r.after)}` : r.before !== null ? `before ${formatMinute(r.before)}` : "any time of day",
  ];
  return parts.join("; ");
}

function system(menu: BookingMenu, current: string | null): string {
  const services = menu.services.map((s, n) => `s${n + 1}: ${s.name} (${s.category})`).join("\n");
  const stylists = menu.stylists.map((s, n) => `t${n + 1}: ${s.firstName}${s.level ? ` (${s.level})` : ""}`).join("\n");
  return `You read one line a salon's front desk typed to their assistant, and return what it asks for in the given JSON shape. Only what the line says: leave a field null (or false, or empty) when it isn't said, and never work anything out yourself: don't turn "next week" or "Tuesday" into a date. "[client]" stands for a client's name.

intent: booking when the line asks to book a client or find a time to book (a client and a service, "same as last time", "earliest balayage with any senior next week", "Zoey wants a cut Thursday"). ${
    current
      ? `change when it changes the booking request already on screen (${current}): "anything later?", "what about Friday?", "with Bridget instead?", "mornings only", "make it a gloss". For a change, give only what the line changes and leave the rest null or empty; any_stylist is true when it drops the stylist ("anyone is fine"), any_time when it drops the time of day; later is true for "anything later?" or "later than that".`
      : "change never applies: there's no request on screen."
  } other for anything else: questions about clients, stylists, how long things take, sales, stock, how to use the app, or who is free ("Who's free for a color at 3?" is other).

service_codes: the services asked for, in the order said, as codes from this menu. "cut" alone is a women's cut unless it says men's, kids or a fade; "color" alone is all-over color; "highlights" alone is full highlights. "same as last time" means same_as_last_time is true and service_codes stays empty unless services are also named.
${services}

stylist_code: the stylist asked for by name, as a code from this list, else null. level: master, senior or artisan when the line asks for a level of stylist ("any master stylist"), else null. "anyone" or "whoever" means both are null.
${stylists}

when: soon (no day said, or "asap", "earliest"), today, tomorrow, this_week, next_week, weekend, weekday (a day of the week: weekday is 1 for Monday to 7 for Sunday, and next is true only when it says "next Tuesday"), or date (a date written as a month and day: month 1-12, day 1-31). part_of_day: morning, afternoon or evening if said. after_hour and before_hour: 0-23 when it says "after 3" (15) or "before noon" (12); a bare number from 1 to 7 means pm. earliest is true when it asks for the earliest or soonest time.`;
}

// A value from a list, or null. The API wants null as its own branch: an
// enum can't hold null alongside the strings.
const oneOrNull = (values: readonly string[]) => (values.length ? { anyOf: [{ type: "string", enum: [...values] }, { type: "null" }] } : { type: "null" });
const intOrNull = { anyOf: [{ type: "integer" }, { type: "null" }] };

export function schema(menu: BookingMenu) {
  const serviceCodes = menu.services.map((_, n) => `s${n + 1}`);
  const stylistCodes = menu.stylists.map((_, n) => `t${n + 1}`);
  return {
    type: "object",
    properties: {
      intent: { type: "string", enum: ["booking", "change", "other"] },
      same_as_last_time: { type: "boolean" },
      service_codes: { type: "array", items: { type: "string", enum: serviceCodes } },
      stylist_code: oneOrNull(stylistCodes),
      level: oneOrNull(STAFF_LEVELS),
      any_stylist: { type: "boolean" },
      when: oneOrNull(WHEN_KINDS),
      weekday: intOrNull,
      next: { type: "boolean" },
      month: intOrNull,
      day: intOrNull,
      part_of_day: oneOrNull(PARTS),
      after_hour: intOrNull,
      before_hour: intOrNull,
      any_time: { type: "boolean" },
      earliest: { type: "boolean" },
      later: { type: "boolean" },
    },
    required: [
      "intent",
      "same_as_last_time",
      "service_codes",
      "stylist_code",
      "level",
      "any_stylist",
      "when",
      "weekday",
      "next",
      "month",
      "day",
      "part_of_day",
      "after_hour",
      "before_hour",
      "any_time",
      "earliest",
      "later",
    ],
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
export function checkedParse(raw: unknown, menu: BookingMenu): BookingParse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.service_codes)) return null;
  const intent = (["booking", "change", "other"] as const).find((i) => i === r.intent);
  if (!intent) return null;
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
    intent,
    sameAsLast: r.same_as_last_time === true,
    serviceIds,
    staffId,
    level,
    anyStylist: r.any_stylist === true,
    when,
    part: PARTS.find((p) => p === r.part_of_day) ?? null,
    after: hour(r.after_hour),
    before: hour(r.before_hour),
    anyTime: r.any_time === true,
    earliest: r.earliest === true,
    later: r.later === true,
  };
}

// Why she couldn't read a line: no connection to Claude (no key, the API
// failing), the salon's daily limit, or an answer that doesn't check out.
export type ReadMiss = { missed: "offline" | "limit" | "unclear" };
export const isMiss = (r: BookingParse | ReadMiss): r is ReadMiss => "missed" in r;

// The masked line read by Claude, or why she couldn't (staff fill in the
// form instead). `current` is the request on screen, for follow-ups.
export async function readBookingRequest(
  client: ClaudeClient | null,
  masked: string,
  menu: BookingMenu,
  current: PhoneRequest | null = null,
  onError: (error: unknown) => void = () => {},
): Promise<BookingParse | ReadMiss> {
  if (!client) return { missed: "offline" };
  let response: Anthropic.Message;
  try {
    response = await client.messages.create(
      {
        model: CHAT_MODEL,
        max_tokens: 600,
        system: system(menu, current ? describeCurrent(current, menu) : null),
        output_config: { effort: "low", format: { type: "json_schema", schema: schema(menu) } },
        messages: [{ role: "user", content: masked.slice(0, 500) }],
      },
      { timeout: 15_000, maxRetries: 1 },
    );
  } catch (error) {
    if (failureKind(error) === "limit") return { missed: "limit" };
    onError(error);
    return { missed: "offline" };
  }
  if (response.stop_reason !== "end_turn") return { missed: "unclear" };
  const body = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { missed: "unclear" };
  }
  const parse = checkedParse(raw, menu);
  if (!parse) return { missed: "unclear" };
  // A change needs something on screen to change.
  return parse.intent === "change" && !current ? { ...parse, intent: "booking" } : parse;
}
