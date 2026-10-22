// "Ask Denise": the tools Claude gets for answering staff questions, and
// what they do. Each tool calls our functions; none writes to the calendar.
// Facts come from our code (the booking rules, lib/insights/ through
// ./knowledge.ts); Claude reads them, decides what matters and says it.
// propose_booking checks the booking rules and records a proposal in the
// AI action log, which staff approve (choosing the client) in Denise's
// panel; propose_fixes runs her conflict and risk check, recording fixes
// the same way.
//
// Clients appear by first name only (no contact details, allergies or
// notes), and what each tool returns depends on who's asking (./knowledge.ts).

import type Anthropic from "@anthropic-ai/sdk";
import { checkAppointment, describeProblem, pickResource, timingFor, type BookingContext } from "@/lib/scheduling/booking";
import { findOpenings } from "@/lib/scheduling/openings";
import { formatMinute, fromLocal, isLocalDate, parseTime, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { converse, modelFor, VOICE, type ClaudeClient, type ToolRunner } from "./claude";
import { SALES_PERIODS, type Knowledge, type SalesPeriod } from "./knowledge";
import type { BookingSuggestion } from "./types";

export type AssistantContext = {
  salon: string;
  timeZone: string;
  today: LocalDate;
  // The day on the calendar when the question was asked.
  date: LocalDate;
  now: Date;
  services: { id: string; name: string; category: string; minutes: number }[];
  staff: { id: string; firstName: string; title: string }[];
  // The calendar for a day, for checking times.
  calendar: (date: LocalDate) => Promise<BookingContext>;
  // Records a suggested booking for staff to approve; its action id, or
  // null when the person asking can't approve bookings.
  propose: (booking: { summary: string; reason: string; serviceId: string; staffId: string; resourceId: string | null; start: Date }) => Promise<string | null>;
  // Who's asking ("front desk", "stylist"…) and their first name, and what
  // they may look up.
  asker?: string;
  askerName?: string;
  knowledge?: Knowledge;
};

// "haircuts" -> "cut", "colour" -> "color".
const SYNONYMS: Record<string, string> = { haircut: "cut", hair: "", colour: "color", dye: "color", highlight: "highlight", blowdry: "blowout", the: "", a: "", with: "" };
function stem(word: string): string {
  const w = word.replace(/s$/, "");
  return SYNONYMS[w] ?? w;
}

const nullable = (type: "string" | "integer") => ({ type: [type, "null"] });

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_services",
    description: "Search the salon's menu. Returns matching services with their id, category and length in minutes. Use it to find the service_id for other tools.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { query: { ...nullable("string"), description: "Words to match, e.g. 'haircut' or 'color'. Null for the whole menu." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_stylists",
    description: "The stylists at this salon with their id, first name and level.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "find_openings",
    description:
      "Search availability: free times for one service on one day, checked against every booking rule (stylist hours, time off, other clients, processing gaps, free chairs). Returns up to `limit` options, earliest first.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        service_id: { type: "string" },
        date: { ...nullable("string"), description: "YYYY-MM-DD. Null for the day on the calendar." },
        staff_id: { ...nullable("string"), description: "Only this stylist. Null for anyone who offers the service." },
        after: { ...nullable("string"), description: "Earliest start, 24-hour HH:MM local time, e.g. '13:00'." },
        before: { ...nullable("string"), description: "Latest start, 24-hour HH:MM." },
        limit: { ...nullable("integer"), description: "How many options (1-10, default 5)." },
      },
      required: ["service_id", "date", "staff_id", "after", "before", "limit"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_booking",
    description:
      "Suggest booking a service with a stylist at a time. It's checked against the booking rules and shown to staff as a suggestion to approve; it does not book anything by itself. Use only times you got from find_openings.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        service_id: { type: "string" },
        staff_id: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        start: { type: "string", description: "24-hour HH:MM local time" },
        client_first_name: { ...nullable("string"), description: "The client's first name if staff mentioned one, so they can pick the client. Null otherwise." },
      },
      required: ["service_id", "staff_id", "date", "start", "client_first_name"],
      additionalProperties: false,
    },
  },
];

