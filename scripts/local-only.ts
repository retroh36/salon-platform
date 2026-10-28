// Tests, seeds and resets only ever touch the local database.
//
// Every test runner (vitest: unit, db, eval; Playwright: e2e, the week, the
// demo checks' cleanup), npm run seed:demo, npm run db:reset, the week,
// screenshots and the backup drill call this before they start. It refuses
// unless every database setting it can see is on this machine (localhost or
// 127.0.0.1), and refuses another project's settings file (MAESTRA_ENV_FILE)
// outright. Only npm run demo:db works on the hosted demo, on purpose.
//
//   import { requireLocal } from "./scripts/local-only.ts"; requireLocal("npm test");
//   node scripts/require-local.ts "npm run seed:demo"   (exits 1 with the reason)
//
// Settings already in the shell win over .env.local (Node's loadEnvFile and
// Vite's loadEnv both keep them), so the shell is checked too. Never prints
// a key or a password; a URL is shown as its host only.

// The settings that say which database or Supabase project is used.
export const DATABASE_SETTINGS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "DATABASE_URL", "SUPABASE_DB_URL", "DEMO_DATABASE_URL", "DEMO_SUPABASE_URL"];
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

// Why these settings aren't local, or null when they are (or unset).
export function notLocal(env: Record<string, string | undefined>): string | null {
  if (env.MAESTRA_ENV_FILE) {
    return `MAESTRA_ENV_FILE is set (to ${env.MAESTRA_ENV_FILE}): that's another project's settings, for npm run demo:db only. Unset it (unset MAESTRA_ENV_FILE) and try again.`;
  }
  for (const name of DATABASE_SETTINGS) {
    const value = env[name];
    if (!value) continue;
    const host = hostOf(value);
    if (!host) return `${name} isn't a URL this can check, so it may not be local. Use the local database's (http://127.0.0.1:54321, or postgresql://…@127.0.0.1:54322/…).`;
    if (!LOCAL_HOSTS.includes(host)) {
      return `${name} points at ${host}, which isn't this machine. Tests, seeds and resets only run against the local database (localhost or 127.0.0.1); the hosted demo is changed only with npm run demo:db. Check .env.local and your shell (env | grep SUPABASE).`;
    }
  }
  return null;
}

// Stops this run, saying why, unless the settings are local. `extra` adds
// settings read from a file that aren't in process.env (Vite's loadEnv).
export function requireLocal(what: string, extra: Record<string, string | undefined> = {}) {
  const problem = notLocal({ ...extra, ...process.env });
  if (!problem) return;
  console.error(`\n${what} refused to start: ${problem}\n`);
  process.exit(1);
}
