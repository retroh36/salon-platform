// npm run jobs -- configure [app url] | status | run <job> | off
//
// The scheduled jobs the database runs (pg_cron, docs/operations.md):
// configure tells it where the app is (the argument, else
// SCHEDULED_JOBS_APP_URL, else NEXT_PUBLIC_SITE_URL) and the CRON_SECRET to
// send, kept in Supabase Vault; status lists the jobs and their last runs;
// run starts one now (e.g. `run automations`); off clears the settings so
// the jobs do nothing. Never prints the secret.

import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to the environment.
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const [command, arg] = process.argv.slice(2);

if (command === "configure") {
  const appUrl = (arg ?? process.env.SCHEDULED_JOBS_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const secret = process.env.CRON_SECRET;
  if (!appUrl || !secret) {
    console.error("Give the app's address (or set SCHEDULED_JOBS_APP_URL) and set CRON_SECRET (the same value as the app's).");
    process.exit(1);
  }
  const { error } = await admin.rpc("configure_scheduled_jobs", { p_app_url: appUrl, p_secret: secret });
  if (error) throw error;
  console.log(`Scheduled jobs will call ${appUrl}/api/cron/… with the cron secret.`);
} else if (command === "off") {
  const { error } = await admin.rpc("configure_scheduled_jobs", { p_app_url: null as never, p_secret: null as never });
  if (error) throw error;
  console.log("Scheduled jobs are off (they run but do nothing).");
} else if (command === "run" && arg && /^[a-z-]+$/.test(arg)) {
  const { data, error } = await admin.rpc("run_scheduled_job_now", { p_path: `/api/cron/${arg}` });
  if (error) throw error;
  console.log(data === null ? "Scheduled jobs aren't configured: npm run jobs -- configure" : `Started /api/cron/${arg} (request ${data}).`);
} else if (command === "status") {
  const { data, error } = await admin.rpc("scheduled_jobs_status");
  if (error) throw error;
  const jobs = data as { name: string; schedule: string; active: boolean; configured: boolean; runs: { at: string; status: string }[] }[];
  console.log(jobs[0]?.configured ? "Configured." : "Not configured: the jobs run but do nothing (npm run jobs -- configure).");
  for (const j of jobs) console.log(`${j.name.padEnd(30)} ${j.schedule.padEnd(12)} UTC ${j.active ? "" : "(paused) "}${j.runs[0] ? `last ${j.runs[0].at}: ${j.runs[0].status}` : "not run yet"}`);
} else {
  console.error("Use: npm run jobs -- configure [app url] | status | run <job> | off");
  process.exit(1);
}
