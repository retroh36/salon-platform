// Booking by asking Denise: a line typed in her chat ("John Williams wants a
// cut with Gil on a Thursday morning", "earliest balayage with any senior
// next week", "Zoey, same as last time") and its follow-ups ("anything
// later?", "what about Friday?", "with Bridget instead?") become a booking
// card in the chat: the best times, each with a reason and a Book button,
// or the nearest alternatives, or a question (which John Williams? add him
// as a new client?), or a form when Denise can't read it.
//
// Claude only reads the line (./booking-request.ts); our code finds the
// client, works out the dates and finds the times with the booking rules
// (lib/phone-booking.ts, lib/scheduling/phone.ts), and writes what she
// says here. Everything that touches the database comes in as `deps`
// (./booking-load.ts), so this is testable without one.

import { applyChange, clientWords, guessRequest, maskedLine, requestFrom, vocabularyOf, type PhoneRequest } from "@/lib/phone-booking";
import type { LocalDate } from "@/lib/scheduling/time";
import { isMiss, type BookingMenu, type BookingParse, type ReadMiss } from "./booking-request";

export type ClientMatch = { id: string; name: string; phone: string | null; allergies: string | null; lastVisit: string | null };

export type LastVisit = { serviceIds: string[]; staffId: string | null; text: string };

export type ClientAlerts = {
  allergies: string | null;
  card: "on_file" | "none";
  repeatNoShow: boolean;
  policyNote: string | null;
  last: LastVisit | null;
};

export type SlotLine = { serviceId: string; staffId: string; startMinute: number; minutes: number; usual: boolean; priceCents: number };
export type BookingSlot = {
  date: LocalDate;
  // "Tue, Nov 3 · 2:15pm–5:05pm"
  when: string;
  // "Balayage, then Women's Cut & Style with Bridget"
  what: string;
  reason: string;
  priceCents: number;
  lines: SlotLine[];
};

export type TimesFound = {
  options: BookingSlot[];
  otherDays: BookingSlot[];
  sameLevel: BookingSlot[];
  // "Tue, Nov 3 to Mon, Nov 9, afternoons"
  searched: string;
  lengths: string | null;
  // Why it couldn't be searched ("Those days have passed.").
  problem?: string;
};

// The card under what Denise says.
export type BookingCard =
  | ({ kind: "times"; request: PhoneRequest; client: ClientMatch | null; alerts: ClientAlerts | null } & TimesFound)
  | { kind: "which_client"; request: PhoneRequest; matches: ClientMatch[] }
  | { kind: "new_client"; request: PhoneRequest; firstName: string; lastName: string; phone: string }
  // The menu comes with the form, for its lists on any page.
  | { kind: "form"; request: PhoneRequest; client: ClientMatch | null; menu: BookingMenu };

export type BookingReply = { text: string; card: BookingCard };

// What the chat sends back with a follow-up: the request on screen, its
// client and the times shown (for "anything later?").
export type BookingState = { request: PhoneRequest; clientId: string | null; shown: { date: LocalDate; minute: number }[] };

export type BookingDeps = {
  today: LocalDate;
  menu: BookingMenu;
  // Denise reading the masked line, or why she can't (offline, the daily
  // limit, an answer that doesn't check out).
  read: (masked: string, current: PhoneRequest | null) => Promise<BookingParse | ReadMiss>;
  findClients: (text: string) => Promise<ClientMatch[]>;
  clientById: (id: string) => Promise<ClientMatch | null>;
  lastVisit: (clientId: string) => Promise<LastVisit | null>;
  alerts: (clientId: string) => Promise<ClientAlerts | null>;
  times: (request: PhoneRequest, clientId: string | null, laterThan: { date: LocalDate; minute: number } | null) => Promise<TimesFound>;
};

const QUESTION = /^(how|why|what|who|whom|whose|which|when|where|is|are|does|do|did|am|was|were|should|tell|show|list)\b/i;
const BOOKING_WORDS = /\b(book|booking|appointment|appt|slot|opening|earliest|soonest|asap|same as last time|wants?|needs?|come in|fit (?:him|her|them) in)\b/i;

// Worth asking Denise whether it's a booking: something on screen to follow
// up, or a line that isn't a question and talks about booking or a service.
export function mightBeBooking(line: string, menu: BookingMenu, current: boolean): boolean {
  if (current) return true;
  if (QUESTION.test(line.trim())) return false;
  return BOOKING_WORDS.test(line) || mentionsService(line, menu);
}

