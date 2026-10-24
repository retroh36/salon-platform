// Marketing automations (pure, unit-tested; they run under plain Node in
// the nightly job, so relative .ts imports): who's due for each message,
// the salon's own templates filled in by our code (never AI-written), the
// channel each client has said yes to, quiet hours, and the results.

import { addDays, type LocalDate } from "./scheduling/time.ts";

export const AUTOMATION_KINDS = ["rebook", "win_back", "birthday", "review"] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

export const AUTOMATION_LABELS: Record<AutomationKind, string> = {
  rebook: "Rebook reminder",
  win_back: "Win-back",
  birthday: "Birthday",
  review: "Review request",
};

export const AUTOMATION_DESCRIPTIONS: Record<AutomationKind, string> = {
  rebook: "When a client passes their usual return time with nothing booked: a nudge with your booking link.",
  win_back: "When a client hasn't been back in a set number of weeks: an invitation to return.",
  birthday: "On (or just before) a client's birthday, with an optional offer.",
  review: "A few hours after checkout: a thank-you with links to your Google and Yelp pages.",
};

export type Channel = "sms" | "email";

export type AutomationSettings = {
  // Which channel to use when the client has said yes to both.
  prefer: Channel;
  // rebook: days past their usual return time.
  daysAfterDue?: number;
  // win_back: weeks since their last visit.
  weeks?: number;
  // birthday: days ahead of it, and an optional offer line.
  daysBefore?: number;
  offer?: string;
  // review: hours after checkout.
  hoursAfter?: number;
};

export type Automation = { kind: AutomationKind; enabled: boolean; subject: string; body: string; settings: AutomationSettings };

export const DEFAULT_AUTOMATIONS: Record<AutomationKind, Omit<Automation, "kind" | "enabled">> = {
  rebook: {
    subject: "Time for your next visit to {salon}?",
    body: "Hi {first_name}, it's been a little while since your last visit to {salon}. Ready for your next one? Book in a minute: {booking_link}",
    settings: { prefer: "sms", daysAfterDue: 7 },
  },
  win_back: {
    subject: "We miss you at {salon}",
    body: "Hi {first_name}, we haven't seen you at {salon} in a while, and we'd love to have you back. Book whenever suits you: {booking_link}",
    settings: { prefer: "email", weeks: 12 },
  },
  birthday: {
    subject: "Happy birthday from {salon}",
    body: "Happy birthday, {first_name}! Everyone at {salon} wishes you a wonderful day. {offer}",
    settings: { prefer: "sms", daysBefore: 0, offer: "" },
  },
  review: {
    subject: "How was your visit to {salon}?",
    body: "Thanks for coming in today, {first_name}! If you have a moment, a review helps us a lot: {review_links}",
    settings: { prefer: "sms", hoursAfter: 3 },
  },
};

// The fields a template can use, filled in by our code.
export const TEMPLATE_FIELDS: Record<AutomationKind, string[]> = {
  rebook: ["first_name", "salon", "booking_link", "stylist"],
  win_back: ["first_name", "salon", "booking_link", "stylist"],
  birthday: ["first_name", "salon", "booking_link", "offer"],
  review: ["first_name", "salon", "review_links", "stylist"],
};

export type TemplateValues = Partial<Record<string, string>>;

// Fills in {field}s and tidies the spaces an empty field leaves.
export function renderTemplate(text: string, values: TemplateValues): string {
  return text
    .replace(/\{([a-z_]+)\}/g, (_, field: string) => values[field] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,!?])/g, "$1")
    .trim();
}

