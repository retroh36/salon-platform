// Client reports: a list of clients picked by fixed filters (what they had,
// with whom, how often and when, their last and next visit, spend), always
// with the same columns. Denise turns a question into one of these
// (Ask Denise's client_report tool); the page's form sets the same fields
// by hand; a saved report is the definition, run again without her. Our
// code works out every date (from words like "the start of this year" or
// "6 months ago", kept as words so a saved report stays relative) and the
// database runs it as the person asking (client_report, RLS), so a stylist
// gets their own book and spend only reaches those who can see it.
// Pure: no database.

import { addDays, isLocalDate, startOfWeek, type LocalDate } from "./scheduling/time.ts";

// A date as words, resolved against today when the report runs: "today",
// "this_week", "this_month", "last_month", "this_year", "last_year" (the
// start of each), "6 months ago" (days, weeks, months or years), a month
// ("2024-06", its first day) or a day ("2024-06-15").
export type DateRef = string;

export const REPORT_SORTS = ["last_visit", "visits", "next_visit", "spend", "name"] as const;
export type ReportSort = (typeof REPORT_SORTS)[number];

export type ClientReport = {
  // Visits counted: those with any of these categories or services (none:
  // every service), with any of these stylists (none: anyone), from the
  // first date until the second.
  categories: string[];
  serviceIds: string[];
  staffIds: string[];
  from: DateRef | null;
  to: DateRef | null;
  minVisits: number | null;
  maxVisits: number | null;
  // Their last checked-out visit of any kind: none since (never counts as
  // none), or one since.
  noVisitSince: DateRef | null;
  visitedSince: DateRef | null;
  nextVisit: "booked" | "none" | null;
  // Lifetime spend, in cents (what Denise has learned): the front of house.
  minSpendCents: number | null;
  sort: ReportSort;
};

export const EMPTY_REPORT: ClientReport = {
  categories: [],
  serviceIds: [],
  staffIds: [],
  from: null,
  to: null,
  minVisits: null,
  maxVisits: null,
  noVisitSince: null,
  visitedSince: null,
  nextVisit: null,
  minSpendCents: null,
  sort: "last_visit",
};

// The most clients a report lists (and its CSV holds).
export const REPORT_LIMIT = 2000;
const MAX_PICKS = 30;

type Start = "today" | "this_week" | "this_month" | "last_month" | "this_year" | "last_year";
const AGO = /^(\d{1,3}) (day|week|month|year)s? ago$/;

const pad = (n: number) => String(n).padStart(2, "0");

function addMonths(date: LocalDate, months: number): LocalDate {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}

export function isDateRef(ref: string): boolean {
  return resolveDate(ref, "2026-01-01") !== null;
}

// The day a DateRef means, today being `today`; null when it isn't one.
export function resolveDate(ref: DateRef, today: LocalDate): LocalDate | null {
  const r = ref.trim().toLowerCase();
  const monthStart = today.slice(0, 8) + "01";
  switch (r) {
    case "today":
      return today;
    case "this_week":
      return startOfWeek(today);
    case "this_month":
      return monthStart;
    case "last_month":
      return addMonths(monthStart, -1);
    case "this_year":
      return `${today.slice(0, 4)}-01-01`;
    case "last_year":
      return `${Number(today.slice(0, 4)) - 1}-01-01`;
  }
  const ago = AGO.exec(r);
  if (ago) {
    const n = Number(ago[1]);
    if (ago[2] === "day") return addDays(today, -n);
    if (ago[2] === "week") return addDays(today, -7 * n);
    return addMonths(today, ago[2] === "month" ? -n : -12 * n);
  }
  if (/^\d{4}-\d{2}$/.test(r) && isLocalDate(`${r}-01`)) return `${r}-01`;
  if (isLocalDate(r)) return r;
  return null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "the start of this year", "6 months ago", "June 2024", "Jun 15, 2024".
export function dateRefText(ref: DateRef): string {
  const r = ref.trim().toLowerCase();
  const start: Record<Start, string> = {
    today: "today",
    this_week: "the start of this week",
    this_month: "the start of this month",
    last_month: "the start of last month",
    this_year: "the start of this year",
    last_year: "the start of last year",
  };
  if (r in start) return start[r as Start];
  const ago = AGO.exec(r);
  if (ago) return `${Number(ago[1])} ${ago[2]}${ago[1] === "1" ? "" : "s"} ago`;
  if (/^\d{4}-\d{2}$/.test(r)) return `${MONTHS[Number(r.slice(5, 7)) - 1]} ${r.slice(0, 4)}`;
  const [y, m, d] = r.split("-").map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
}

// The visits a report counts at least: one when it asks about services,
// stylists or dates and gives no most ("clients who had color" means at
// least one), else none.
export function minVisitsOf(r: ClientReport): number {
  if (r.minVisits !== null) return r.minVisits;
  const counting = r.categories.length || r.serviceIds.length || r.staffIds.length || r.from || r.to;
  return counting && r.maxVisits === null ? 1 : 0;
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 999;
const strings = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()))] : []);
const ref = (v: unknown) => (typeof v === "string" && v.trim() && isDateRef(v) ? v.trim().toLowerCase() : null);

