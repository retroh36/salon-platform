// The public demo (DEMO_MODE=true, a separate Supabase project with only
// the seeded salons): a banner and a feedback button on every page, one-tap
// sign-in for each role, codes and messages shown instead of sent, invites
// off, and Denise on a small daily allowance. Everything here is off unless
// the flag is set, so a real deployment never behaves like the demo.

export function isDemo(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEMO_MODE === "true";
}

export const DEMO_BANNER = "Demo: fake data, resets nightly. Don't enter real client info.";

export type DemoLogin = { key: string; role: string; name: string; salon: string; email: string; goTo: string };

// The seeded accounts the demo's sign-in page offers (supabase/seed.sql,
// seed-large.sql). Nobody else can sign in: sign-up and invites are off.
export const DEMO_LOGINS: DemoLogin[] = [
  { key: "owner", role: "Owner", name: "Olivia Bennett", salon: "Maple & Ash", email: "owner@mapleandash.test", goTo: "/calendar" },
  { key: "manager", role: "Manager", name: "Daniel Okafor", salon: "Maple & Ash", email: "manager@mapleandash.test", goTo: "/calendar" },
  { key: "front-desk", role: "Front desk", name: "Sam Rivera", salon: "Maple & Ash", email: "frontdesk@mapleandash.test", goTo: "/calendar" },
  { key: "stylist", role: "Stylist", name: "Bridget Callahan", salon: "Maple & Ash", email: "bridget@mapleandash.test", goTo: "/my-day" },
  { key: "large-owner", role: "Owner", name: "Renata Albright", salon: "Harbor & Vine, 35 stylists", email: "owner@harborvine.test", goTo: "/calendar" },
];

// The client button: a regular at Maple & Ash with visits booked, a gift
// card and a card on file, signed in to her account on the booking site.
export const DEMO_CLIENT = { name: "Aurora Baker", slug: "maple-and-ash", email: "aurora.baker203@example.com" };

export function isDemoAccount(email: string | null | undefined): boolean {
  return !!email && DEMO_LOGINS.some((l) => l.email === email.toLowerCase());
}

// Denise's allowance a salon a day in the demo, whatever the salon's own
// setting says (DEMO_AI_DAILY_TOKENS, else 250,000 tokens: roughly 15 to
// 25 questions).
export const DEMO_AI_TOKENS = 250_000;

export function demoTokenLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DEMO_AI_DAILY_TOKENS?.trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? n : DEMO_AI_TOKENS;
}

export const DEMO_LIMIT_TEXT =
  "That's all the thinking I have for the demo today, so I'll be back after tonight's reset. Everything else in Maestra still works, so keep exploring.";

// Questions for Denise from one connection in the demo, every 10 minutes.
export const DEMO_DENISE_PER_10_MIN = 20;

export const DEMO_SLOW_DOWN = "You're asking faster than I can keep up in the demo. Give me a few minutes, then ask again.";

export const DEMO_OFF = {
  invites: "Invites are off in the demo: only the demo accounts sign in.",
  passwords: "Passwords can't be changed in the demo. Use the one-tap buttons on the sign-in page.",
  accounts: "The demo's sign-in accounts can't be changed or deactivated, so everyone can keep using them. Try it on someone else on the team.",
  limit: "Denise's limit is fixed in the demo.",
};

// The page a note was sent from, without anything secret in it: links to
// pay, add a card, see a proposal, manage a booking or unsubscribe carry
// their token in the path, and query strings can carry one too.
const TOKEN_AFTER = new Set(["pay", "card", "event", "unsubscribe", "manage"]);

export function safePath(raw: string): string {
  let path: string;
  try {
    path = new URL(raw, "https://x.invalid").pathname;
  } catch {
    return "/";
  }
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) if (TOKEN_AFTER.has(parts[i - 1]) && parts[i]) parts[i] = ":token";
  return parts.join("/").slice(0, 300) || "/";
}
