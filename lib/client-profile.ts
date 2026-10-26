// The client profile's facts (pure, unit-tested): the tags in its header,
// the visits in the Visits tab (upcoming first, then past) and the numbers
// in its side column. Loading is in `app/clients/[id]/page.tsx`.

import type { Tone } from "@/components/ui/page";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";

export const PROFILE_TABS = ["visits", "formulas", "photos", "patch", "forms"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];
// The last tab used, per device, so the next profile opens on it.
export const PROFILE_TAB_COOKIE = "maestra_client_tab";

export function profileTab(value: string | undefined): ProfileTab {
  return PROFILE_TABS.includes(value as ProfileTab) ? (value as ProfileTab) : "visits";
}

export type ProfileVisit = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  // "Balayage · Gil", one per service, in order.
  services: { name: string; staff: string }[];
  // From the visit's sale, when this person can see sales (front of house).
  totalCents: number | null;
  tipCents: number | null;
};

const UPCOMING = ["booked", "confirmed", "checked_in"];

// Upcoming visits (not over yet, still on), soonest first; then the rest,
// newest first.
export function splitVisits(visits: ProfileVisit[], now: Date): { upcoming: ProfileVisit[]; past: ProfileVisit[] } {
  const isUpcoming = (v: ProfileVisit) => UPCOMING.includes(v.status) && new Date(v.endsAt) >= now;
  return {
    upcoming: visits.filter(isUpcoming).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    past: visits.filter((v) => !isUpcoming(v)).sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
  };
}

// A visit's sale: what was paid less the tip and anything refunded, and
// the tip. Voided sales don't count.
export function saleTotals(sales: { status: string; total_cents: number; tip_cents: number; refunded_cents: number }[]): { totalCents: number; tipCents: number } | null {
  const kept = sales.filter((s) => s.status !== "voided");
  if (!kept.length) return null;
  return {
    totalCents: kept.reduce((sum, s) => sum + s.total_cents - s.tip_cents - s.refunded_cents, 0),
    tipCents: kept.reduce((sum, s) => sum + s.tip_cents, 0),
  };
}

export type ClientTag = { label: string; tone: Tone };

// How many no-shows in a year make "Repeat no-show".
export const REPEAT_NO_SHOWS = 2;
// A client is "New" until their first visit, and for this long after it.
export const NEW_CLIENT_DAYS = 60;

const DAY = 86_400_000;

// The header's tags, most important first: VIP (top tenth of the salon by
// spend: only for those who see spend), New, a membership, Repeat no-show,
// No texts.
export function clientTags(
  c: {
    firstVisit: string | null;
    visits: ProfileVisit[];
    spendCents: number | null;
    // The spend that puts a client in the salon's top tenth (null: unknown).
    vipCents: number | null;
    member: string | null;
    noTexts: string | null;
  },
  now: Date,
): ClientTag[] {
  const tags: ClientTag[] = [];
  if (c.spendCents != null && c.vipCents != null && c.vipCents > 0 && c.spendCents >= c.vipCents) tags.push({ label: "VIP", tone: "success" });
  const completed = c.visits.filter((v) => v.status === "completed").length;
  if (completed === 0 || (c.firstVisit && now.getTime() - new Date(c.firstVisit).getTime() < NEW_CLIENT_DAYS * DAY)) tags.push({ label: "New", tone: "info" });
  if (c.member) tags.push({ label: c.member, tone: "info" });
  const yearAgo = now.getTime() - 365 * DAY;
  const noShows = c.visits.filter((v) => v.status === "no_show" && new Date(v.startsAt).getTime() >= yearAgo).length;
  if (noShows >= REPEAT_NO_SHOWS) tags.push({ label: "Repeat no-show", tone: "danger" });
  if (c.noTexts) tags.push({ label: c.noTexts, tone: "warning" });
  return tags;
}

// When they became a client: their first visit, or when they were added if
// that's earlier (or they haven't been in yet).
export function clientSince(createdAt: string, firstVisit: string | null): string {
  return firstVisit && firstVisit < createdAt ? firstVisit : createdAt;
}

// The visit to check out from the profile: one today that's still open
// (in the chair first), if any.
export function checkoutVisit(upcoming: ProfileVisit[], today: (iso: string) => boolean): ProfileVisit | null {
  const todays = upcoming.filter((v) => today(v.startsAt));
  return todays.find((v) => v.status === "checked_in") ?? todays[0] ?? null;
}

// Client notes are long-lived: room for a lot more than a visit's.
export const MAX_CLIENT_NOTES = 5000;

// Under the notes: "Edited by Olivia Bennett on Mon, Oct 26 at 2:14pm".
export function notesEditedText(by: string | null, day: string, time: string): string {
  return `Edited${by ? ` by ${by}` : ""} on ${day} at ${time}`;
}

export function editedLine(at: string | null, editor: { first_name: string; last_name: string } | null, tz: string): string | null {
  if (!at) return null;
  const l = toLocal(new Date(at), tz);
  return notesEditedText(editor ? fullName(editor) : null, formatDay(l.date), formatMinute(l.minute));
}
