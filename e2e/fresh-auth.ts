import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { PASSWORD } from "../tests/db/helpers";

// Tests start from a saved sign-in (e2e/.auth, made by auth.setup.ts). Its
// access token lasts an hour and a whole run takes longer. Refreshing that
// one saved session from several tests at once uses its refresh token more
// than once, and Supabase then ends the session ("Auth session missing"
// partway through a run). So before each test, a saved sign-in with less
// than MIN_LEFT_MS to go is swapped for a brand-new one, made the way the
// app makes its own cookies, and no test ever has to refresh.

const MIN_LEFT_MS = 20 * 60_000;

const EMAILS: Record<string, string> = {
  "e2e/.auth/owner.json": "owner@mapleandash.test",
  "e2e/.auth/manager.json": "manager@mapleandash.test",
  "e2e/.auth/front-desk.json": "frontdesk@mapleandash.test",
  "e2e/.auth/stylist.json": "bridget@mapleandash.test",
  "e2e/.auth/large-owner.json": "owner@harborvine.test",
  "e2e/.auth/large-front-desk.json": "frontdesk@harborvine.test",
};

type Cookie = { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: "Lax" | "Strict" | "None" };
type State = { cookies: Cookie[]; origins: unknown[] };

const isAuthCookie = (name: string) => /^sb-.+-auth-token(\.\d+)?$/.test(name);

// When the saved session's access token expires (ms), from its cookie
// (base64url JSON, maybe split over .0, .1… cookies).
export function expiresAt(state: State): number | null {
  const parts = state.cookies.filter((c) => isAuthCookie(c.name)).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  if (!parts.length) return null;
  const value = parts.map((c) => c.value).join("");
  try {
    const session = JSON.parse(Buffer.from(value.replace(/^base64-/, ""), "base64url").toString("utf8")) as { expires_at?: number };
    return session.expires_at ? session.expires_at * 1000 : null;
  } catch {
    return null;
  }
}

export async function freshAuth(file: string | undefined) {
  const email = file && EMAILS[file];
  if (!email || process.env.E2E_NO_SAVED_SIGN_INS) return;
  const state = JSON.parse(readFileSync(file, "utf8")) as State;
  const expires = expiresAt(state);
  if (expires && expires - Date.now() > MIN_LEFT_MS) return;

  const made: { name: string; value: string; options: { maxAge?: number; sameSite?: string | boolean; httpOnly?: boolean; secure?: boolean; path?: string } }[] = [];
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => {
        made.push(...cookies);
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Couldn't sign ${email} in again: ${error.message}`);

  const template = state.cookies.find((c) => isAuthCookie(c.name));
  const cookies: Cookie[] = made
    .filter((c) => c.value)
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: template?.domain ?? "localhost",
      path: c.options.path ?? "/",
      expires: c.options.maxAge ? Date.now() / 1000 + c.options.maxAge : -1,
      httpOnly: c.options.httpOnly ?? false,
      secure: c.options.secure ?? false,
      sameSite: "Lax",
    }));
  const next: State = { ...state, cookies: [...state.cookies.filter((c) => !isAuthCookie(c.name)), ...cookies] };
  // Written whole, then moved into place, so a test starting in another
  // worker never reads half a file.
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next));
  renameSync(tmp, file);
}
