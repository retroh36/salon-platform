// Who can be messaged, how (pure, unit-tested). Two separate consents:
// appointment messages (confirmations, reminders, changes: on unless the
// client turned them off) and marketing (offers and news: only with a yes,
// clients.sms_opt_in / email_opt_in). A STOP on texts stops every text,
// appointment ones too, so those fall back to email; turning off marketing
// never touches appointment messages.

export type Channel = "sms" | "email";
export type Purpose = "appointment" | "marketing";

export type ClientConsent = {
  phone: string | null;
  email: string | null;
  appointmentSmsOk: boolean;
  appointmentEmailOk: boolean;
  smsOptIn: boolean;
  emailOptIn: boolean;
  smsStoppedAt: string | null;
};

export const consentOf = (c: {
  phone: string | null;
  email: string | null;
  appointment_sms_ok: boolean;
  appointment_email_ok: boolean;
  sms_opt_in: boolean;
  email_opt_in: boolean;
  sms_stopped_at: string | null;
}): ClientConsent => ({
  phone: c.phone || null,
  email: c.email || null,
  appointmentSmsOk: c.appointment_sms_ok,
  appointmentEmailOk: c.appointment_email_ok,
  smsOptIn: c.sms_opt_in,
  emailOptIn: c.email_opt_in,
  smsStoppedAt: c.sms_stopped_at,
});

// The channels a message of this kind can go on.
export function allowedChannels(c: ClientConsent, purpose: Purpose): Channel[] {
  const texts = Boolean(c.phone) && !c.smsStoppedAt && (purpose === "appointment" ? c.appointmentSmsOk : c.smsOptIn);
  const emails = Boolean(c.email) && (purpose === "appointment" ? c.appointmentEmailOk : c.emailOptIn);
  return [...(texts ? (["sms"] as const) : []), ...(emails ? (["email"] as const) : [])];
}

// The channel to use: the preferred one if allowed, else the other.
export function channelFor(c: ClientConsent, purpose: Purpose, prefer: Channel = "sms"): { channel: Channel; to: string } | null {
  const ok = allowedChannels(c, purpose);
  const pick = ok.includes(prefer) ? prefer : ok[0];
  if (!pick) return null;
  return { channel: pick, to: pick === "sms" ? c.phone! : c.email! };
}

// "No texts — call or email": shown on bookings and the profile when texts
// about visits can't reach them (a STOP, or they said no).
export function noTextsFlag(c: ClientConsent): string | null {
  if (!c.phone) return null;
  if (c.smsStoppedAt) return c.email ? "No texts — call or email" : "No texts — call";
  if (!c.appointmentSmsOk) return c.email ? "No texts — call or email" : "No texts — call";
  return null;
}

// The keywords carriers expect on every text program.
const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"];
const START_WORDS = ["START", "UNSTOP", "YES", "OPTIN"];
const HELP_WORDS = ["HELP", "INFO"];

export function keywordOf(body: string): "stop" | "start" | "help" | null {
  const word = body.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (STOP_WORDS.includes(word)) return "stop";
  if (START_WORDS.includes(word)) return "start";
  if (HELP_WORDS.includes(word)) return "help";
  return null;
}

// The fixed replies (the database records the change, sms_keyword).
export const KEYWORD_REPLIES = {
  stop: "You're unsubscribed from texts from salons on Maestra and won't get any more. Reply START to get appointment texts again.",
  start: "You'll get appointment texts again. Reply STOP to stop. Msg & data rates may apply.",
  help: "Texts about your salon appointments, sent by Maestra. Reply STOP to stop, START to start again. Msg & data rates may apply.",
} as const;

// What a consent event says, for the profile's history.
export const SOURCE_LABELS = {
  online_booking: "when booking online",
  client_account: "in their online account",
  staff: "recorded by staff",
  sms_keyword: "by text",
  unsubscribe_link: "with the unsubscribe link",
  import: "imported",
  system: "by Maestra",
} as const;

export function consentEventText(e: { purpose: Purpose; channel: Channel; granted: boolean; source: keyof typeof SOURCE_LABELS; detail: string | null }): string {
  const what = `${e.purpose === "appointment" ? "Appointment" : "Marketing"} ${e.channel === "sms" ? "texts" : "emails"}`;
  if (e.source === "sms_keyword") return `${what} ${e.granted ? "on" : "off"}: replied ${e.detail ?? (e.granted ? "START" : "STOP")}`;
  return `${what} ${e.granted ? "on" : "off"} ${SOURCE_LABELS[e.source]}`;
}

// The checkbox wording at online booking (kept with the consent).
export const APPOINTMENT_TEXTS_CONSENT = "Text me about my appointments (confirmations, reminders and changes). Msg & data rates may apply. Reply STOP to stop.";
export const MARKETING_CONSENT = "Send me offers and news by text and email. Unsubscribe anytime.";