// Anything in braces that isn't a field this message can use.
export function unknownFields(text: string, kind: AutomationKind): string[] {
  return [...new Set([...text.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((f) => !TEMPLATE_FIELDS[kind].includes(f)))];
}

// The opt-out every message ends with (not part of the editable template).
export function withOptOut(body: string, channel: Channel, optOutUrl: string): string {
  return channel === "sms" ? `${body}\n\nReply STOP or tap ${optOutUrl} to stop these texts.` : `${body}\n\nDon't want these emails? Unsubscribe: ${optOutUrl}`;
}

export type Contact = { phone: string | null; email: string | null; smsOptIn: boolean; emailOptIn: boolean };

// The channel to use: the preferred one if they've said yes to it, else the
// other one they've said yes to; none if they've said yes to neither.
export function channelFor(c: Contact, prefer: Channel): { channel: Channel; to: string } | null {
  const sms = c.smsOptIn && c.phone ? { channel: "sms" as const, to: c.phone } : null;
  const email = c.emailOptIn && c.email ? { channel: "email" as const, to: c.email } : null;
  return prefer === "sms" ? (sms ?? email) : (email ?? sms);
}

// Messages go out between 9am and 8pm at the salon, never overnight.
export const SEND_FROM_MINUTE = 9 * 60;
export const SEND_UNTIL_MINUTE = 20 * 60;
export const canSendAt = (localMinute: number) => localMinute >= SEND_FROM_MINUTE && localMinute < SEND_UNTIL_MINUTE;

// At most one rebook, win-back or birthday message per client a week.
export const QUIET_DAYS = 7;

export type ClientFacts = Contact & {
  id: string;
  firstName: string;
  birthMonth: number | null;
  birthDay: number | null;
  // From what Denise has learned (lib/insights/clients.ts).
  due: string | null;
  overdueDays: number;
  nextDue: string | null;
  lastVisit: string | null;
  preferredStaffId: string | null;
  // Anything booked from today on (checked live, not from insights).
  hasUpcoming: boolean;
  // When they last got a rebook, win-back or birthday message.
  lastMessagedAt: string | null;
};

const daysBetween = (a: LocalDate, b: LocalDate) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// Whether a client's birthday falls on a date (Feb 29 birthdays on Feb 28
// in other years).
export function birthdayOn(month: number, day: number, date: LocalDate): boolean {
  const [y, m, d] = date.split("-").map(Number);
  if (month === 2 && day === 29 && !isLeap(y)) return m === 2 && d === 28;
  return month === m && day === d;
}

// Is this client due for this message today? The occasion's key (one
// message each) if so.
export function dueFor(kind: Exclude<AutomationKind, "review">, c: ClientFacts, settings: AutomationSettings, today: LocalDate, now: Date): string | null {
  if (c.lastMessagedAt && now.getTime() - Date.parse(c.lastMessagedAt) < QUIET_DAYS * 86_400_000) return null;
  if (kind === "birthday") {
    if (c.birthMonth === null || c.birthDay === null) return null;
    const target = addDays(today, settings.daysBefore ?? 0);
    return birthdayOn(c.birthMonth, c.birthDay, target) ? `birthday:${target.slice(0, 4)}` : null;
  }
  if (c.hasUpcoming || !c.lastVisit) return null;
  const last = c.lastVisit.slice(0, 10);
  if (kind === "win_back") {
    return daysBetween(last, today) >= (settings.weeks ?? 12) * 7 ? `win_back:${last}` : null;
  }
  // Rebook: past their usual return (not so long that it's a win-back).
  if (c.due !== "overdue" || !c.nextDue) return null;
  return c.overdueDays >= (settings.daysAfterDue ?? 7) ? `rebook:${c.nextDue.slice(0, 10)}` : null;
}

// A visit is due a review request this many hours after checkout, for a
// day after that (so a late run never sends one days later).
export function reviewDue(checkedOutAt: string, settings: AutomationSettings, now: Date): boolean {
  const after = Date.parse(checkedOutAt) + (settings.hoursAfter ?? 3) * 3_600_000;
  return now.getTime() >= after && now.getTime() < after + 24 * 3_600_000;
}

// What's wrong with an automation as set up, first thing first (it can't
// be turned on until it's right).
export function automationProblems(a: Pick<Automation, "kind" | "subject" | "body" | "settings">, salon: { bookingLive: boolean; googleUrl: string | null; yelpUrl: string | null }): string[] {
  const problems: string[] = [];
  if (!a.subject.trim()) problems.push("Add a subject for the email.");
  if (!a.body.trim()) problems.push("Write the message.");
  if (a.body.length > 1000) problems.push("Keep the message under 1,000 characters.");
  const unknown = [...unknownFields(a.subject, a.kind), ...unknownFields(a.body, a.kind)];
  if (unknown.length) problems.push(`These aren't fields this message can use: ${unknown.map((f) => `{${f}}`).join(", ")}.`);
  if ((a.body.includes("{booking_link}") || a.subject.includes("{booking_link}")) && !salon.bookingLive) problems.push("Turn on online booking first (Settings → Online booking), or take out {booking_link}.");
  if (a.kind === "review" && !salon.googleUrl && !salon.yelpUrl) problems.push("Add your Google or Yelp review link.");
  const s = a.settings;
  if (a.kind === "rebook" && !(Number.isInteger(s.daysAfterDue) && s.daysAfterDue! >= 0 && s.daysAfterDue! <= 60)) problems.push("Send it 0 to 60 days after they're due.");
  if (a.kind === "win_back" && !(Number.isInteger(s.weeks) && s.weeks! >= 4 && s.weeks! <= 104)) problems.push("Win-back is for clients away 4 to 104 weeks.");
  if (a.kind === "birthday" && !(Number.isInteger(s.daysBefore) && s.daysBefore! >= 0 && s.daysBefore! <= 14)) problems.push("Send it 0 to 14 days before the birthday.");
  if (a.kind === "birthday" && (s.offer ?? "").length > 200) problems.push("Keep the offer under 200 characters.");
  if (a.kind === "review" && !(Number.isInteger(s.hoursAfter) && s.hoursAfter! >= 1 && s.hoursAfter! <= 48)) problems.push("Send it 1 to 48 hours after checkout.");
  return problems;
}

// "Google: https://… · Yelp: https://…"
export const reviewLinks = (googleUrl: string | null, yelpUrl: string | null) => [googleUrl && `Google: ${googleUrl}`, yelpUrl && `Yelp: ${yelpUrl}`].filter(Boolean).join(" · ");

// The preview: the message for a sample client, as it would go out.
export function previewMessage(a: Pick<Automation, "kind" | "subject" | "body" | "settings">, salon: { name: string; bookingUrl: string; googleUrl: string | null; yelpUrl: string | null }, channel: Channel) {
  const values = sampleValues(a, salon);
  return { subject: renderTemplate(a.subject, values), body: withOptOut(renderTemplate(a.body, values), channel, `${salon.bookingUrl.replace(/\/book\/.*$/, "")}/unsubscribe/…`) };
}

export function sampleValues(a: Pick<Automation, "kind" | "settings">, salon: { name: string; bookingUrl: string; googleUrl: string | null; yelpUrl: string | null }, client = { firstName: "Ava", stylist: "Bridget" }): TemplateValues {
  return {
    first_name: client.firstName,
    salon: salon.name,
    booking_link: `${salon.bookingUrl}?src=${a.kind}`,
    stylist: client.stylist,
    offer: a.kind === "birthday" ? (a.settings.offer ?? "") : "",
    review_links: reviewLinks(salon.googleUrl, salon.yelpUrl),
  };
}

// Results: of the messages sent, how many clients booked within two weeks
// after (by any channel), and what those visits brought in.
export const BOOKED_WITHIN_DAYS = 14;

export type SentMessage = { id: string; kind: AutomationKind; clientId: string; sentAt: string; optedOut: boolean };
export type Booking = { appointmentId: string; clientId: string; createdAt: string; revenueCents: number };

export function automationResults(messages: readonly SentMessage[], bookings: readonly Booking[]) {
  const out = Object.fromEntries(AUTOMATION_KINDS.map((k) => [k, { sent: 0, booked: 0, revenueCents: 0, optedOut: 0 }])) as Record<AutomationKind, { sent: number; booked: number; revenueCents: number; optedOut: number }>;
  const credited = new Set<string>();
  // Oldest first, so a booking counts for the message that led to it.
  for (const m of [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))) {
    const r = out[m.kind];
    r.sent += 1;
    if (m.optedOut) r.optedOut += 1;
    const sent = Date.parse(m.sentAt);
    const booking = bookings
      .filter((b) => b.clientId === m.clientId && !credited.has(b.appointmentId))
      .filter((b) => Date.parse(b.createdAt) >= sent && Date.parse(b.createdAt) < sent + BOOKED_WITHIN_DAYS * 86_400_000)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (booking) {
      credited.add(booking.appointmentId);
      r.booked += 1;
      r.revenueCents += booking.revenueCents;
    }
  }
  return out;
}

