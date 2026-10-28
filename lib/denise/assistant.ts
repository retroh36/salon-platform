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

import { howTo, type HelpPage } from "@/lib/help/guide";
import { formatDuration } from "@/lib/duration";
import { BASIS_TEXT, type DurationBasis } from "@/lib/insights/durations";
import type Anthropic from "@anthropic-ai/sdk";
import { checkAppointment, describeProblem, durationMinutes, pickResource, stretchTiming, timingFor, type BookingContext, type ServiceTiming } from "@/lib/scheduling/booking";
import { findOpenings } from "@/lib/scheduling/openings";
import { formatMinute, fromLocal, isLocalDate, parseTime, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { converse, modelFor, VOICE, type ClaudeClient, type ConverseHooks, type ToolRunner } from "./claude";
import { POLICY_PERIODS, SALES_PERIODS, type Knowledge, type PolicyPeriod, type SalesPeriod } from "./knowledge";
import { PARTS } from "./team";
import type { StaffRole } from "@/lib/staff";
import type { BookingSuggestion, HelpLink } from "./types";
import type { PageContext } from "./page";

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
  propose: (booking: { summary: string; reason: string; serviceId: string; staffId: string; resourceId: string | null; start: Date; timing?: ServiceTiming }) => Promise<string | null>;
  // How long a stylist really takes for a service (trusted figures only),
  // from lib/insights/: availability is searched with it.
  usualTime?: (staffId: string, serviceId: string) => { medianMinutes: number; visits: number; basis?: DurationBasis } | null;
  // Who's asking ("front desk", "stylist"…) and their first name, and what
  // they may look up.
  asker?: string;
  askerName?: string;
  knowledge?: Knowledge;
  // The help guide (docs/help/) and the asker's role, for how_to.
  help?: HelpPage[];
  role?: StaffRole;
  // The page staff asked from (./page.ts), and its client if it has one.
  page?: PageContext | null;
};

const THIS_CLIENT_TOOL: Anthropic.Tool = {
  name: "this_client",
  description:
    "The client on the page staff are looking at: their next booked visits (date, time, services, stylists), how often they come, when they're next due, their usual stylist, day, time and services, how often they're late, cancel or don't show, and churn risk (spend for owners, managers and front desk).",
  strict: true,
  input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
};

