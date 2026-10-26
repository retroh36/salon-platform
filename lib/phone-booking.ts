// Booking by asking Denise (her chat, ./denise/booking-chat.ts): what the
// client asked for, as fields staff can change: who, which services, with
// whom, which days and what time of day. Denise reads a typed line into
// these (lib/denise/booking-request.ts), and follow-ups change them
// (`applyChange`); without her, staff fill in a form that our code starts
// from what it can tell (`guessRequest`). Our code works out the dates
// ("next week" → Monday to Sunday) and finds the client's name in the line,
// so the name never goes to Claude. Pure.

import type { BookingContext } from "@/lib/scheduling/booking";
import { PART_WINDOWS, rankVisits, searchVisits, type Candidate, type Habits, type PartOfDay, type Ranked, type VisitSearch } from "@/lib/scheduling/phone";
import { addDays, datesBetween, startOfWeek, weekdayOf, type LocalDate } from "@/lib/scheduling/time";
import type { StaffLevel } from "@/lib/schedule-forms";
import type { BookingParse } from "@/lib/denise/booking-request";

export type PhoneRequest = {
  // The client's name or phone as typed (for the client search), and
  // whether they want the same as last time.
  clientText: string | null;
  sameAsLast: boolean;
  // In the order they're done, up to four.
  serviceIds: string[];
  // A stylist asked for, or a level ("any master stylist"), or neither (anyone).
  staffId: string | null;
  level: StaffLevel | null;
  from: LocalDate;
  to: LocalDate;
  part: PartOfDay | null;
  // Local minutes: "after 3" or "before noon".
  after: number | null;
  before: number | null;
  // "The earliest…": soonest first.
  earliest: boolean;
};

export const MAX_PHONE_SERVICES = 4;
// How far ahead a search looks when no day is said.
export const DEFAULT_DAYS = 14;
// The longest range staff can search at once.
export const MAX_DAYS = 31;

// When, as the line says it; our code turns it into dates.
export type When =
  | { kind: "soon" }
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "this_week" }
  | { kind: "next_week" }
  | { kind: "weekend" }
  | { kind: "weekday"; weekday: number; next: boolean }
  | { kind: "date"; month: number; day: number };

export function datesFor(when: When, today: LocalDate): { from: LocalDate; to: LocalDate } {
  const monday = startOfWeek(today);
  switch (when.kind) {
    case "soon":
      return { from: today, to: addDays(today, DEFAULT_DAYS - 1) };
    case "today":
      return { from: today, to: today };
    case "tomorrow":
      return { from: addDays(today, 1), to: addDays(today, 1) };
    case "this_week":
      return { from: today, to: addDays(monday, 6) };
    case "next_week":
      return { from: addDays(monday, 7), to: addDays(monday, 13) };
    case "weekend": {
      const saturday = addDays(monday, 5);
      return { from: saturday < today ? today : saturday, to: addDays(monday, 6) };
    }
    case "weekday": {
      // The next one from today ("Tuesday"), or the one in next week ("next Tuesday").
      const ahead = (when.weekday - weekdayOf(today) + 7) % 7;
      const day = when.next ? addDays(monday, 7 + when.weekday - 1) : addDays(today, ahead);
      return { from: day, to: day };
    }
    case "date": {
      const year = Number(today.slice(0, 4));
      const pad = (n: number) => String(n).padStart(2, "0");
      let day = `${year}-${pad(when.month)}-${pad(when.day)}`;
      if (day < today) day = `${year + 1}-${pad(when.month)}-${pad(when.day)}`;
      return { from: day, to: day };
    }
  }
}

// The start window for the visit: the part of the day, narrowed by
// "after" and "before".
export function windowOf(r: Pick<PhoneRequest, "part" | "after" | "before">): { from: number; to: number } {
  const part = r.part ? PART_WINDOWS[r.part] : { from: 0, to: 24 * 60 - 1 };
  return { from: Math.max(part.from, r.after ?? 0), to: Math.min(part.to, r.before ?? 24 * 60) };
}

