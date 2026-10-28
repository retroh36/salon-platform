// node scripts/require-local.ts "<what>": stops (exit 1, saying why) unless
// the database settings are local (scripts/local-only.ts). Loads .env.local
// first; settings already in the shell win, as they do everywhere else.
// npm run seed:demo, npm run db:reset and the backup drill start with it.

import { requireLocal } from "./local-only.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Only the shell's settings, then.
}
requireLocal(process.argv[2] ?? "This");