const HOW_TO_TOOL: Anthropic.Tool = {
  name: "how_to",
  description:
    "Search Maestra's help guide: how to do something in the app (ring up a sale, sell a gift card, check in, refunds, payroll, settings…). Returns the best page: its steps, who can do it (can_do for the person asking, who_can), and other pages close to the question (ask again with one of their titles if it fits better). found is false when the guide doesn't cover it.",
  strict: true,
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "The task in a few words, e.g. 'sell a gift card', or a page title from other_pages." } },
    required: ["query"],
    additionalProperties: false,
  },
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
const KNOWLEDGE_TOOLS: Record<"clients" | "overdue" | "durations" | "salon" | "schedule" | "stock" | "sales" | "fixes" | "giftCards" | "packages" | "rewards" | "policy" | "events" | "eventBalance" | "team" | "dayOff", Anthropic.Tool> = {
  team: {
    name: "who_is_working",
    description:
      "Who's working on a day from the published team schedule (stylists, assistants, the front desk and managers), or in part of it: morning (before noon), afternoon (noon to 5pm), evening (\"night\": from 5pm) or all_day. Each person's first name, role, level and hours, and when the salon is open. For owners and managers, also anything Denise would flag that day: gaps at the front desk or on the floor, no Master stylist, two people on one chair, a time-off request on a busy day.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD." }, part: { type: "string", enum: PARTS } },
      required: ["date", "part"],
      additionalProperties: false,
    },
  },
  dayOff: {
    name: "day_off_check",
    description:
      "What giving one person the day off would leave, from the published schedule: whether they're working, how many of their clients are booked, who else is off, the stylists and Master stylists left, how booked the stylists left would be, whether they've asked for it, and any new gaps in cover. Owners and managers. It changes nothing: time off is approved in Scheduling, Requests.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD." }, first_name: { type: "string" } },
      required: ["date", "first_name"],
      additionalProperties: false,
    },
  },
  events: {
    name: "events_in_month",
    description:
      "Weddings and other events in a month: each one by its client's first name (\"Mia's wedding\"), the date, where it stands (Inquiry, Proposal sent, Booked, Trial done, Completed), party size, ready-by time, in the salon or on location, the team, and for the front desk, managers and owners its total and what's left to collect. Lost ones are only counted. A stylist sees only the events they're on.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { month: { type: "string", description: "The month as YYYY-MM." } },
      required: ["month"],
      additionalProperties: false,
    },
  },
  eventBalance: {
    name: "event_balance",
    description:
      "What's been paid and what's left to collect on one event, found by a name in the question (the client's first or last name, or the event's name, like \"Rossi\"): the total, paid so far, left to collect, and each payment (deposit, second payment, balance, a member's own share) as paid, due or didn't go through. Front desk, managers and owners.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "The name to look for, like \"Rossi\"." } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  policy: {
    name: "late_cancellations",
    description:
      "Late cancellations and no-shows under the salon's cancellation policy for a period: who (first names), the visit date and what happened to the fee (charged, waived, didn't go through; amounts only for owners and managers), and the repeat offenders. Front desk, managers and owners.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { period: { type: "string", enum: ["this_month", "last_month", "last_30_days"] } },
      required: ["period"],
      additionalProperties: false,
    },
  },
  giftCards: {
    name: "gift_card_balances",
    description: "What the salon owes in gift cards: purchased balances still on cards (services owed), promotional credit out (no cash value) and balances on expired cards. Owners only.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  packages: {
    name: "unused_packages",
    description: "Unused package uses: what they're worth in total, how many uses are left, and the clients who have them (first names, most value first). Owners only.",
    strict: true,
    input_schema: { type: "object", properties: { limit: { ...nullable("integer"), description: "How many clients to list (1-20, default 5)." } }, required: ["limit"], additionalProperties: false },
  },
  rewards: {
    name: "rewards_summary",
    description:
      "The salon's rewards program: points outstanding (and their estimated value), clients by tier, the last 90 days' points earned and redeemed with the redemption rate, and the VIPs (the top tier's clients, first names, most spent first). For \"How many points are outstanding?\" and \"Who are our VIPs?\". Owners and managers.",
    strict: true,
    input_schema: { type: "object", properties: { limit: { ...nullable("integer"), description: "How many VIPs to list (1-20, default 5)." } }, required: ["limit"], additionalProperties: false },
  },
  clients: {
    name: "client_insights",
    description:
      "A client's habits, by first name: how often they come (usual gap), when they're next due or booked, their usual stylist, day, time and services, how often they're late, cancel or don't show, and churn risk (spend only for owners, managers and front desk). Several clients may share a first name.",
    strict: true,
    input_schema: { type: "object", properties: { first_name: { type: "string" } }, required: ["first_name"], additionalProperties: false },
  },
  overdue: {
    name: "overdue_clients",
    description: "Regulars who are due back or overdue and have nothing booked, most overdue first, with the total. Ask for 3 to 5 unless staff want the whole list.",
    strict: true,
    input_schema: { type: "object", properties: { limit: { ...nullable("integer"), description: "How many to list (1-20, default 10)." } }, required: ["limit"], additionalProperties: false },
  },
  durations: {
    name: "stylist_durations",
    description:
      "How long stylists really take for services, from actual start and finish times: typical (median) minutes, the middle half, visits counted, consistency, menu and booked minutes, how often it ran over, the length you'd suggest booking, and a trend (faster or slower) only when there's a significant one from enough recent visits. Only trusted from 5 visits.",
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
    description: "Sales for a period from the sales taken at checkout: services and retail in dollars (before tax), tax, tips and refunds, visits checked out, average visit and no-shows, with the period before for comparison.",
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

Facts: look everything up; never guess a time is free. Every number you mention must come from what you looked up, as given: don't calculate, estimate or invent figures. Say briefly what an answer is based on (e.g. "from 14 timed visits"). Times are either tapped in by stylists or estimated from check-in to checkout (based_on, estimated_percent): when a figure comes from check-in to checkout, say so ("based on check-in to checkout times"), as it's rougher. If you can't find something out, say you don't know. Only mention a stylist getting faster or slower when the figures you looked up include a trend.

Voice: you speak for yourself. Never mention tools or their names, "the tool", "the system" or "the data": say "I'd suggest booking 180 minutes", "I checked", "I can only see your own times". If something isn't yours to see, say where it is: contact details are on the client's profile, and sales are for owners and managers.

Availability: free times are checked with each stylist's usual time for the service when it's known (length_basis says which length was used). Say which you used, e.g. "I checked with Bridget's usual 3 hours" or "with the booked length".

Actions: you can't book, move or cancel anything yourself. propose_booking and propose_fixes only put suggestions on screen for staff to approve; after proposing, say what you suggested in one sentence and that they can approve it below. If nothing fits, say so and offer the nearest options. You never contact clients or write messages to them; staff do that.

Style: keep it scannable. Two to four sentences unless they ask for more. For lists, give the top 3, each with a short reason, then offer the rest ("Want the rest?"). End with one useful next step (e.g. "Want me to look for a time?"). Clients by first name only. Times are the salon's local time; say them like "1:15pm".

${
    c.help
      ? `How to use Maestra: for any question about how to do something in the app, look it up in the help guide and answer only from the page you get back; never describe screens, buttons or steps from memory. Give its steps as a short numbered list (1. 2. 3.), one line each, in the page's words, then at most one "Good to know" line if it matters. If the person asking can't do it themselves (can_do false), don't list the steps: say who can (who_can) and suggest asking them. If the guide doesn't cover it (found false), say it isn't in the help guide yet and suggest asking a manager; don't guess. When the page has a button, it appears under your answer, so you can say "tap Open new sale below".

`
      : ""
  }${pageLine(c)}Today is ${c.today}; it's now ${formatMinute(local.minute)}. The calendar is showing ${c.date}; questions without a day are about that day.`;
}