// A report from untrusted JSON (a link, a saved row, Denise's tool input),
// keeping only what's on the salon's menu and team. What it dropped, in
// words, so Denise can say so.
export function readReport(raw: unknown, known: { categories: readonly string[]; serviceIds: readonly string[]; staffIds: readonly string[] }): { report: ClientReport; dropped: string[] } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const dropped: string[] = [];
  const pick = (v: unknown, list: readonly string[], what: string, match = (a: string, b: string) => a === b) => {
    const out: string[] = [];
    for (const x of strings(v)) {
      const hit = list.find((k) => match(k, x));
      if (hit) out.push(hit);
      else dropped.push(`${what} "${x.slice(0, 40)}"`);
    }
    return [...new Set(out)].slice(0, MAX_PICKS);
  };
  const date = (key: string) => {
    const v = o[key];
    if (v != null && v !== "" && ref(v) === null) dropped.push(`the date "${String(v).slice(0, 40)}"`);
    return ref(v);
  };
  const spend = o.minSpendCents;
  const report: ClientReport = {
    categories: pick(o.categories, known.categories, "the category", (a, b) => a.toLowerCase() === b.toLowerCase()),
    serviceIds: pick(o.serviceIds, known.serviceIds, "a service"),
    staffIds: pick(o.staffIds, known.staffIds, "a stylist"),
    from: date("from"),
    to: date("to"),
    minVisits: isCount(o.minVisits) ? o.minVisits : null,
    maxVisits: isCount(o.maxVisits) ? o.maxVisits : null,
    noVisitSince: date("noVisitSince"),
    visitedSince: date("visitedSince"),
    nextVisit: o.nextVisit === "booked" || o.nextVisit === "none" ? o.nextVisit : null,
    minSpendCents: typeof spend === "number" && Number.isInteger(spend) && spend > 0 && spend <= 100_000_000 ? spend : null,
    sort: REPORT_SORTS.includes(o.sort as ReportSort) ? (o.sort as ReportSort) : "last_visit",
  };
  return { report, dropped };
}

// Why a report can't run as it is, in words; null when it can.
export function reportProblem(r: ClientReport, today: LocalDate): string | null {
  if (r.minVisits !== null && r.maxVisits !== null && r.minVisits > r.maxVisits) return "The fewest visits is more than the most.";
  const from = r.from ? resolveDate(r.from, today) : null;
  const to = r.to ? resolveDate(r.to, today) : null;
  if (from && to && from >= to) return "The visits are counted from a day that isn't before the day they stop.";
  const since = r.visitedSince ? resolveDate(r.visitedSince, today) : null;
  const notSince = r.noVisitSince ? resolveDate(r.noVisitSince, today) : null;
  if (since && notSince && since >= notSince) return "No client can have visited since a day and also not since an earlier one.";
  return null;
}

