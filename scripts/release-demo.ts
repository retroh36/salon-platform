// npm run release:demo
//
// A safe release to the public demo (docs/operations.md, "The public demo"),
// one step at a time, stopping at the first failure:
//
//   1. main is checked out, clean and pushed, the demo's settings are in
//      .env.demo.local, and the demo branch can move forward to main
//   2. lint, types, unit tests and npm run test:week (which resets the local
//      database and puts the demo data back)
//   3. new migrations onto the demo database (demo:db -- migrate), then the
//      safety check (Row Level Security on every table, only seeded salons)
//   4. the demo data reloaded (demo:db -- reset) if a seed changed since the
//      last release
//   5. the demo branch moved forward to main and pushed: Vercel builds the
//      demo from it (its production branch)
//   6. waits for the live site to say it's running this commit
//      (/api/demo/status)
//   7. the demo's browser checks against the live site (test:demo)
//
// Until step 5 the live site runs what it ran before (steps 3 and 4 change
// only its database, and only with migrations and seeds that passed step 2).
// Never prints a secret.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const SITE = (process.env.DEMO_URL ?? "https://maestra-demo.vercel.app").replace(/\/+$/, "");
const ENV_FILE = ".env.demo.local";
const SEEDS = ["supabase/seed.sql", "supabase/seed-demo.sql", "supabase/seed-large.sql"];
const DEPLOY_MINUTES = 20;

let step = 0;
let released = false;
let databaseChanged = false;

function heading(text: string) {
  step += 1;
  console.log(`\n── ${step}. ${text}`);
}

function stop(what: string, detail?: string): never {
  console.error(`\nStopped at step ${step}: ${what}`);
  if (detail) console.error(detail);
  console.error(
    released
      ? `\nThe demo branch was already pushed, so the live demo has this release. To go back: Vercel → the demo project → Deployments → the previous one → Instant Rollback (or push the previous commit to the demo branch).`
      : databaseChanged
        ? "\nThe live demo's code wasn't changed. Its database was (the migrations or the data reload above), which the code running now should cope with; npm run demo:db -- check shows where it stands."
        : "\nThe live demo wasn't changed.",
  );
  process.exit(1);
}

// A command, its output shown as it runs; stops the release if it fails.
function run(what: string, command: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) stop(`${what} failed.`);
}

// A command whose output we read (git), never shown.
function read(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) stop(`\`${command} ${args.join(" ")}\` failed.`, result.stderr.trim());
  return result.stdout.trim();
}

function succeeds(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

async function liveCommit(): Promise<string | null | undefined> {
  try {
    const response = await fetch(`${SITE}/api/demo/status?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return undefined;
    return ((await response.json()) as { commit?: string | null }).commit ?? null;
  } catch {
    return undefined;
  }
}

// 1. Ready to release
heading("main is clean and pushed");
if (read("git", ["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") stop("Check out main first.");
if (read("git", ["status", "--porcelain"])) stop("main has uncommitted changes. Commit or stash them first.");
read("git", ["fetch", "--quiet", "origin", "main", "demo"]);
const head = read("git", ["rev-parse", "HEAD"]);
if (head !== read("git", ["rev-parse", "origin/main"])) stop("main isn't the same as origin/main. Push (or pull) first.");
const lastRelease = read("git", ["rev-parse", "origin/demo"]);
if (lastRelease === head) stop("The demo branch already has this commit: nothing to release.");
if (!succeeds("git", ["merge-base", "--is-ancestor", lastRelease, head])) stop("The demo branch has commits main doesn't, so it can't move forward to main. Look at them first.");
if (!existsSync(ENV_FILE)) stop(`${ENV_FILE} (the demo project's settings) isn't here.`);
const before = await liveCommit();
if (before === undefined) stop(`${SITE}/api/demo/status didn't answer. Is the demo up?`);
if (before === head) stop("The live demo already runs main's commit, so Vercel is building the demo from main, not the demo branch. Set Settings → Environments → Production → Branch Tracking to demo.");
console.log(`Releasing ${head.slice(0, 7)} (the demo has ${lastRelease.slice(0, 7)}).`);

// 2. Checks on this machine
heading("lint, types, unit tests and the week");
run("The linter", "npm", ["run", "lint"]);
run("The type check", "npm", ["run", "typecheck"]);
run("The unit tests", "npm", ["test"]);
run("The week (npm run test:week)", "npm", ["run", "test:week", "--", "--yes"]);

// 3. The demo's database
heading("migrations and the safety check on the demo database");
databaseChanged = true;
run("Applying migrations to the demo database", "npm", ["run", "demo:db", "--", "migrate"], { MAESTRA_ENV_FILE: ENV_FILE });
run("The safety check", "npm", ["run", "demo:db", "--", "check"], { MAESTRA_ENV_FILE: ENV_FILE });

// 4. The demo data
heading("the demo data");
if (succeeds("git", ["diff", "--quiet", lastRelease, head, "--", ...SEEDS])) {
  console.log("No seed changed since the last release: the demo data stays as it is.");
} else {
  console.log("A seed changed since the last release: loading the demo data again.");
  run("Reloading the demo data", "npm", ["run", "demo:db", "--", "reset", "--yes"], { MAESTRA_ENV_FILE: ENV_FILE });
}

// 5. Release
heading("the demo branch moves forward to main");
run("Pushing the demo branch", "git", ["push", "origin", `${head}:refs/heads/demo`]);
released = true;

// 6. Vercel's build
heading("waiting for Vercel to put it live");
const deadline = Date.now() + DEPLOY_MINUTES * 60_000;
for (;;) {
  const live = await liveCommit();
  if (live === head) break;
  if (Date.now() > deadline) stop(`The live demo didn't show ${head.slice(0, 7)} within ${DEPLOY_MINUTES} minutes. Look at Vercel → the demo project → Deployments: the build may have failed (the previous version stays live then).`);
  process.stdout.write(".");
  await new Promise((r) => setTimeout(r, 15_000));
}
console.log(`\nLive: ${SITE} runs ${head.slice(0, 7)}.`);

// 7. The demo's browser checks, on the live site
heading("the demo's checks on the live site");
run("The demo's checks", "npm", ["run", "test:demo"], { DEMO_URL: SITE });

console.log(`\nReleased ${head.slice(0, 7)} to ${SITE}.`);