// Where they're asking from: on a client's page, "this client", "they",
// "she" or "he" mean that client.
function pageLine(c: AssistantContext): string {
  if (!c.page) return "";
  if (!c.page.client) return `They're asking from ${c.page.label}.\n\n`;
  return `They're asking from ${c.page.label}, about ${c.page.client.firstName}: "this client", "they", "them", "she", "her", "he" or "him" without another name mean ${c.page.client.firstName}. Look them up with this_client.\n\n`;
}

// A tool runner for one question; suggestions it makes are collected.
export function assistantTools(c: AssistantContext): ToolRunner & { suggestions: BookingSuggestion[]; links: HelpLink[] } {
  const suggestions: BookingSuggestion[] = [];
  // The button under her answer: the page from her last how_to.
  const links: HelpLink[] = [];
  const services = new Map(c.services.map((s) => [s.id, s]));
  const staff = new Map(c.staff.map((s) => [s.id, s]));
  // A stylist's usual time for a service, when trusted, as a timing (in
  // 5-minute steps, from their own or the menu's).
  const lengthFor = (ctx: BookingContext, staffId: string, serviceId: string) => {
    const usual = c.usualTime?.(staffId, serviceId);
    const base = timingFor(ctx, staffId, serviceId);
    if (!usual || !base) return null;
    return { timing: stretchTiming(base, Math.ceil(usual.medianMinutes / 5) * 5), median: usual.medianMinutes, visits: usual.visits, basis: usual.basis ?? "tapped" };
  };
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
        const serviceId = String(input.service_id);
        const limit = typeof input.limit === "number" ? Math.min(Math.max(input.limit, 1), 10) : 5;
        // Each stylist with how long they really take, when that's known.
        const lengths = new Map(c.staff.flatMap((s) => (lengthFor(ctx, s.id, serviceId) ? [[s.id, lengthFor(ctx, s.id, serviceId)!] as const] : [])));
        const openings = findOpenings(ctx, {
          serviceId,
          date,
          staffIds: typeof input.staff_id === "string" ? [input.staff_id] : undefined,
          from: minuteOf(input.after) ?? 0,
          to: minuteOf(input.before) ?? 24 * 60,
          notBefore: c.now,
          limit,
          timings: new Map([...lengths].map(([id, l]) => [id, l.timing])),
        });
        const basis = (staffId: string) => {
          const l = lengths.get(staffId);
          return l
            ? `${staff.get(staffId)?.firstName ?? "their"}'s usual time (typically ${formatDuration(l.median)} over ${l.visits} visits, ${BASIS_TEXT[l.basis]})`
            : "the booked length for this stylist (not enough timed visits to know their usual time)";
        };
        if (!openings.length) {
          const checked = typeof input.staff_id === "string" ? basis(input.staff_id) : "each stylist's usual time where known";
          return JSON.stringify({ openings: [], checked_with: checked });
        }
        return JSON.stringify(
          openings.map((o) => ({
            staff_id: o.staffId,
            stylist: staff.get(o.staffId)?.firstName ?? "a stylist",
            date,
            start: formatMinute(o.startMinute),
            start_24h: `${String(Math.floor(o.startMinute / 60)).padStart(2, "0")}:${String(o.startMinute % 60).padStart(2, "0")}`,
            length_minutes: o.minutes,
            length_basis: basis(o.staffId),
          })),
        );
      }
      case "how_to": {
        if (!c.help) return "The help guide isn't available.";
        const result = howTo(c.help, String(input.query ?? "").slice(0, 200), c.role ?? "stylist");
        links.length = 0;
        if (result.found && result.link) links.push(result.link);
        if (!result.found) return JSON.stringify(result);
        return JSON.stringify({ found: true, page: result.page, other_pages: result.other_pages });
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
        const usual = lengthFor(ctx, stylist.id, service.id);
        const timing = usual?.timing ?? timingFor(ctx, stylist.id, service.id);
        const resourceId = timing ? pickResource(ctx, { ...timing, serviceId: service.id, staffId: stylist.id, start }) : null;
        const check = checkAppointment(ctx, [{ serviceId: service.id, staffId: stylist.id, resourceId, start, timing: usual?.timing }]);
        if (!check.valid) {
          const problems = check.items.flatMap((i) => (i.valid ? [] : i.problems));
          return `That doesn't work: ${[...new Set(problems.map(describeProblem))].join(" ")}`;
        }
        const summary = `${service.name} with ${stylist.firstName} · ${formatMinute(minute)}`;
        const hint = typeof input.client_first_name === "string" ? input.client_first_name.slice(0, 50) : null;
        const actionId = await c.propose({
          summary,
          reason: usual ? `Suggested from Ask Denise, booked for ${formatDuration(durationMinutes(usual.timing))}: ${stylist.firstName}'s usual time.` : "Suggested from Ask Denise.",
          serviceId: service.id,
          staffId: stylist.id,
          resourceId,
          start,
          timing: usual?.timing,
        });
        suggestions.push({
          actionId,
          date,
          staffId: stylist.id,
          staffName: stylist.firstName,
          serviceName: service.name,
          startMinute: minute,
          endMinute: minute + (timing ? durationMinutes(timing) : service.minutes),
          clientHint: hint,
        });
        return JSON.stringify({ suggested: summary, length_minutes: timing ? durationMinutes(timing) : service.minutes, needs_approval: true });
      }
      default:
        return `Unknown tool ${name}.`;
    }
  }

  const k = c.knowledge;
  const extra = k
    ? [
        KNOWLEDGE_TOOLS.clients,
        KNOWLEDGE_TOOLS.overdue,
        KNOWLEDGE_TOOLS.durations,
        KNOWLEDGE_TOOLS.salon,
        KNOWLEDGE_TOOLS.schedule,
        KNOWLEDGE_TOOLS.stock,
        ...(k.sales ? [KNOWLEDGE_TOOLS.sales] : []),
        ...(k.fixes ? [KNOWLEDGE_TOOLS.fixes] : []),
        ...(k.giftCards ? [KNOWLEDGE_TOOLS.giftCards] : []),
        ...(k.packages ? [KNOWLEDGE_TOOLS.packages] : []),
        ...(k.rewards ? [KNOWLEDGE_TOOLS.rewards] : []),
        ...(k.policy ? [KNOWLEDGE_TOOLS.policy] : []),
        KNOWLEDGE_TOOLS.events,
        ...(k.eventBalance ? [KNOWLEDGE_TOOLS.eventBalance] : []),
        KNOWLEDGE_TOOLS.team,
        ...(k.dayOff ? [KNOWLEDGE_TOOLS.dayOff] : []),
      ]
    : [];

  async function runAny(name: string, raw: unknown): Promise<string> {
    const input = (raw ?? {}) as Record<string, unknown>;
    if (!k) return run(name, raw);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
    switch (name) {
      case "client_insights":
        return JSON.stringify(await k.clients(String(input.first_name ?? "")));
      case "this_client":
        return c.page?.client ? JSON.stringify(await k.client(c.page.client.id)) : "There's no client on this page.";
      case "overdue_clients":
        return JSON.stringify(await k.overdue(typeof input.limit === "number" ? input.limit : 5));
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
      case "gift_card_balances":
        if (!k.giftCards) return "Gift card totals are for owners.";
        return JSON.stringify(await k.giftCards());
      case "unused_packages":
        if (!k.packages) return "Package totals are for owners.";
        return JSON.stringify(await k.packages(typeof input.limit === "number" ? input.limit : 5));
      case "rewards_summary":
        if (!k.rewards) return "Rewards totals are for owners and managers.";
        return JSON.stringify(await k.rewards(typeof input.limit === "number" ? input.limit : 5));
      case "late_cancellations":
        if (!k.policy) return "Late cancellations are for the front desk, managers and owners.";
        if (!POLICY_PERIODS.includes(input.period as PolicyPeriod)) return `Choose a period: ${POLICY_PERIODS.join(", ")}.`;
        return JSON.stringify(await k.policy(input.period as PolicyPeriod));
      case "events_in_month":
        return JSON.stringify(await k.events(String(input.month ?? "")));
      case "event_balance":
        if (!k.eventBalance) return "Event payments are for the front desk, managers and owners.";
        return JSON.stringify(await k.eventBalance(String(input.name ?? "")));
      case "who_is_working":
        return JSON.stringify(await k.team(String(input.date ?? ""), String(input.part ?? "")));
      case "day_off_check":
        if (!k.dayOff) return "Checking a day off is for owners and managers.";
        return JSON.stringify(await k.dayOff(String(input.date ?? ""), String(input.first_name ?? "")));
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

  const pageClient = k && c.page?.client ? [THIS_CLIENT_TOOL] : [];
  return { tools: [...TOOLS, ...(c.help ? [HOW_TO_TOOL] : []), ...pageClient, ...extra], run: runAny, suggestions, links };
}

// Answers a staff question, with any bookings Denise suggests.
export async function answer(
  client: ClaudeClient,
  c: AssistantContext,
  history: { role: "user" | "assistant"; text: string }[],
  hooks: ConverseHooks = {},
): Promise<{ text: string; suggestions: BookingSuggestion[]; links: HelpLink[] }> {
  const runner = assistantTools(c);
  const question = [...history].reverse().find((m) => m.role === "user")?.text ?? "";
  const text = await converse(client, systemPrompt(c), history, runner, modelFor(question), hooks);
  return { text, suggestions: runner.suggestions, links: runner.links };
}

// What Denise is doing while she uses a tool, for her "thinking" status
// ("Checking Bridget's openings…"). Our wording, from the tool's input.
export function toolStatus(name: string, input: unknown, c: Pick<AssistantContext, "staff" | "page">): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const stylist = typeof i.staff_id === "string" ? c.staff.find((s) => s.id === i.staff_id)?.firstName : undefined;
  switch (name) {
    case "find_openings":
      return stylist ? `Checking ${stylist}'s openings…` : "Checking everyone's openings…";
    case "propose_booking":
      return "Checking that time works…";
    case "list_services":
      return "Looking at the menu…";
    case "list_stylists":
      return "Looking at the team…";
    case "client_insights":
      return typeof i.first_name === "string" ? `Looking up ${i.first_name}'s visits…` : "Looking up the client…";
    case "this_client":
      return c.page?.client ? `Looking up ${c.page.client.firstName}'s visits…` : "Looking up the client…";
    case "overdue_clients":
      return "Finding regulars who are due back…";
    case "stylist_durations":
      return stylist ? `Looking at how long ${stylist} usually takes…` : "Looking at how long everyone usually takes…";
    case "salon_patterns":
      return "Looking at the salon's patterns…";
    case "day_schedule":
      return "Reading the day's schedule…";
    case "inventory_levels":
      return "Checking stock…";
    case "sales_summary":
      return "Adding up sales…";
    case "propose_fixes":
      return "Looking for fixes…";
    case "gift_card_balances":
      return "Adding up gift card balances…";
    case "unused_packages":
      return "Finding unused packages…";
    case "late_cancellations":
      return "Looking at late cancellations and no-shows…";
    case "rewards_summary":
      return "Adding up rewards points…";
    case "events_in_month":
      return "Looking at the events that month…";
    case "event_balance":
      return "Checking the event's payments…";
    case "how_to":
      return "Looking it up in the help guide…";
    case "who_is_working":
      return "Checking the team schedule…";
    case "day_off_check":
      return typeof i.first_name === "string" ? `Checking what ${i.first_name}'s day off would leave…` : "Checking the schedule…";
    default:
      return "Looking that up…";
  }
}
