// "Find my stylist" (pure, unit-tested): from a client's answers, the service
// to book, the stylists who suit it, and whether the visit may need extra
// time. Our own rules, the same every time; no answer or photo goes to
// Denise's AI service.

import { levelTitle, type Level } from "@/lib/levels";

export const CHANGES = ["refresh", "noticeable", "complete"] as const;
export const LENGTHS = ["short", "medium", "long", "very_long"] as const;
export const HISTORY = ["color", "box_dye", "chemical"] as const;
export const BUDGETS = ["any", "value"] as const;

export const CHANGE_TEXT: Record<(typeof CHANGES)[number], string> = { refresh: "A refresh of what I have", noticeable: "Something noticeably different", complete: "A complete change" };
export const LENGTH_TEXT: Record<(typeof LENGTHS)[number], string> = { short: "Short", medium: "Medium", long: "Long", very_long: "Very long" };
export const HISTORY_TEXT: Record<(typeof HISTORY)[number], string> = { color: "Salon color in the last year", box_dye: "Box dye at home", chemical: "Relaxer, perm or keratin" };
export const BUDGET_TEXT: Record<(typeof BUDGETS)[number], string> = { any: "No preference", value: "Lower prices first" };

export const MAX_QUIZ_PHOTOS = 3;
export const MAX_QUIZ_NOTES = 500;
// A stylist counts as free soon within this many days.
export const SOON_DAYS = 14;
const WEEK = 7;
export const MAX_SUGGESTED = 3;
const MAX_EXTRA_MINUTES = 60;

export type QuizAnswers = {
  category: string;
  change: (typeof CHANGES)[number];
  length: (typeof LENGTHS)[number];
  history: (typeof HISTORY)[number][];
  budget: (typeof BUDGETS)[number];
  notes: string;
};

export type QuizService = { id: string; name: string; category: string; minutes: number; mode: "bookable" | "consultation"; requiresPatchTest: boolean };
export type QuizStylist = { id: string; displayName: string; firstName: string; level: string | null; specialty: string | null; bio: string | null; prices: Record<string, number> };
export type QuizSettings = { consultationServiceId: string | null; patchTestServiceId: string | null };

// Untrusted input from the page: only what's on the lists.
export function readAnswers(input: unknown, categories: readonly string[]): QuizAnswers | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  const one = <T extends string>(list: readonly T[], v: unknown) => (list.includes(v as T) ? (v as T) : null);
  const category = typeof a.category === "string" && categories.includes(a.category) ? a.category : null;
  const change = one(CHANGES, a.change);
  const length = one(LENGTHS, a.length);
  const budget = one(BUDGETS, a.budget);
  if (!category || !change || !length || !budget || !Array.isArray(a.history)) return null;
  if (a.history.some((h) => !HISTORY.includes(h))) return null;
  return { category, change, length, budget, history: [...new Set(a.history as QuizAnswers["history"])], notes: typeof a.notes === "string" ? a.notes.trim().slice(0, MAX_QUIZ_NOTES) : "" };
}

const isColorCategory = (services: readonly QuizService[], category: string) => services.some((s) => s.category === category && s.requiresPatchTest);
const heavyPast = (a: QuizAnswers) => a.history.includes("box_dye") || a.history.includes("chemical");

export type SuggestedService = { service: QuizService; consultation: boolean };

// A big color change over box dye or a chemical treatment starts with a
// consultation, where the salon has one. Otherwise the category's services
// by length: the shortest for a refresh, the longest for a complete change.
export function suggestService(services: readonly QuizService[], a: QuizAnswers, settings: QuizSettings): SuggestedService | null {
  const consult = services.find((s) => s.id === settings.consultationServiceId && s.mode === "bookable");
  if (consult && a.change === "complete" && heavyPast(a) && isColorCategory(services, a.category)) return { service: consult, consultation: true };
  const list = services
    .filter((s) => s.category === a.category && s.mode === "bookable" && s.id !== settings.consultationServiceId && s.id !== settings.patchTestServiceId)
    .sort((x, y) => x.minutes - y.minutes || x.name.localeCompare(y.name));
  if (!list.length) return null;
  const at = a.change === "refresh" ? 0 : a.change === "complete" ? list.length - 1 : Math.floor((list.length - 1) / 2);
  return { service: list[at], consultation: false };
}