const noInput = { type: "object" as const, properties: {}, required: [], additionalProperties: false as const };

// Read-only lookups of what Denise has learned, and her fixes.
const KNOWLEDGE_TOOLS: Record<"clients" | "overdue" | "durations" | "salon" | "schedule" | "stock" | "sales" | "fixes", Anthropic.Tool> = {
  clients: {
    name: "client_insights",
    description:
      "A client's habits, by first name: how often they come (usual gap), when they're next due or booked, their usual stylist, day, time and services, how often they're late, cancel or don't show, and churn risk (spend only for owners, managers and front desk). Several clients may share a first name.",
    strict: true,
    input_schema: { type: "object", properties: { first_name: { type: "string" } }, required: ["first_name"], additionalProperties: false },
  },
  overdue: {
    name: "overdue_clients",
    description: "Regulars who are due back or overdue and have nothing booked, most overdue first, with the total.",
    strict: true,
    input_schema: { type: "object", properties: { limit: { ...nullable("integer"), description: "How many to list (1-20, default 10)." } }, required: ["limit"], additionalProperties: false },
  },
  durations: {
    name: "stylist_durations",
    description:
      "How long stylists really take for services, from actual start and finish times: typical (median) minutes, the middle half, visits counted, consistency, trend, menu and booked minutes, how often it ran over, and any suggested length. Only trusted from 5 visits.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { staff_id: { ...nullable("string"), description: "One stylist, or null for all." }, service_id: { ...nullable("string"), description: "One service, or null for all." } },
      required: ["staff_id", "service_id"],
      additionalProperties: false,
    },
  },
  salon: {
    name: "salon_patterns",
    description: "The salon's patterns: busiest and quietest hours, which days and services run over (and who runs over most), no-shows by day and time of day, and rebooking rates by stylist.",
    strict: true,
    input_schema: noInput,
  },
  schedule: {
    name: "day_schedule",
    description: "A day's visits: times, stylist, client first name, service, status, booked minutes, and how long that stylist usually takes for it.",
    strict: true,
    input_schema: { type: "object", properties: { date: { ...nullable("string"), description: "YYYY-MM-DD. Null for the day on the calendar." } }, required: ["date"], additionalProperties: false },
  },
  stock: {
    name: "inventory_levels",
    description: "Products in stock: on hand, reorder point and whether it's low. With no query, only low products.",
    strict: true,
    input_schema: { type: "object", properties: { query: { ...nullable("string"), description: "Words in the product name, e.g. 'olaplex' or '7N'." } }, required: ["query"], additionalProperties: false },
  },
  sales: {
    name: "sales_summary",
    description: "Simple sales figures for a period: services and retail in dollars, visits checked out, average visit and no-shows, with the period before for comparison.",
    strict: true,
    input_schema: { type: "object", properties: { period: { type: "string", enum: SALES_PERIODS } }, required: ["period"], additionalProperties: false },
  },
  fixes: {
    name: "propose_fixes",
    description:
      "Look over a day for problems (reported overruns, late clients, call-outs, double-bookings, and visits likely to run over from how long stylists usually take) and put fixes in Denise's panel for staff to approve. Changes nothing by itself.",
    strict: true,
    input_schema: { type: "object", properties: { date: { ...nullable("string"), description: "YYYY-MM-DD. Null for the day on the calendar." } }, required: ["date"], additionalProperties: false },
  },
};