// Words that are about the booking, not anyone's name.
const BOOKING_WORDS = new Set(
  (
    "a an and the with for or to at on in of by from is as be it its this that same last time times next week weeks month day days " +
    "today tomorrow tonight morning mornings afternoon afternoons evening evenings night noon midday weekend weekends earliest soonest " +
    "asap soon first early late later after before around about any anyone anybody someone whoever available free open slot slots " +
    "please can could would like wants want needs need book booking appointment appt get do does also plus then usual again " +
    "monday mondays tuesday tuesdays wednesday wednesdays thursday thursdays friday fridays saturday saturdays sunday sundays " +
    "mon tue tues wed thu thur thurs fri sat sun jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july " +
    "august september october november december am pm o clock stylist stylists level levels master senior artisan hair " +
    "her his their them they she he him me my our client clients call calling called new regular haircut trim touch up only just " +
    "one two three four five six seven eight nine ten eleven twelve half quarter hour hours minutes min mins"
  ).split(" "),
);

const stem = (word: string) => word.toLowerCase().replace(/['’]s$/, "").replace(/[^a-z]/g, "");

// Every word the menu and team use, for telling a name from a request.
export function vocabularyOf(names: readonly string[]): Set<string> {
  const words = new Set(BOOKING_WORDS);
  for (const n of names) for (const w of n.split(/[\s/&(),.+-]+/)) if (stem(w)) words.add(stem(w)).add(stem(w).replace(/s$/, ""));
  return words;
}

// The client's name or phone in the line: digits that look like a phone
// number, else the words that aren't about the booking (only the
// capitalised ones, when some are: "Maria Lopez, balayage…").
export function clientWords(line: string, vocabulary: ReadonlySet<string>): string | null {
  const phone = line.match(/\+?\(?\d[\d\s().-]{6,}\d/);
  if (phone) return phone[0].trim();
  const words = line.split(/[\s,;:!?+/]+/).filter((w) => /^[\p{L}'’-]{2,}$/u.test(w));
  const unknown = words.filter((w) => {
    const s = stem(w);
    return s.length >= 2 && !vocabulary.has(s) && !vocabulary.has(s.replace(/s$/, ""));
  });
  const capitalised = unknown.filter((w) => /^\p{Lu}/u.test(w));
  const picked = capitalised.length ? capitalised : unknown;
  return picked.length ? picked.join(" ").slice(0, 100) : null;
}

// The line as Denise sees it: the client's name and any phone number or
// email taken out.
export function maskedLine(line: string, client: string | null): string {
  let masked = line.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]").replace(/\+?\(?\d[\d\s().-]{6,}\d/g, "[phone]");
  for (const word of client?.split(" ") ?? []) {
    if (!word || /^\d/.test(word)) continue;
    masked = masked.replace(new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}])`, "gu"), "$1[client]");
  }
  return masked.slice(0, 500);
}

// A follow-up ("what about Friday?", "with Bridget instead?", "mornings
// only"): the request on screen with only what it changes.
export function applyChange(current: PhoneRequest, change: BookingParse, today: LocalDate): PhoneRequest {
  const dates = change.when ? datesFor(change.when, today) : null;
  const timeSaid = change.anyTime || change.part !== null || change.after !== null || change.before !== null;
  const stylistSaid = change.anyStylist || change.staffId !== null || change.level !== null;
  return {
    ...current,
    serviceIds: change.serviceIds.length ? change.serviceIds.slice(0, MAX_PHONE_SERVICES) : current.serviceIds,
    staffId: stylistSaid ? change.staffId : current.staffId,
    level: stylistSaid ? (change.staffId ? null : change.level) : current.level,
    from: dates ? (dates.from < today ? today : dates.from) : current.from,
    to: dates ? dates.to : current.to,
    part: timeSaid ? change.part : current.part,
    after: timeSaid ? change.after : current.after,
    before: timeSaid ? change.before : current.before,
    earliest: change.earliest || current.earliest,
  };
}

const DAY_WORDS: Record<string, number> = { monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7 };

// Without Denise: what our code can tell from the line by itself, to start
// the form with (a stylist or service named in full, a weekday, a part of
// the day, "earliest", "tomorrow", "next week").
export function guessRequest(line: string, menu: { services: readonly { id: string; name: string }[]; stylists: readonly { id: string; firstName: string }[] }, clientText: string | null, today: LocalDate): PhoneRequest {
  const lower = ` ${line.toLowerCase().replace(/[^\p{L}\p{N}'’&/ ]+/gu, " ")} `;
  const has = (words: string) => lower.includes(` ${words.toLowerCase()} `);
  const words = lower.trim().split(/\s+/);
  const day = words.map((w) => DAY_WORDS[w.replace(/s$/, "")] ?? DAY_WORDS[w]).find(Boolean);
  const when: When = has("tomorrow")
    ? { kind: "tomorrow" }
    : has("today")
      ? { kind: "today" }
      : has("next week")
        ? { kind: "next_week" }
        : day
          ? { kind: "weekday", weekday: day, next: has("next") }
          : { kind: "soon" };
  const part = (["morning", "afternoon", "evening"] as const).find((p) => has(p) || has(`${p}s`)) ?? null;
  const serviceIds = menu.services.filter((s) => has(s.name)).map((s) => s.id);
  return requestFrom(
    {
      sameAsLast: has("same as last time"),
      serviceIds,
      staffId: menu.stylists.find((s) => has(s.firstName))?.id ?? null,
      level: null,
      when,
      part,
      after: null,
      before: null,
      earliest: has("earliest") || has("soonest") || has("asap"),
    },
    clientText,
    today,
  );
}

// Denise's reading of the line (or nothing, without her) as the fields.
export function requestFrom(
  parse: { sameAsLast: boolean; serviceIds: string[]; staffId: string | null; level: StaffLevel | null; when: When | null; part: PartOfDay | null; after: number | null; before: number | null; earliest: boolean } | null,
  clientText: string | null,
  today: LocalDate,
): PhoneRequest {
  const dates = datesFor(parse?.when ?? { kind: "soon" }, today);
  return {
    clientText,
    sameAsLast: parse?.sameAsLast ?? false,
    serviceIds: (parse?.serviceIds ?? []).slice(0, MAX_PHONE_SERVICES),
    staffId: parse?.staffId ?? null,
    level: parse?.staffId ? null : (parse?.level ?? null),
    from: dates.from < today ? today : dates.from,
    to: dates.to,
    part: parse?.part ?? null,
    after: parse?.after ?? null,
    before: parse?.before ?? null,
    earliest: parse?.earliest ?? false,
  };
}

export type PhoneStylist = { id: string; firstName: string; level: StaffLevel | null };

export type PhoneTimes = {
  options: Ranked[];
  // When nothing fits: the same ask on later days, and other stylists at
  // the same level as the one asked for.
  otherDays: Ranked[];
  sameLevel: Ranked[];
};

// How many days past the range "another day" looks.
export const LATER_DAYS = 14;

// The best times for the request, and the nearest alternatives when
// nothing fits. `ctx` covers the range and LATER_DAYS after it.
export function phoneTimes(
  ctx: BookingContext,
  r: PhoneRequest,
  deps: { stylists: readonly PhoneStylist[]; timingOf: VisitSearch["timingOf"]; habits: Habits; now: Date; laterThan?: { date: LocalDate; minute: number } | null },
): PhoneTimes {
  const names = new Map(deps.stylists.map((s) => [s.id, s.firstName]));
  const levelOf = new Map(deps.stylists.map((s) => [s.id, s.level]));
  const who = r.staffId ? [r.staffId] : r.level ? deps.stylists.filter((s) => s.level === r.level).map((s) => s.id) : deps.stylists.map((s) => s.id);
  const window = windowOf(r);
  // "Anything later?": only times after the latest one shown.
  const shownUpTo = deps.laterThan ?? null;
  const after = (c: Candidate) => !shownUpTo || c.date > shownUpTo.date || (c.date === shownUpTo.date && c.minute > shownUpTo.minute);
  const search = (staffIds: readonly string[], dates: LocalDate[]) =>
    searchVisits(ctx, { serviceIds: r.serviceIds, staffIds, dates, from: window.from, to: window.to, notBefore: deps.now, timingOf: deps.timingOf }).filter(after);
  const rank = (found: Candidate[], count = 3, earliest = r.earliest) => rankVisits(ctx, found, deps.habits, names, { earliest, count });

  const options = rank(search(who, datesBetween(r.from, r.to)));
  if (options.length) return { options, otherDays: [], sameLevel: [] };
  const later = datesBetween(addDays(r.to, 1), addDays(r.to, LATER_DAYS));
  const otherDays = rank(search(who, later), 2, true);
  const level = r.staffId ? levelOf.get(r.staffId) : null;
  const peers = level ? deps.stylists.filter((s) => s.level === level && s.id !== r.staffId).map((s) => s.id) : [];
  const sameLevel = peers.length ? rank(search(peers, datesBetween(r.from, r.to)), 2) : [];
  return { options, otherDays, sameLevel };
}
