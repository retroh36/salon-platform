// Gift card codes and the digital card's email. Pure.

import { formatPrice } from "@/lib/services";

// "K7QM3XRP9TWDFH2C" -> "K7QM-3XRP-9TWD-FH2C", easy to read out loud.
export function formatCode(code: string): string {
  return normalizeCode(code).replace(/(.{4})(?=.)/g, "$1-");
}

// What staff type or scan, as stored: letters and digits, upper case.
export function normalizeCode(text: string): string {
  return text.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

// A physical card's own code is 8 to 32 letters and digits.
export function isCardCode(text: string): boolean {
  return /^[A-Z0-9]{8,32}$/.test(normalizeCode(text));
}

// "…FH2C": enough to recognise a card, without showing the whole code.
export function codeHint(code: string): string {
  return `…${normalizeCode(code).slice(-4)}`;
}

export type GiftCardLookup = {
  id: string;
  code: string;
  kind: "purchased" | "promotional";
  status: "active" | "voided";
  balance_cents: number;
  initial_cents: number;
  expires_at: string | null;
  expired: boolean;
};

// Why a card can't be used, if it can't.
export function cardProblem(card: GiftCardLookup): string | null {
  if (card.status === "voided") return "That gift card was voided.";
  if (card.expired) return "That gift card has expired.";
  if (card.balance_cents === 0) return "That gift card has nothing left on it.";
  return null;
}

export const EVENT_LABELS: Record<string, string> = {
  sold: "Sold",
  issued: "Issued",
  imported: "Carried over",
  redeemed: "Used",
  reloaded: "Reloaded",
  refunded: "Refunded to card",
  adjusted: "Adjusted",
  voided: "Voided",
};

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The digital card: the salon's name and color, the amount and the code.
export function giftCardEmail(card: {
  code: string;
  amountCents: number;
  recipientName: string | null;
  expiresOn: string | null;
  salon: { name: string; locationName: string; accentColor: string | null; bookingUrl: string | null };
}): { subject: string; text: string; html: string } {
  const code = formatCode(card.code);
  const to = card.recipientName ? `${card.recipientName}, ` : "";
  const subject = `${card.recipientName ? `${card.recipientName}, here's` : "Here's"} a ${formatPrice(card.amountCents)} gift card for ${card.salon.name}`;
  const text = [
    `${to}you have a ${formatPrice(card.amountCents)} gift card for ${card.salon.name}.`,
    "",
    `Your code: ${code}`,
    "Show this code at checkout. You can use it over several visits.",
    card.expiresOn ? `Use it by ${card.expiresOn}.` : "",
    card.salon.bookingUrl ? `Book: ${card.salon.bookingUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const accent = escape(card.salon.accentColor ?? "#17273B");
  const html = `<!doctype html><html><body style="margin:0;background:#FBF8F5;font-family:Inter,Arial,sans-serif;color:#1D2532">
<div style="max-width:480px;margin:32px auto;padding:0 16px">
<div style="background:${accent};color:#fff;border-radius:18px;padding:32px 28px;box-shadow:0 12px 32px rgba(23,39,59,.18)">
<div style="font-size:14px;letter-spacing:.12em;text-transform:uppercase;opacity:.8">Gift card</div>
<div style="font-family:Georgia,serif;font-size:28px;font-weight:600;margin-top:6px">${escape(card.salon.name)}</div>
<div style="font-size:44px;font-weight:700;margin:24px 0 8px">${escape(formatPrice(card.amountCents))}</div>
${card.recipientName ? `<div style="font-size:16px;opacity:.9">For ${escape(card.recipientName)}</div>` : ""}
<div style="margin-top:24px;background:rgba(255,255,255,.14);border-radius:10px;padding:14px 16px;font-family:'Courier New',monospace;font-size:22px;letter-spacing:.08em;text-align:center">${escape(code)}</div>
</div>
<div style="background:#fff;border:1px solid #EBE4DD;border-radius:12px;margin-top:16px;padding:20px 24px;font-size:14px;line-height:1.6">
<p style="margin:0 0 8px">Show this code at checkout at ${escape(card.salon.name)}${card.salon.locationName ? `, ${escape(card.salon.locationName)}` : ""}. You can use it over several visits.</p>
${card.expiresOn ? `<p style="margin:0 0 8px;color:#565E6B">Use it by ${escape(card.expiresOn)}.</p>` : ""}
${card.salon.bookingUrl ? `<p style="margin:12px 0 0"><a href="${escape(card.salon.bookingUrl)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Book a visit</a></p>` : ""}
</div>
<p style="text-align:center;font-size:12px;color:#666E7C">Powered by Maestra</p>
</div></body></html>`;
  return { subject, text, html };
}