export function systemPrompt(c: AssistantContext): string {
  const local = toLocal(c.now, c.timeZone);
  return `${VOICE}

You help the staff at ${c.salon}. You're talking to ${c.askerName ? `${c.askerName} (${c.asker ?? "staff"})` : `the ${c.asker ?? "front desk"}`}${c.askerName ? `; "I", "me" and "my" in their questions mean ${c.askerName}` : ""}. You help with finding free times, suggesting bookings, and answering questions about clients, stylists, the salon's patterns and stock${c.knowledge?.sales ? ", and sales" : ""}.

Facts: use your tools for every fact; never guess a time is free. Every number you mention must come from a tool result, as given: don't calculate, estimate or invent figures. Say briefly what an answer is based on (e.g. "from 14 timed visits"). If the tools don't cover something, say you don't know.

Actions: you can't book, move or cancel anything yourself. propose_booking and propose_fixes only put suggestions on screen for staff to approve; after proposing, say what you suggested in one sentence and that they can approve it below. If nothing fits, say so and offer the nearest options. You never contact clients or write messages to them; staff do that.

Style: a few short sentences, then one useful next step (e.g. "Want me to look for a time?"). Clients by first name only. Times are the salon's local time; say them like "1:15pm".

Today is ${c.today}; it's now ${formatMinute(local.minute)}. The calendar is showing ${c.date}; questions without a day are about that day.`;
}

