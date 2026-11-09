// Campaigns (pure, unit-tested): who on a client report can get one, and
// whether the message can go. The words are staff's; Denise never writes
// them, and our code only fills in the fields.

import { channelFor, type ClientConsent } from "@/lib/messaging/consent";
import type { Channel } from "@/lib/messaging/consent";

export const CAMPAIGN_FIELDS = ["first_name", "salon", "booking_link"];
export const CAMPAIGN_MAX = 5000;
export const MAX_CAMPAIGN_BODY = 800;

// A starting point for staff to change.
export const STARTER = {
  subject: "A note from {salon}",
  body: "Hi {first_name}, it's {salon}. We'd love to see you soon. Book your next visit here: {booking_link}",
};

export type CampaignDraft = { name: string; subject: string; body: string };

export function campaignProblem(d: CampaignDraft, bookingLive: boolean): string | null {
  if (!d.name.trim()) return "Give the campaign a name.";
  if (d.name.trim().length > 80) return "Keep the name under 80 characters.";
  if (!d.subject.trim()) return "Add a subject for emails.";
  if (!d.body.trim()) return "Write the message.";
  if (d.body.length > MAX_CAMPAIGN_BODY) return `Keep the message under ${MAX_CAMPAIGN_BODY} characters.`;
  const unknown = [...new Set([...`${d.subject} ${d.body}`.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((f) => !CAMPAIGN_FIELDS.includes(f)))];
  if (unknown.length) return `Only these can go in braces: ${CAMPAIGN_FIELDS.map((f) => `{${f}}`).join(", ")}.`;
  if (!bookingLive && d.body.includes("{booking_link}")) return "Online booking is off, so {booking_link} has nowhere to go.";
  return null;
}

export type AudienceClient = { id: string; firstName: string; consent: ClientConsent };
export type Recipient = { id: string; firstName: string; channel: Channel };
export type Audience = { recipients: Recipient[]; noConsent: number; recentlyMessaged: number };

// Said yes to offers on a channel, and no offer or reminder this week.
export function splitAudience(clients: readonly AudienceClient[], recent: ReadonlySet<string>, prefer: Channel): Audience {
  const out: Audience = { recipients: [], noConsent: 0, recentlyMessaged: 0 };
  for (const c of clients) {
    const to = channelFor(c.consent, "marketing", prefer);
    if (!to) out.noConsent += 1;
    else if (recent.has(c.id)) out.recentlyMessaged += 1;
    else out.recipients.push({ id: c.id, firstName: c.firstName, channel: to.channel });
  }
  return out;
}

export function audienceText(a: Audience): string {
  const n = a.recipients.length;
  const left = [
    a.noConsent ? `${a.noConsent} haven't said yes to offers` : "",
    a.recentlyMessaged ? `${a.recentlyMessaged} had a message from us this week` : "",
  ].filter(Boolean);
  return `${n} ${n === 1 ? "client" : "clients"} will get this.${left.length ? ` Left out: ${left.join(", ")}.` : ""}`;
}