const list = (items: string[], joiner = "or") => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${joiner} ${items.at(-1)}`);

// The report in one sentence, the same words every time: "Clients with 3
// or more Cut or Color visits since June 2024, and no visit since the
// start of this year."
export function describeReport(r: ClientReport, names: { services: ReadonlyMap<string, string>; staff: ReadonlyMap<string, string> }): string {
  const what = list([...r.categories, ...r.serviceIds.map((id) => names.services.get(id) ?? "a service")]);
  const min = minVisitsOf(r);
  const max = r.maxVisits;
  const noun = `${what ? `${what} ` : ""}visit`;
  const count =
    max === 0
      ? `no ${noun}s`
      : max !== null && min > 0
        ? min === max
          ? `exactly ${min} ${noun}${min === 1 ? "" : "s"}`
          : `${min} to ${max} ${noun}s`
        : max !== null
          ? `at most ${max} ${noun}${max === 1 ? "" : "s"}`
          : min > 1
            ? `${min} or more ${noun}s`
            : min === 1
              ? `a ${noun}`.replace(/^a ([aeiou])/i, "an $1")
              : null;
  const parts: string[] = [];
  if (count) {
    const whom = r.staffIds.length ? ` with ${list(r.staffIds.map((id) => names.staff.get(id) ?? "a stylist"))}` : "";
    const span = r.from && r.to ? ` from ${dateRefText(r.from)} until ${dateRefText(r.to)}` : r.from ? ` since ${dateRefText(r.from)}` : r.to ? ` before ${dateRefText(r.to)}` : "";
    parts.push(`with ${count}${whom}${span}`);
  }
  if (r.noVisitSince) parts.push(`no visit since ${dateRefText(r.noVisitSince)}`);
  if (r.visitedSince) parts.push(`a visit since ${dateRefText(r.visitedSince)}`);
  if (r.nextVisit === "booked") parts.push("a visit booked");
  if (r.nextVisit === "none") parts.push("nothing booked");
  if (r.minSpendCents) parts.push(`spent at least $${(r.minSpendCents / 100).toLocaleString("en-US")}`);
  if (!parts.length) return "Every client.";
  const [first, ...rest] = parts;
  const lead = first.startsWith("with ") ? `Clients ${first}` : `Clients with ${first}`;
  return `${lead}${rest.length ? `, and ${list(rest, "and")}` : ""}.`;
}

// The report in a link (/clients/reports?r=…), and back.
export function encodeReport(r: ClientReport): string {
  const trimmed = Object.fromEntries(Object.entries(r).filter(([k, v]) => v !== null && !(Array.isArray(v) && v.length === 0) && !(k === "sort" && v === "last_visit")));
  const bytes = new TextEncoder().encode(JSON.stringify(trimmed));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeReport(text: string): unknown {
  try {
    const binary = atob(text.slice(0, 4000).replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

export type ReportRow = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  visits: number;
  lastVisit: LocalDate | null;
  nextVisit: LocalDate | null;
  usualStylist: string | null;
  spendCents: number | null;
};

// The CSV: the same columns as the page, spend only for those who see it.
export function reportCsvRows(rows: readonly ReportRow[], spend: boolean): { header: string[]; rows: (string | number | null)[][] } {
  return {
    header: ["First name", "Last name", "Phone", "Visits counted", "Last visit", "Next visit", "Usual stylist", ...(spend ? ["Spend"] : [])],
    rows: rows.map((r) => [r.firstName, r.lastName, r.phone, r.visits, r.lastVisit, r.nextVisit, r.usualStylist, ...(spend ? [r.spendCents === null ? null : (r.spendCents / 100).toFixed(2)] : [])]),
  };
}

// For Denise: how many, and the first few by first name.
export function reportFacts(rows: readonly ReportRow[], total: number, sayDate: (d: LocalDate) => string) {
  return {
    clients: total,
    first_few: rows.slice(0, 5).map((r) => ({ first_name: r.firstName, visits_counted: r.visits, last_visit: r.lastVisit ? sayDate(r.lastVisit) : null, next_visit: r.nextVisit ? sayDate(r.nextVisit) : null })),
  };
}