function mentionsService(line: string, menu: BookingMenu): boolean {
  const words = new Set(
    menu.services
      .flatMap((s) => `${s.name} ${s.category}`.toLowerCase().split(/[^a-z]+/))
      .map((w) => w.replace(/s$/, ""))
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
  return line
    .toLowerCase()
    .split(/[^a-z'’]+/)
    .some((w) => words.has(w.replace(/['’]s$/, "").replace(/s$/, "")));
}
// Words in service names that don't say which service.
const STOP = new Set(["and", "the", "with", "style", "women", "men", "kid", "full", "partial", "add", "short", "long", "hair", "new", "client", "service", "treatment"]);

const firstOf = (name: string) => name.split(" ")[0];
const WAYS = (n: number) => (n === 1 ? "one client" : n === 2 ? "two clients" : `${n} clients`);

// One turn of the chat, or null when the line isn't a booking (Ask Denise
// answers it as a question). `pageClientId` is the client on the page staff
// are looking at, for "book her a gloss on Friday".
export async function bookingTurn(line: string, current: BookingState | null, pageClientId: string | null, deps: BookingDeps): Promise<BookingReply | null> {
  const text = line.trim().slice(0, 500);
  if (!text || !mightBeBooking(text, deps.menu, Boolean(current))) return null;
  const vocabulary = vocabularyOf([...deps.menu.services.flatMap((s) => [s.name, s.category]), ...deps.menu.stylists.map((m) => m.firstName)]);
  const named = clientWords(text, vocabulary);
  const parse = await deps.read(maskedLine(text, named), current?.request ?? null);

  // Without her: a form, started from what our code can tell, saying why,
  // unless it was only ever a follow-up (that needs her) or plainly not
  // about booking.
  if (isMiss(parse)) {
    if (QUESTION.test(text) || !(BOOKING_WORDS.test(text) || mentionsService(text, deps.menu))) return null;
    const request = guessRequest(text, deps.menu, named, deps.today);
    const client = await clientFor(named, pageClientId, deps);
    if (client.kind !== "found") return client.reply(request);
    return { text: MISSED[parse.missed], card: { kind: "form", request, client: client.match, menu: menuOf(deps) } };
  }
  if (parse.intent === "other") return null;

  if (parse.intent === "change" && current) {
    const request = applyChange(current.request, parse, deps.today);
    const later = parse.later ? latestOf(current.shown) : null;
    const client = current.clientId ? await deps.clientById(current.clientId) : null;
    return timesFor(request, client, deps, later);
  }

  const request = requestFrom(parse, named, deps.today);
  const client = await clientFor(named, pageClientId, deps);
  if (client.kind !== "found") return client.reply(request);
  return withClient(request, client.match, deps);
}

// Why there's a form instead of times, in plain words.
export const MISSED: Record<ReadMiss["missed"], string> = {
  offline: "I'm offline right now, so fill in what the client wants and I'll find the best times.",
  limit: "I've reached today's limit, so fill in what the client wants and I'll find the best times.",
  unclear: "I didn't catch that, so fill in what the client wants and I'll find the best times.",
};

// The client for the line: by name or phone, else the one on the page.
async function clientFor(
  named: string | null,
  pageClientId: string | null,
  deps: BookingDeps,
): Promise<{ kind: "found"; match: ClientMatch | null } | { kind: "ask"; reply: (request: PhoneRequest) => BookingReply }> {
  if (!named) return { kind: "found", match: pageClientId ? await deps.clientById(pageClientId) : null };
  const matches = await deps.findClients(named);
  const picked = pickClient(named, matches);
  if (picked) return { kind: "found", match: picked };
  if (!matches.length) {
    const phone = /\d/.test(named) ? named : "";
    const [first = "", ...rest] = phone ? [] : named.split(/\s+/).map(capitalise);
    const who = phone || named.split(/\s+/).map(capitalise).join(" ");
    return {
      kind: "ask",
      reply: (request) => ({
        text: `${who} isn't on file yet. Add them as a new client, and I'll find the times.`,
        card: { kind: "new_client", request, firstName: first, lastName: rest.join(" "), phone },
      }),
    };
  }
  const name = /\d/.test(named) ? "with that number" : `called ${named.split(/\s+/).map(capitalise).join(" ")}`;
  return {
    kind: "ask",
    reply: (request) => ({ text: `I found ${WAYS(matches.length)} ${name}. Which one is it?`, card: { kind: "which_client", request, matches } }),
  };
}

// Just the lists (the loaded menu also has prices, which stay on the server).
const menuOf = (deps: BookingDeps): BookingMenu => ({
  services: deps.menu.services.map(({ id, name, category }) => ({ id, name, category })),
  stylists: deps.menu.stylists.map(({ id, firstName, level }) => ({ id, firstName, level })),
});

const capitalise = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);

// One client when the name says which: the only match, or the only one
// with every word typed as their first or last name.
export function pickClient(named: string, matches: readonly ClientMatch[]): ClientMatch | null {
  if (matches.length === 1) return matches[0];
  if (/\d/.test(named)) return null;
  const words = named.toLowerCase().split(/\s+/);
  const exact = matches.filter((m) => {
    const parts = m.name.toLowerCase().split(/\s+/);
    return words.every((w) => parts.includes(w));
  });
  // "Maria" with one Maria Lopez and a Mariana: the whole first name wins;
  // "John Williams" twice: ask.
  return exact.length === 1 ? exact[0] : null;
}

// Once the client is known (or there isn't one): "same as last time", then
// the times, or the form when it doesn't say which service.
export async function withClient(request: PhoneRequest, client: ClientMatch | null, deps: BookingDeps): Promise<BookingReply> {
  let r = request;
  let note: string | null = null;
  if (r.sameAsLast && client) {
    const last = await deps.lastVisit(client.id);
    if (last) {
      r = { ...r, serviceIds: r.serviceIds.length ? r.serviceIds : last.serviceIds, staffId: r.staffId || r.level ? r.staffId : last.staffId };
      note = `Same as last time: ${last.text}.`;
    } else note = `I couldn't find a finished visit for ${firstOf(client.name)}.`;
  }
  if (!r.serviceIds.length) {
    return { text: [note, client ? `Which service would ${firstOf(client.name)} like?` : "Which service, and for whom?"].filter(Boolean).join(" "), card: { kind: "form", request: r, client, menu: menuOf(deps) } };
  }
  const reply = await timesFor(r, client, deps, null);
  return note ? { ...reply, text: `${note} ${reply.text}` } : reply;
}

async function timesFor(request: PhoneRequest, client: ClientMatch | null, deps: BookingDeps, later: { date: LocalDate; minute: number } | null): Promise<BookingReply> {
  const [found, alerts] = await Promise.all([deps.times(request, client?.id ?? null, later), client ? deps.alerts(client.id) : Promise.resolve(null)]);
  if (found.problem) return { text: found.problem, card: { kind: "form", request, client, menu: menuOf(deps) } };
  const who = client ? ` for ${firstOf(client.name)}` : "";
  let text: string;
  if (found.options.length) text = later ? `Here are later times${who}.` : `Here are the best times${who}, ${found.searched}.`;
  else {
    const alternatives = [found.otherDays.length && "another day", found.sameLevel.length && "another stylist at the same level"].filter(Boolean);
    text = `Nothing fits${later ? " later than that" : ""} ${found.searched}. ${alternatives.length ? `The closest I found are on ${alternatives.join(" and with ")}, or add ${client ? firstOf(client.name) : "them"} to the waitlist.` : `Try other days, or add ${client ? firstOf(client.name) : "them"} to the waitlist.`}`;
  }
  return { text, card: { kind: "times", request, client, alerts, ...found } };
}

// The latest time shown, for "anything later?".
function latestOf(shown: readonly { date: LocalDate; minute: number }[]): { date: LocalDate; minute: number } | null {
  return shown.reduce<{ date: LocalDate; minute: number } | null>((max, s) => (!max || s.date > max.date || (s.date === max.date && s.minute > max.minute) ? s : max), null);
}

// What the chat sends back after a booking card, so a follow-up knows what
// it's changing.
export function stateOf(card: BookingCard): BookingState {
  const shown = card.kind === "times" ? [...card.options, ...card.otherDays, ...card.sameLevel].map((o) => ({ date: o.date, minute: o.lines[0].startMinute })) : [];
  const clientId = card.kind === "times" || card.kind === "form" ? (card.client?.id ?? null) : null;
  return { request: card.request, clientId, shown };
}
