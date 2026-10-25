// What a one-line description of an event says ("June 14 wedding, ready by
// 2pm, bride plus 5 bridesmaids hair and makeup, at the Grand Hotel"), and
// the event draft our code builds from it (pure). Denise's Claude reads the
// line when she's connected (lib/denise/event-draft.ts) and returns the
// same shape, only what was said, never a number she worked out;
// without her, `parseDescription` reads it. Either way `draftFrom` picks the
// packages, names the party and leaves the rest (the timeline, team and
// price) to the builder, so staff see and change everything before saving.

import type { LocalDate } from "../scheduling/time.ts";
import { PARTY_ROLE_LABELS, type EventPackage, type PartyMember, type PartyRole } from "./types.ts";

export type ServiceWanted = "hair" | "makeup" | "hair_makeup";

export type EventDescription = {
  // As said: month 1–12 and day, the year only if given.
  month: number | null;
  day: number | null;
  year: number | null;
  // Ready-by, 24-hour.
  readyHour: number | null;
  readyMinute: number | null;
  venue: string | null;
  // Said to be at the salon.
  inSalon: boolean;
  kind: string | null;
  // The family or person it's for ("Rossi").
  name: string | null;
  groups: { partyRole: PartyRole; count: number; services: ServiceWanted | null }[];
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const KINDS = ["wedding", "engagement", "prom", "quinceañera", "quinceanera", "bat mitzvah", "bar mitzvah", "shoot", "party", "gala", "event"];

// Who's in the party, and the words for them (plural forms too).
const ROLE_WORDS: [PartyRole, RegExp][] = [
  ["maid_of_honor", /maids? of honou?r|matrons? of honou?r|moh\b/],
  ["mother", /mothers? of the (?:bride|groom)|mom of the bride|moms?\b|mothers?\b|mob\b/],
  ["flower_girl", /flower ?girls?/],
  ["bridesmaid", /bridesmaids?|brides ?maids?/],
  ["bride", /brides?\b/],
  ["groom", /grooms?\b/],
  ["guest", /guests?\b|people\b|others?\b/],
];

const SERVICE_RE = /\b(hair\s*(?:and|&|\+|plus)\s*make-?\s?up|make-?\s?up\s*(?:and|&|\+|plus)\s*hair|hair(?:\s+only)?|make-?\s?up(?:\s+only)?)\b/;

function serviceOf(text: string): ServiceWanted {
  const t = text.replace(/\s+/g, " ");
  if (/hair.*make|make.*hair/.test(t)) return "hair_makeup";
  return /make/.test(t) ? "makeup" : "hair";
}

export function parseDescription(line: string): EventDescription {
  const text = ` ${line.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ")} `;
  const out: EventDescription = { month: null, day: null, year: null, readyHour: null, readyMinute: null, venue: null, inSalon: false, kind: null, name: null, groups: [] };

  // The date: "June 14", "14 June", "Jun 14th, 2027", "6/14".
  const monthFirst = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  const dayFirst = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?\b/);
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (monthFirst) {
    out.month = MONTHS.indexOf(monthFirst[1].slice(0, 3)) + 1;
    out.day = Number(monthFirst[2]);
    out.year = monthFirst[3] ? Number(monthFirst[3]) : null;
  } else if (dayFirst) {
    out.month = MONTHS.indexOf(dayFirst[2].slice(0, 3)) + 1;
    out.day = Number(dayFirst[1]);
    out.year = dayFirst[3] ? Number(dayFirst[3]) : null;
  } else if (numeric) {
    out.month = Number(numeric[1]);
    out.day = Number(numeric[2]);
    out.year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : null;
  }

  // Ready by: "ready by 2pm", "ready at 2:30 pm", "done by 11am", "by noon".
  const ready = text.match(/\b(?:ready|done|finished|photos?)?\s*(?:by|at|for)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/) ?? text.match(/\b(?:ready|done)\s+(?:by|at)\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (/\b(?:ready|done) (?:by|at) noon\b/.test(text)) {
    out.readyHour = 12;
    out.readyMinute = 0;
  } else if (ready) {
    let hour = Number(ready[1]) % 12;
    const meridiem = ready[3]?.[0];
    if (meridiem === "p") hour += 12;
    // No am/pm: a wedding is ready in the day (7 to 11 is morning, else afternoon).
    if (!meridiem && hour < 7) hour += 12;
    out.readyHour = hour;
    out.readyMinute = ready[2] ? Number(ready[2]) : 0;
  }

  // Where: "at the Grand Hotel", "at Lakeside Barn", "in salon".
  if (/\b(?:in|at) (?:the )?salon\b|\bin-salon\b/.test(text)) out.inSalon = true;
  const venue = line.match(/\b(?:at|@)\s+((?:the\s+)?[A-Z][\w'&.-]*(?:\s+(?:[A-Z0-9&][\w'&.-]*|of|on|the|de|la))*)/);
  if (venue && !/^(?:the\s+)?salon$/i.test(venue[1])) out.venue = venue[1].replace(/^the\s+/i, (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()).trim();

  out.kind = KINDS.find((k) => text.includes(` ${k}`)) ?? null;
  if (out.kind === "quinceanera") out.kind = "quinceañera";
  const name = line.match(/\b([A-Z][a-z'-]+)(?:\s+family)?(?:'s)?\s+(?:wedding|party|event|shoot|engagement)\b/) ?? line.match(/\bfor\s+([A-Z][a-z'-]+)\b/);
  if (name && !MONTHS.includes(name[1].slice(0, 3).toLowerCase())) out.name = name[1];

  // The party, in the order said; a service applies to everyone named
  // since the last service ("bride plus 5 bridesmaids hair and makeup").
  const parts = text.split(/,|;|\band\b(?=\s+(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|the)?\s*(?:brides?|bridesmaids?|maids?|matrons?|mothers?|moms?|flower|grooms?|guests?))|\bplus\b|\bwith\b|\+/);
  let open: EventDescription["groups"] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const role = ROLE_WORDS.find(([, re]) => re.test(part));
    if (role) {
      const before = part.slice(0, part.search(role[1])).trim().split(" ").at(-1) ?? "";
      const n = /^\d+$/.test(before) ? Number(before) : (NUMBER_WORDS[before] ?? 1);
      const group = { partyRole: role[0], count: Math.min(Math.max(n, 1), 30), services: null as ServiceWanted | null };
      // "the bride" or a role named again adds to who's there.
      const same = out.groups.find((g) => g.partyRole === group.partyRole && g.services === null && open.includes(g));
      if (same && group.partyRole !== "bride") same.count += group.count;
      else if (!(group.partyRole === "bride" && out.groups.some((g) => g.partyRole === "bride"))) {
        out.groups.push(group);
        open.push(group);
      }
    }
    const service = part.match(SERVICE_RE);
    if (service) {
      const wanted = serviceOf(service[1]);
      for (const g of open) g.services = wanted;
      open = [];
    }
  }
  return out;
}

// The date the description means: the next one on or after today, or the
// year given.
export function dateOf(d: Pick<EventDescription, "month" | "day" | "year">, today: LocalDate): LocalDate | null {
  if (!d.month || !d.day || d.month > 12 || d.day > 31) return null;
  const ymd = (y: number) => `${y}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  const valid = (s: string) => {
    const dt = new Date(`${s}T12:00:00Z`);
    return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === s;
  };
  const thisYear = Number(today.slice(0, 4));
  if (d.year) return valid(ymd(d.year)) ? ymd(d.year) : null;
  for (const y of [thisYear, thisYear + 1]) if (valid(ymd(y)) && ymd(y) >= today) return ymd(y);
  return null;
}

// The package for someone: their role's package for the services wanted,
// else any package with those services, else their role's, else the first.
export function packageFor(role: PartyRole, wanted: ServiceWanted | null, packages: readonly EventPackage[]): EventPackage | null {
  const list = packages.filter((p) => p.isActive && !p.isTrial);
  const fits = (p: EventPackage) =>
    !wanted || (wanted === "hair_makeup" ? p.hairMinutes > 0 && p.makeupMinutes > 0 : wanted === "hair" ? p.hairMinutes > 0 && p.makeupMinutes === 0 : p.makeupMinutes > 0 && p.hairMinutes === 0);
  const similar: PartyRole[] = role === "maid_of_honor" || role === "guest" ? [role, "bridesmaid"] : [role];
  for (const r of similar) {
    const own = list.find((p) => p.partyRole === r && fits(p));
    if (own) return own;
  }
  return list.find((p) => fits(p) && p.partyRole !== "bride" && p.partyRole !== "flower_girl") ?? list.find((p) => p.partyRole === role) ?? list[0] ?? null;
}

export type EventDraft = {
  title: string;
  date: LocalDate | null;
  readyBy: number | null;
  venue: string;
  onLocation: boolean;
  members: PartyMember[];
};

// The draft for the builder from what was said.
export function draftFrom(d: EventDescription, packages: readonly EventPackage[], today: LocalDate): EventDraft {
  const members: PartyMember[] = [];
  // The bride first, then everyone in the order said.
  const groups = [...d.groups].sort((a, b) => Number(b.partyRole === "bride") - Number(a.partyRole === "bride"));
  for (const g of groups) {
    const pkg = packageFor(g.partyRole, g.services ?? (g.partyRole === "flower_girl" ? "hair" : null), packages);
    for (let i = 1; i <= g.count; i++) {
      const label = PARTY_ROLE_LABELS[g.partyRole];
      members.push({ name: g.count > 1 ? `${label} ${i}` : label, partyRole: g.partyRole, packageId: pkg?.id ?? "", paysOwn: false, email: "", phone: "" });
    }
  }
  const date = dateOf(d, today);
  const kind = d.kind ?? (members.some((m) => m.partyRole === "bride") ? "wedding" : "event");
  const when = date ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;
  return {
    title: d.name ? `${d.name} ${kind}` : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}${when ? ` on ${when}` : ""}`,
    date,
    readyBy: d.readyHour != null ? d.readyHour * 60 + (d.readyMinute ?? 0) - ((d.readyMinute ?? 0) % 5) : null,
    venue: d.inSalon ? "" : (d.venue ?? ""),
    onLocation: !d.inSalon && Boolean(d.venue),
    members,
  };
}

