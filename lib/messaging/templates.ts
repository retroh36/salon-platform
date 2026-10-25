// The messages staff send a client (pure, unit-tested): quick-pick
// templates our code fills in, or what the staff member writes themselves.
// Never written by AI: Denise doesn't write to or message clients. Each
// text ends with how to stop texts.

import type { Channel } from "./consent.ts";

export const STAFF_TEMPLATES = {
  running_late: { label: "We're running behind", needs: ["minutes"] },
  please_call: { label: "Please call us", needs: [] },
  need_to_move: { label: "We need to move your visit", needs: [] },
  reminder: { label: "Reminder", needs: [] },
  ready_early: { label: "We can take you early", needs: ["time"] },
} as const;

export type StaffTemplate = keyof typeof STAFF_TEMPLATES;

export type TemplateFacts = {
  salon: string;
  phone: string | null;
  firstName: string;
  // "Friday, October 30 at 2:00pm", or "today at 2:00pm".
  when: string;
  stylist: string | null;
  manageLink: string | null;
  minutes?: number;
  time?: string;
};

export const isStaffTemplate = (v: string): v is StaffTemplate => v in STAFF_TEMPLATES;

export function renderStaffMessage(template: StaffTemplate, f: TemplateFacts, channel: Channel): { subject: string; body: string } {
  const call = f.phone ? ` at ${f.phone}` : "";
  const link = f.manageLink ? ` ${f.manageLink}` : "";
  const text = {
    running_late: `Hi ${f.firstName}, ${f.salon} here. We're running about ${f.minutes ?? 10} minutes behind for your visit ${f.when}. Sorry for the wait.`,
    please_call: `Hi ${f.firstName}, ${f.salon} here. Please give us a call${call} about your visit ${f.when}.`,
    need_to_move: `Hi ${f.firstName}, ${f.salon} here. We need to move your visit ${f.when}. Please call us${call}${f.manageLink ? ` or choose a new time:${link}` : "."}`,
    reminder: `Hi ${f.firstName}, a reminder of your visit at ${f.salon} ${f.when}${f.stylist ? ` with ${f.stylist}` : ""}.${f.manageLink ? ` Change or cancel:${link}` : ""}`,
    ready_early: `Hi ${f.firstName}, ${f.salon} here. We can take you early, at ${f.time ?? "an earlier time"}, for your visit ${f.when}. Call us${call} if that works.`,
  }[template];
  const subject = {
    running_late: `${f.salon} is running a little behind`,
    please_call: `Please call ${f.salon}`,
    need_to_move: `${f.salon} needs to move your visit`,
    reminder: `Your visit at ${f.salon}`,
    ready_early: `${f.salon} can take you early`,
  }[template];
  return { subject, body: channel === "sms" ? withStopLine(text) : text };
}

// Checks the fill-ins a template needs.
export function templateProblem(template: StaffTemplate, f: { minutes?: number; time?: string }): string | null {
  if (template === "running_late" && !(Number.isInteger(f.minutes) && f.minutes! >= 5 && f.minutes! <= 120)) return "Say how many minutes behind (5 to 120).";
  if (template === "ready_early" && !/^\d{1,2}:\d{2}\s?(am|pm)$/i.test(f.time ?? "")) return "Give the earlier time, like 1:30pm.";
  return null;
}

// How texts end: how to stop them. Added once, to templates and to what
// staff write themselves.
export const STOP_LINE = "Reply STOP to stop texts.";
export const withStopLine = (body: string) => (/reply stop/i.test(body) ? body : `${body.trimEnd()} ${STOP_LINE}`);

// What a text costs to send: up to 160 plain characters is one text; longer
// ones go in parts of 153. Emoji, curly quotes and other characters outside
// the basic text alphabet make it 70, then parts of 67.
const GSM = /^[A-Za-z0-9 \n\r@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[\]~|€]*$/;

export function smsParts(text: string): { characters: number; parts: number; plain: boolean } {
  const plain = GSM.test(text);
  // ^ { } \ [ ] ~ | € take two places each.
  const characters = plain ? [...text].reduce((n, ch) => n + ("^{}\\[]~|€".includes(ch) ? 2 : 1), 0) : [...text].length;
  const [one, part] = plain ? [160, 153] : [70, 67];
  return { characters, plain, parts: characters === 0 ? 0 : characters <= one ? 1 : Math.ceil(characters / part) };
}

// The counter under a text: "142 / 160", then a warning once it's more than one text.
export function smsCounterText(text: string): { text: string; warn: boolean } {
  const { characters, parts, plain } = smsParts(text);
  const limit = plain ? 160 : 70;
  if (parts <= 1) return { text: `${characters} / ${limit}`, warn: false };
  return {
    text: `${characters} characters: sends as ${parts} texts${plain ? "" : " (emoji or special characters make texts shorter)"}`,
    warn: true,
  };
}
