import { isDemo } from "./demo";

type Env = Record<string, string | undefined>;

// The dev outbox (/dev/outbox) shows every text and email Maestra would have
// sent, so it's open only in development, on the public demo, and on the
// browser tests' production build (MAESTRA_TEST_SERVER=true, set by
// playwright.config.ts), and that last one only against a local database,
// so the flag alone can never open a real salon's messages.
export function outboxOpen(env: Env = process.env): boolean {
  if (env.NODE_ENV !== "production" || isDemo(env)) return true;
  return env.MAESTRA_TEST_SERVER === "true" && isLocalDatabase(env.NEXT_PUBLIC_SUPABASE_URL);
}

function isLocalDatabase(url: string | undefined): boolean {
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(url ?? "").hostname);
  } catch {
    return false;
  }
}