// Denise's suggestions: which automations would help, from the salon's own
// numbers (worded by our code, approved by an owner).
export type SalonFacts = { overdue: number; lapsed: number; birthdays: number; checkoutsLast30: number; reachable: number; hasReviewLink: boolean };

export function suggestAutomations(facts: SalonFacts, enabled: ReadonlySet<AutomationKind>): { kind: AutomationKind; summary: string; reason: string }[] {
  const out: { kind: AutomationKind; summary: string; reason: string }[] = [];
  if (!facts.reachable) return out;
  if (!enabled.has("rebook") && facts.overdue >= 5)
    out.push({ kind: "rebook", summary: "Turn on rebook reminders", reason: `${facts.overdue} regulars are past their usual return with nothing booked. A reminder brings many of them back without anyone at the desk having to call.` });
  if (!enabled.has("review") && facts.checkoutsLast30 >= 20 && facts.hasReviewLink)
    out.push({ kind: "review", summary: "Turn on review requests", reason: `${facts.checkoutsLast30} visits were checked out in the last 30 days. Asking a few hours later, while it's fresh, is when clients are most likely to leave a review.` });
  if (!enabled.has("win_back") && facts.lapsed >= 10)
    out.push({ kind: "win_back", summary: "Turn on win-back messages", reason: `${facts.lapsed} clients haven't been back in a long while. A friendly note is the easiest way to win some of them back.` });
  if (!enabled.has("birthday") && facts.birthdays >= 10)
    out.push({ kind: "birthday", summary: "Turn on birthday messages", reason: `${facts.birthdays} clients have a birthday on file. A birthday note (with an offer, if you like) is a warm reason to come in.` });
  return out;
}
