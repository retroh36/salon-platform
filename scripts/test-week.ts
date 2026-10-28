// npm run test:week [-- --yes] [-- --keep]
//
// Plays a busy week at Maple & Ash in the browser and checks that the
// calendar, Sales, Payroll, Inventory, Policy and Reports agree
// (e2e-week/week.spec.ts). It starts from the default seed's clear
// calendar, so it resets the local database first (asks, unless --yes),
// and puts the demo data back after (npm run seed:demo; --keep leaves the
// week as it ended, to look around).

import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { requireLocal } from "./local-only.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // The shell's settings, then.
}
requireLocal("npm run test:week");

if (!process.argv.includes("--yes")) {
  if (!process.stdin.isTTY) {
    console.error("This resets the local database. Run it with --yes to go ahead.");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("This resets the local database, so anything you've added locally goes. Continue? [y/N] ");
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) process.exit(0);
}

const run = (command: string, args: string[]) => execFileSync(command, args, { stdio: "inherit" });

console.log("Resetting the local database to the default seed…");
run("npx", ["supabase", "db", "reset"]);
let failed = false;
try {
  run("npx", ["playwright", "test", "--config", "e2e-week/playwright.config.ts"]);
} catch {
  failed = true;
}
if (process.argv.includes("--keep")) {
  console.log("The week is left as it ended. Run `npm run seed:demo` for the usual data.");
} else {
  console.log("Putting the demo data back…");
  run("npm", ["run", "seed:demo"]);
}
process.exit(failed ? 1 : 0);
