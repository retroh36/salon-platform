// npm run demo:db -- migrate | reset --yes | check [app url]
//
// The public demo's database (a separate Supabase project, docs/operations.md
// "The public demo"). Settings come from MAESTRA_ENV_FILE (the demo's are in
// .env.demo.local, git-ignored), else .env.local, else the environment:
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DEMO_DATABASE_URL (the
// session pooler's connection string; locally the local database's).
//
//   migrate  applies every migration (supabase db push)
//   reset    the nightly reset (.github/workflows/demo-reset.yml): empties
//            the files and every table but demo_feedback, signs everyone
//            out, loads the seed, the busy month and the large salon again,
//            sets Denise's allowance and recalculates what she's learned
//   check    Row Level Security on every table, the seeded salons and, given
//            the app's address, what the deployed app has set (yes or no)
//
// Refuses to reset a database with any salon but the two seeded ones, so it
// can never empty a real one. Never prints the connection string or keys.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types.ts";
import { demoTokenLimit } from "../lib/demo.ts";
import { listFiles } from "../lib/photo-backup.ts";

const envFile = process.env.MAESTRA_ENV_FILE ?? ".env.local";
try {
  process.loadEnvFile(envFile);
} catch {
  // Rely on the environment (the GitHub workflow).
}

const SEEDED = ["b0000000-0000-4000-8000-000000000001", "b1000000-0000-4000-8000-000000000001"];
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
// Kept by the reset (not salon data; see its migration).
const KEEP = ["demo_feedback"];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) fail(`Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (in ${envFile}).`);
const local = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url!);
const dbUrl = process.env.DEMO_DATABASE_URL ?? (local ? LOCAL_DB : undefined);
const admin = createClient<Database>(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });

// Anything printed passes through here first.
function redact(text: string): string {
  let out = text;
  for (const secret of [dbUrl, key, safeUrl(dbUrl)?.password].filter((s): s is string => !!s && s.length > 3)) out = out.split(secret).join("***");
  return out;
}