export type StylistMatch = { stylist: QuizStylist; cents: number; score: number; reasons: string[]; daysUntilFree: number | null };

// Words of 4+ letters from the service and category found in what the
// stylist says about themselves.
function specialtyMatch(s: QuizStylist, service: QuizService): boolean {
  const about = `${s.specialty ?? ""} ${s.bio ?? ""}`.toLowerCase();
  return `${service.name} ${service.category}`
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((w) => w.length >= 4 && about.includes(w));
}

// Who suits it, best first: what they say they specialize in, seniority for
// a bigger job, price for those who asked, and how soon they're free. Anyone
// with no time in the next two weeks goes only when nobody else has any.
export function rankStylists(stylists: readonly QuizStylist[], service: QuizService, a: QuizAnswers, levels: readonly Level[], daysUntilFree: ReadonlyMap<string, number | null>): StylistMatch[] {
  const offering = stylists.filter((s) => service.id in s.prices);
  const prices = [...new Set(offering.map((s) => s.prices[service.id]))].sort((x, y) => x - y);
  const big = a.change === "complete" || heavyPast(a);
  const rank = (s: QuizStylist) => levels.findIndex((l) => l.key === s.level);
  const matches = offering.map((stylist): StylistMatch => {
    const reasons: string[] = [];
    let score = 0;
    if (specialtyMatch(stylist, service)) {
      score += 3;
      reasons.push(stylist.specialty ?? `Knows ${service.category.toLowerCase()} well`);
    }
    const at = rank(stylist);
    if (big && at >= 0 && levels.length > 1) {
      const senior = 1 - at / (levels.length - 1);
      score += 2 * senior;
      if (senior >= 0.5) reasons.push(`${levelTitle(levels, stylist.level!)}, for a bigger change`);
    }
    const cents = stylist.prices[service.id];
    if (a.budget === "value" && prices.length > 1) {
      const cheap = 1 - prices.indexOf(cents) / (prices.length - 1);
      score += 2 * cheap;
      if (cheap >= 0.5) reasons.push("One of our lower prices for this");
    }
    const days = daysUntilFree.get(stylist.id) ?? null;
    if (days !== null && days < WEEK) {
      score += 2;
      reasons.push("Has time this week");
    } else if (days !== null) {
      score += 1;
      reasons.push("Has time in the next two weeks");
    }
    return { stylist, cents, score, reasons, daysUntilFree: days };
  });
  const free = matches.filter((m) => m.daysUntilFree !== null);
  return (free.length ? free : matches)
    .sort((x, y) => y.score - x.score || (x.daysUntilFree ?? 999) - (y.daysUntilFree ?? 999) || x.stylist.displayName.localeCompare(y.stylist.displayName))
    .slice(0, MAX_SUGGESTED);
}

export type ExtraTime = { minutes: number; reasons: string[] };

// May this visit need longer than booked? Staff accept or ignore it.
export function extraTimeFlag(a: QuizAnswers, s: SuggestedService, services: readonly QuizService[]): ExtraTime | null {
  if (s.consultation) return null;
  const color = isColorCategory(services, s.service.category);
  const found: [number, string][] = [];
  if (a.length === "very_long") found.push([15, "Very long hair"]);
  if (color && a.change === "complete") found.push([30, "A complete color change"]);
  if (color && a.history.includes("box_dye")) found.push([15, "Box dye at home"]);
  if (color && a.history.includes("chemical")) found.push([15, "A relaxer, perm or keratin"]);
  if (!found.length) return null;
  return { minutes: Math.min(MAX_EXTRA_MINUTES, found.reduce((n, [m]) => n + m, 0)), reasons: found.map(([, r]) => r) };
}

// The answers as staff read them.
export function answerLines(a: QuizAnswers): { label: string; value: string }[] {
  return [
    { label: "Looking for", value: `${a.category}: ${CHANGE_TEXT[a.change].toLowerCase()}` },
    { label: "Hair length", value: LENGTH_TEXT[a.length] },
    { label: "Past treatments", value: a.history.length ? a.history.map((h) => HISTORY_TEXT[h]).join(", ") : "None" },
    { label: "Budget", value: BUDGET_TEXT[a.budget] },
    ...(a.notes ? [{ label: "In their words", value: a.notes }] : []),
  ];
}