// A tool runner for one question; suggestions it makes are collected.
export function assistantTools(c: AssistantContext): ToolRunner & { suggestions: BookingSuggestion[] } {
  const suggestions: BookingSuggestion[] = [];
  const services = new Map(c.services.map((s) => [s.id, s]));
  const staff = new Map(c.staff.map((s) => [s.id, s]));
  const dayOf = (date: unknown): LocalDate | null => (date == null ? c.date : typeof date === "string" && isLocalDate(date) ? date : null);
  const minuteOf = (time: unknown) => (typeof time === "string" ? parseTime(time) : null);

  async function run(name: string, raw: unknown): Promise<string> {
    const input = (raw ?? {}) as Record<string, unknown>;
    switch (name) {
      case "list_services": {
        const words = typeof input.query === "string" ? input.query.toLowerCase().split(/[^a-z]+/).map(stem).filter(Boolean) : [];
        const matches = c.services.filter((s) => words.some((w) => `${s.name} ${s.category}`.toLowerCase().includes(w)));
        return JSON.stringify((matches.length ? matches : c.services).slice(0, 25).map((s) => ({ service_id: s.id, name: s.name, category: s.category, minutes: s.minutes })));
      }
      case "list_stylists":
        return JSON.stringify(c.staff.map((s) => ({ staff_id: s.id, first_name: s.firstName, level: s.title })));
      case "find_openings": {
        const date = dayOf(input.date);
        if (!date) return "Give the date as YYYY-MM-DD.";
        if (date < c.today) return "That day has passed.";
        if (!services.has(String(input.service_id))) return "Unknown service_id: look it up with list_services.";
        const ctx = await c.calendar(date);
        const limit = typeof input.limit === "number" ? Math.min(Math.max(input.limit, 1), 10) : 5;
        const openings = findOpenings(ctx, {
          serviceId: String(input.service_id),
          date,
          staffIds: typeof input.staff_id === "string" ? [input.staff_id] : undefined,
          from: minuteOf(input.after) ?? 0,
          to: minuteOf(input.before) ?? 24 * 60,
          notBefore: c.now,
          limit,
        });
        if (!openings.length) return "No free times match.";
        return JSON.stringify(
          openings.map((o) => ({ staff_id: o.staffId, stylist: staff.get(o.staffId)?.firstName ?? "a stylist", date, start: formatMinute(o.startMinute), start_24h: `${String(Math.floor(o.startMinute / 60)).padStart(2, "0")}:${String(o.startMinute % 60).padStart(2, "0")}` })),
        );
      }
      case "propose_booking": {
        const date = dayOf(input.date);
        const minute = minuteOf(input.start);
        const service = services.get(String(input.service_id));
        const stylist = staff.get(String(input.staff_id));
        if (!date || minute === null || !service || !stylist) return "Check the service_id, staff_id, date and start.";
        if (date < c.today) return "That day has passed.";
        const start = fromLocal(date, minute, c.timeZone);
        if (!start || start < c.now) return "That time has passed.";

        // The same rules as any booking, with a free chair.
        const ctx = await c.calendar(date);
        const timing = timingFor(ctx, stylist.id, service.id);
        const resourceId = timing ? pickResource(ctx, { ...timing, serviceId: service.id, staffId: stylist.id, start }) : null;
        const check = checkAppointment(ctx, [{ serviceId: service.id, staffId: stylist.id, resourceId, start }]);
        if (!check.valid) {
          const problems = check.items.flatMap((i) => (i.valid ? [] : i.problems));
          return `That doesn't work: ${[...new Set(problems.map(describeProblem))].join(" ")}`;
        }
        const summary = `${service.name} with ${stylist.firstName} · ${formatMinute(minute)}`;
        const hint = typeof input.client_first_name === "string" ? input.client_first_name.slice(0, 50) : null;
        const actionId = await c.propose({ summary, reason: "Suggested from Ask Denise.", serviceId: service.id, staffId: stylist.id, resourceId, start });
        suggestions.push({
          actionId,
          date,
          staffId: stylist.id,
          staffName: stylist.firstName,
          serviceName: service.name,
          startMinute: minute,
          endMinute: minute + service.minutes,
          clientHint: hint,
        });
        return JSON.stringify({ suggested: summary, needs_approval: true });
      }
      default:
        return `Unknown tool ${name}.`;
    }
  }

  const k = c.knowledge;
  const extra = k
    ? [KNOWLEDGE_TOOLS.clients, KNOWLEDGE_TOOLS.overdue, KNOWLEDGE_TOOLS.durations, KNOWLEDGE_TOOLS.salon, KNOWLEDGE_TOOLS.schedule, KNOWLEDGE_TOOLS.stock, ...(k.sales ? [KNOWLEDGE_TOOLS.sales] : []), ...(k.fixes ? [KNOWLEDGE_TOOLS.fixes] : [])]
    : [];

  async function runAny(name: string, raw: unknown): Promise<string> {
    const input = (raw ?? {}) as Record<string, unknown>;
    if (!k) return run(name, raw);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
    switch (name) {
      case "client_insights":
        return JSON.stringify(await k.clients(String(input.first_name ?? "")));
      case "overdue_clients":
        return JSON.stringify(await k.overdue(typeof input.limit === "number" ? input.limit : 10));
      case "stylist_durations":
        return JSON.stringify(await k.durations({ staffId: str(input.staff_id), serviceId: str(input.service_id) }));
      case "salon_patterns":
        return JSON.stringify(await k.salon());
      case "day_schedule": {
        const date = dayOf(input.date);
        return date ? JSON.stringify(await k.schedule(date)) : "Give the date as YYYY-MM-DD.";
      }
      case "inventory_levels":
        return JSON.stringify(await k.stock(str(input.query)));
      case "sales_summary":
        if (!k.sales) return "Sales figures are for owners and managers.";
        if (!SALES_PERIODS.includes(input.period as SalesPeriod)) return `Choose a period: ${SALES_PERIODS.join(", ")}.`;
        return JSON.stringify(await k.sales(input.period as SalesPeriod));
      case "propose_fixes": {
        if (!k.fixes) return "Only the front desk, managers and owners can approve fixes.";
        const date = dayOf(input.date);
        if (!date) return "Give the date as YYYY-MM-DD.";
        if (date < c.today) return "That day has passed.";
        return JSON.stringify(await k.fixes(date));
      }
      default:
        return run(name, raw);
    }
  }

  return { tools: [...TOOLS, ...extra], run: runAny, suggestions };
}

// Answers a staff question, with any bookings Denise suggests.
export async function answer(
  client: ClaudeClient,
  c: AssistantContext,
  history: { role: "user" | "assistant"; text: string }[],
): Promise<{ text: string; suggestions: BookingSuggestion[] }> {
  const runner = assistantTools(c);
  const question = [...history].reverse().find((m) => m.role === "user")?.text ?? "";
  const text = await converse(client, systemPrompt(c), history, runner, modelFor(question));
  return { text, suggestions: runner.suggestions };
}