function safeUrl(value: string | undefined): URL | null {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

function fail(message: string): never {
  console.error(redact(message));
  process.exit(1);
}

// The project the API keys are for must be the one the connection string
// reaches (its ref is in the pooler's user name or the host).
function sameProject() {
  if (local) return;
  const ref = new URL(url!).hostname.split(".")[0];
  const db = safeUrl(dbUrl);
  if (!db || !(db.username.endsWith(`.${ref}`) || db.hostname.includes(ref))) fail("DEMO_DATABASE_URL isn't for the same Supabase project as NEXT_PUBLIC_SUPABASE_URL.");
}

function hasPsql(): boolean {
  return spawnSync("psql", ["--version"], { stdio: "ignore" }).status === 0;
}

// Runs SQL with psql, stopping at the first error. Without psql installed:
// locally inside the database container, else in a throwaway postgres
// container (the connection string goes in by environment, never as an
// argument anyone can see).
function psql(sql: string, what: string) {
  const started = Date.now();
  const options = { input: sql, encoding: "utf8" as const, maxBuffer: 64 * 1024 * 1024 };
  const flags = ["-X", "-q", "-v", "ON_ERROR_STOP=1"];
  const env = { ...process.env, DEMO_DATABASE_URL: dbUrl };
  const run = `exec psql ${flags.join(" ")} -d "$DEMO_DATABASE_URL"`;
  const result = hasPsql()
    ? spawnSync("sh", ["-c", run], { ...options, env })
    : local
      ? spawnSync("docker", ["exec", "-i", "supabase_db_salon-platform", "psql", ...flags, "-U", "postgres", "-d", "postgres"], options)
      : spawnSync("docker", ["run", "--rm", "-i", "-e", "DEMO_DATABASE_URL", "postgres:17-alpine", "sh", "-c", run], { ...options, env });
  if (result.status !== 0) fail(`${what} failed:\n${result.stderr || result.error?.message || ""}`);
  console.log(`${what} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

async function onlySeededSalons() {
  const { data, error } = await admin.from("businesses").select("id");
  if (error) fail(`Couldn't read the salons: ${error.message}`);
  const others = data!.filter((b) => !SEEDED.includes(b.id)).length;
  if (others) fail(`This database has ${others} salon(s) besides the seeded ones, so it isn't the demo's. Nothing was changed.`);
}

async function emptyStorage() {
  const { data: buckets, error } = await admin.storage.listBuckets();
  if (error) fail(`Couldn't list the storage buckets: ${error.message}`);
  let removed = 0;
  for (const bucket of buckets!) {
    const files = await listFiles(admin, bucket.id);
    for (let i = 0; i < files.length; i += 100) {
      const { error: removeError } = await admin.storage.from(bucket.id).remove(files.slice(i, i + 100).map((f) => f.path));
      if (removeError) fail(`Couldn't remove files from ${bucket.id}: ${removeError.message}`);
    }
    removed += files.length;
  }
  console.log(`Removed ${removed} stored files`);
}

const WIPE = `
do $$
declare
  tables text;
begin
  if exists (select 1 from public.businesses where id not in (${SEEDED.map((id) => `'${id}'`).join(", ")})) then
    raise exception 'Not the demo database: it has other salons';
  end if;
  select string_agg(format('public.%I', tablename), ', ' order by tablename) into tables
  from pg_catalog.pg_tables where schemaname = 'public' and tablename <> all (array[${KEEP.map((t) => `'${t}'`).join(", ")}]);
  execute 'truncate table ' || tables || ' restart identity cascade';
  delete from auth.users;
end $$;
`;

const [command, arg] = process.argv.slice(2);

if (command === "migrate") {
  sameProject();
  if (!dbUrl) fail("Set DEMO_DATABASE_URL.");
  const result = spawnSync("npx", ["supabase", "db", "push", "--db-url", dbUrl!, "--include-all"], { input: "y\n", encoding: "utf8" });
  console.log(redact(`${result.stdout ?? ""}${result.stderr ?? ""}`).trim());
  if (result.status !== 0) fail("The migrations didn't all apply.");
} else if (command === "reset") {
  if (!process.argv.includes("--yes")) fail("This empties the demo's database and loads it again. Run it with --yes.");
  sameProject();
  if (!dbUrl) fail("Set DEMO_DATABASE_URL.");
  await onlySeededSalons();
  await emptyStorage();
  psql(WIPE, "Emptied the tables (feedback kept)");
  for (const file of ["seed.sql", "seed-demo.sql", "seed-large.sql"]) psql(readFileSync(`supabase/${file}`, "utf8"), `Loaded ${file}`);
  psql(`update public.businesses set ai_daily_token_limit = ${demoTokenLimit()};`, "Set Denise's daily allowance");
  const insights = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/insights.ts"], { encoding: "utf8", env: { ...process.env, MAESTRA_ENV_FILE: envFile } });
  console.log(redact(insights.stdout).trim());
  if (insights.status !== 0) fail(`Recalculating what Denise has learned failed:\n${insights.stderr}`);
  console.log("The demo is fresh.");
} else if (command === "check") {
  let ok = true;
  const { data: noRls, error } = await admin.rpc("tables_without_rls");
  if (error) fail(`Couldn't check Row Level Security: ${error.message}`);
  const missing = (noRls as unknown as string[]) ?? [];
  console.log(missing.length ? `Tables without Row Level Security: ${missing.join(", ")}` : "Row Level Security is on for every table.");
  ok &&= !missing.length;
  const { data: salons, error: salonError } = await admin.from("businesses").select("id, name");
  if (salonError) fail(`Couldn't read the salons: ${salonError.message}`);
  const others = salons!.filter((b) => !SEEDED.includes(b.id)).length;
  console.log(`Salons: ${salons!.length} (${others ? `${others} not seeded` : "only the seeded ones"})`);
  ok &&= !others && salons!.length === SEEDED.length;
  if (arg) {
    const response = await fetch(`${arg.replace(/\/+$/, "")}/api/demo/status`, {
      headers: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {},
    });
    if (!response.ok) fail(`The app's status page answered ${response.status}: is DEMO_MODE=true set there?`);
    const status = (await response.json()) as Record<string, boolean>;
    for (const [name, set] of Object.entries(status)) console.log(`  ${name}: ${set ? "yes" : "no"}`);
    const right = status.demoMode && status.supabase && status.denise && status.cronSecret && !status.phorest && !status.stripe;
    console.log(right ? "The app is set up as the demo." : "The app's settings aren't right for the demo (see above).");
    ok &&= right;
  }
  if (!ok) process.exit(1);
} else {
  fail("Use: npm run demo:db -- migrate | reset --yes | check [app url]");
}
