// "Finish your booking": after a booking made by phone, one message with one
// link (/finish/<token>) where the client adds the card the policy asks for
// (and pays any deposit), then signs the forms the visit needs, in one go.
//
// It's no new kind of link: the token works out the tokens of an ordinary
// card link (card_requests) and form link (form_requests), made at the same
// time and never sent on their own (partToken). So booking details, the
// card page's checks and the form page's checks all work as they do for
// those, and only the hashes are stored, as before.

import { createHash } from "node:crypto";

export const isFinishToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

// The card link's or form link's own token, from the finish link's: the
// same shape as any other link's (43 characters), so their loaders take it.
export function partToken(token: string, part: "card" | "forms"): string {
  return createHash("sha256").update(`${token}:${part}`).digest("base64url");
}

// "Maple & Ash: Hi Ava, to finish your booking for Tue, Nov 10 at 2:15pm,
// please pay your $40.00 deposit and sign your Color consent here: …"
export function finishMessage(
  salon: string,
  firstName: string,
  when: string,
  ask: { card: boolean; depositCents: number; forms: readonly string[] },
  url: string,
  channel: "sms" | "email",
): { subject: string | null; body: string } {
  const steps = [
    ask.depositCents > 0 ? `pay your $${(ask.depositCents / 100).toFixed(2)} deposit` : ask.card ? "add a card to hold it" : null,
    ask.forms.length === 1 ? `sign your ${ask.forms[0]}` : ask.forms.length > 1 ? `sign ${ask.forms.length} short forms` : null,
  ].filter(Boolean);
  return {
    subject: channel === "email" ? `Finish your booking at ${salon}` : null,
    body: `${salon}: Hi ${firstName}, to finish your booking for ${when}, please ${steps.join(" and ")} here: ${url}`,
  };
}
