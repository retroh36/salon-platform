// npm run demo:db -- migrate | reset --yes | check [app url]
//
// The public demo's database (a separate Supabase project, docs/operations.md
// "The public demo"). Settings come from MAESTRA_ENV_FILE (the demo's are in
// .env.demo.local, git-ignored), else .env.local, else the environment:
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DEMO_DATABASE_URL (the
// session pooler's connection string; locally the local database's).
//
//   migrate  applies every migration (supabase db push)
//   reset    the nightly reset (.github/workflows/demo-reset.yml, with the
//            demo branch's code): first checks the database has exactly the
//            migrations this code has, then, in one transaction, empties
//            every table but demo_feedback, signs everyone out, loads the
//            seed, the demo's extra opening days (Maple & Ash open every day,
//            seed-demo-open-daily.sql), the busy month and the large salon
//            and sets Denise's allowance; anything failing rolls it all back,
//            so yesterday's data stays. Then the stored files go, what she's
//            learned is recalculated and both salons are checked for staff
//            and today's visits
//   check    Row Level Security on every table, the migrations, the seeded
//            salons and, given the app's address, what the deployed app has
//            set (yes or no)
//
// Refuses to reset a database with any salon but the two seeded ones, so it
// can never empty a real one. Never prints the connection string or keys.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
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
// The demo's data, in order. seed-demo-open-daily.sql (demo only) opens
// Maple & Ash every day before the busy month is booked around the hours.
const DEMO_SEEDS = ["seed.sql", "seed-demo-open-daily.sql", "seed-demo.sql", "seed-large.sql"];

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
// `single` runs it all as one transaction (all or nothing); `rows` returns
// what it selects, a line a row, fields split by |.
function psql(sql: string, what: string, { single = false, quiet = false } = {}): string[][] {
  const started = Date.now();
  const options = { input: sql, encoding: "utf8" as const, maxBuffer: 64 * 1024 * 1024 };
  const flags = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"];
  // psql stops at the first error and disconnects, which rolls it back.
  if (single) options.input = `begin;\n${sql}\ncommit;\n`;
  const env = { ...process.env, DEMO_DATABASE_URL: dbUrl };
  const run = `exec psql ${flags.join(" ")} -d "$DEMO_DATABASE_URL"`;
  const result = hasPsql()
    ? spawnSync("sh", ["-c", run], { ...options, env })
    : local
      ? spawnSync("docker", ["exec", "-i", "supabase_db_salon-platform", "psql", ...flags, "-U", "postgres", "-d", "postgres"], options)
      : spawnSync("docker", ["run", "--rm", "-i", "-e", "DEMO_DATABASE_URL", "postgres:17-alpine", "sh", "-c", run], { ...options, env });
  if (result.status !== 0) fail(`${what} failed:\n${result.stderr || result.error?.message || ""}`);
  if (!quiet) console.log(`${what} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return (result.stdout ?? "").split("\n").filter(Boolean).map((line) => line.split("|"));
}

// The database must have exactly the migrations this code has: the seeds
// are written for this code's tables, so loading them on an older (or
// newer) database fails partway or loads the wrong thing.
function schemaProblem(): string | null {
  const mine = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).map((f) => f.split("_")[0]).sort();
  const applied = psql("select version from supabase_migrations.schema_migrations order by version;", "Reading the migrations", { quiet: true }).map((r) => r[0]);
  const missing = mine.filter((v) => !applied.includes(v));
  const extra = applied.filter((v) => !mine.includes(v));
  if (!missing.length && !extra.length) return null;
  return [
    missing.length ? `${missing.length} migration(s) this code has aren't on the database (${missing.join(", ")}): run demo:db -- migrate first.` : "",
    extra.length ? `The database has ${extra.length} migration(s) this code doesn't (${extra.join(", ")}): it's newer than this code.` : "",
  ].filter(Boolean).join("\n");
}

// After a reset: both salons, each with active staff and visits today in
// its own timezone (the demo opens every day).
function freshProblems(): string[] {
  const rows = psql(
    `select b.name,
            (select count(*) from public.staff s where s.business_id = b.id and s.is_active),
            (select count(*) from public.appointments a join public.locations l on l.id = a.location_id
              where l.business_id = b.id and a.status not in ('canceled', 'no_show')
                and (a.starts_at at time zone l.timezone)::date = (now() at time zone l.timezone)::date)
     from public.businesses b where b.id in (${SEEDED.map((id) => `'${id}'`).join(", ")}) order by b.name;`,
    "Checking the salons",
    { quiet: true },
  );
  const problems: string[] = [];
  if (rows.length !== SEEDED.length) problems.push(`${rows.length} of the ${SEEDED.length} salons are there.`);
  for (const [name, staff, today] of rows) {
    console.log(`${name}: ${staff} staff, ${today} visits today`);
    if (Number(staff) === 0) problems.push(`${name} has no staff.`);
    if (Number(today) === 0) problems.push(`${name} has no visits today.`);
  }
  return problems;
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
  const schema = schemaProblem();
  if (schema) fail(`${schema}\nNothing was changed.`);
  // One transaction: a seed that fails rolls back the wipe too. Each seed
  // is written for a session of its own, so between them its temporary
  // helpers go and nobody is acted as (request.jwt.claims, which a seed may
  // set for a step, lasts the transaction).
  const between = "discard temp;\nselect set_config('request.jwt.claims', '', true);";
  const all = [WIPE, ...DEMO_SEEDS.map((file) => `${readFileSync(`supabase/${file}`, "utf8")}\n${between}`), `update public.businesses set ai_daily_token_limit = ${demoTokenLimit()};`];
  psql(all.join("\n"), `Emptied every table but the feedback and loaded ${DEMO_SEEDS.join(", ")} in one transaction`, { single: true });
  // Files after the data, which is what matters: the seeds store none.
  await emptyStorage();
  const insights = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/insights.ts"], { encoding: "utf8", env: { ...process.env, MAESTRA_ENV_FILE: envFile } });
  console.log(redact(insights.stdout).trim());
  if (insights.status !== 0) fail(`Recalculating what Denise has learned failed (the data itself was reloaded):\n${insights.stderr}`);
  const problems = freshProblems();
  if (problems.length) fail(`The reset finished but the demo isn't right:\n${problems.join("\n")}`);
  console.log("The demo is fresh.");
} else if (command === "check") {
  let ok = true;
  const { data: noRls, error } = await admin.rpc("tables_without_rls");
  if (error) fail(`Couldn't check Row Level Security: ${error.message}`);
  const missing = (noRls as unknown as string[]) ?? [];
  console.log(missing.length ? `Tables without Row Level Security: ${missing.join(", ")}` : "Row Level Security is on for every table.");
  ok &&= !missing.length;
  if (dbUrl) {
    const schema = schemaProblem();
    console.log(schema ?? "The database has exactly this code's migrations.");
    ok &&= !schema;
  }
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
    const { commit, ...status } = (await response.json()) as Record<string, boolean> & { commit?: string | null };
    for (const [name, set] of Object.entries(status)) console.log(`  ${name}: ${set ? "yes" : "no"}`);
    if (commit) console.log(`  commit: ${commit.slice(0, 7)}`);
    const right = status.demoMode && status.supabase && status.denise && status.cronSecret && !status.phorest && !status.stripe;
    console.log(right ? "The app is set up as the demo." : "The app's settings aren't right for the demo (see above).");
    ok &&= right;
  }
  if (!ok) process.exit(1);
} else {
  fail("Use: npm run demo:db -- migrate | reset --yes | check [app url]");
}
