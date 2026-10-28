# Operations: backups, restores and the owners' data export

A salon can't open its doors without its calendar, so its data has to survive a bad deploy, a mistaken delete or the loss of a provider. This page covers what is kept where, how it's backed up, how to restore it, and how the backup is checked.

## What lives where

| What | Where | In the database backups? |
| --- | --- | --- |
| Everything salons enter: clients, visits, formulas, sales, payments, gift cards, packages, stock, settings, the AI action log, logins | Supabase Postgres (`public`, `private`, `auth` schemas) | Yes |
| File metadata (which file belongs to which salon) | Supabase Postgres (`storage` schema) | Yes |
| The files themselves: salon logos, stylist photos, before and after photos | Supabase Storage buckets `salon-logos`, `staff-photos`, `visit-photos` | **No**: they have their own nightly backup (see [Files](#files-storage)) |
| Card details | Stripe only (never stored here) | Not applicable |
| Code | GitHub; Vercel builds every push | Git history |
| Secrets (`SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `PHOREST_*`) | Vercel environment settings and `.env.local` | No, on purpose; keep a copy in the team's password manager |

## Database backups (hosted Supabase)

The production database is a hosted Supabase project. Its backups are Supabase's, set in the dashboard under **Database → Backups**.

Required setup for production:

1. **A paid plan (Pro or above).** It includes daily backups kept for at least 7 days. Backups on the Free plan can't be downloaded or restored by you, so Free is never used for a salon's live data.
2. **Point-in-Time Recovery (PITR), turned on.** This is an add-on. It restores to any moment within its window, not just last night, so a mistaken delete at 3pm can be undone to 2:59pm. Use a window of at least 7 days.
3. **Retention long enough to notice a problem.** Seven days is the floor; 14 or more is better for small teams who might not notice a problem for a week.
4. **Someone who can restore.** At least two people with owner access to the Supabase organization, with two-factor authentication on.

Supabase's plans and add-ons change; check the current plan page when setting up or renewing, and record what's on in the table at the end of this page.

### Restoring

- **A mistake today (PITR):** Dashboard → Database → Backups → Point in time → pick the minute before the mistake. This restores the whole project to that moment, so everything after it is lost: note what changed since (sales taken, bookings made) before restoring, or restore into a **new project** instead and copy across only what was lost.
- **Last night's backup:** Dashboard → Database → Backups → Scheduled backups → Restore. This also replaces the whole project.
- **To a new project (safest for recovering a few rows):** download the backup (or `pg_dump` the live project with the connection string), `pg_restore` into a fresh project, then copy the rows you need back with SQL. Never edit production by hand otherwise; schema changes only go through `supabase/migrations/`.
- After any restore: run `npm run insights` against the project (Denise's learned figures are recalculated, not restored), and check the Dashboard, calendar and a sale load for one salon.

Restoring the database doesn't touch Storage, and vice versa.

## Files (Storage)

Supabase's database backups don't include the files in Storage buckets; they only include the `storage.objects` rows that point at them. Before and after photos can't be replaced, so the files have their own backup (`lib/photo-backup.ts`):

- **Every night** (the `maestra-photo-backup` job, below) new and changed files in `visit-photos`, `staff-photos` and `salon-logos` are copied to a private backup bucket, at `<bucket>/<path>`. Only the service role can read or write it (no storage policies).
- **Where:** set `PHOTO_BACKUP_SUPABASE_URL` and `PHOTO_BACKUP_SECRET_KEY` (and optionally `PHOTO_BACKUP_BUCKET`) in Vercel to copy into a bucket in a **separate Supabase project**, ideally in another organization, so losing this project doesn't lose the photos. Create a private bucket there first (default name `photo-backups`). Without those settings, the copy goes to the `photo-backups` bucket in this project, which protects against deleted files but not against losing the project.
- **Deleted photos:** a file deleted here stays in the backup for 30 days, so a mistake can be undone, then it's removed from the backup too, so a client's photo doesn't outlive its deletion. The backup keeps a `_manifest.json` of what's waiting to be removed.
- **Restoring:** `npm run photos -- restore` puts back every file that's in the backup but missing here; add a prefix to restore only part, e.g. `npm run photos -- restore visit-photos/<business id>/`. Restoring never overwrites a file that's still here. After restoring into a new project, restore the database first, so the `visit_photos` rows point at the files.
- **By hand:** `npm run photos -- backup` copies now; `npm run photos -- verify` checks every file has an identical copy (by SHA-256) and lists any that don't.

## The owners' own copy: "Your data is yours"

Owners can download all their salon's data at any time from **Settings → Your data** (`/settings/data`). The download is one zip of CSV files: clients, visits, formulas, sales (lines, payments, tips), products, gift cards (and their history), packages, services and the team, with a README explaining them (`lib/data-export.ts`). Every download is logged in `data_exports` (who, when, how many rows, how big) and listed on that page. It's the salon's own portable copy, not a replacement for the database backups: it can't be restored into the app automatically.

## Checking the backups

A backup that has never been restored isn't a backup. Two checks:

**Every month, and after any big migration: the local drill.**

```
npm run seed:demo      # local Supabase with the busy demo data
npm run backup:drill   # scripts/backup-drill.sh
```

The drill dumps the local database the way a backup does (the `public`, `private`, `auth` and `storage` schemas), restores it into a scratch database, and checks that every table came back with the same number of rows, and that row level security, its policies, the database functions and triggers all came back too. It prints table names and counts only, never data, and drops the scratch database afterwards. It fails if anything differs or the restore reports an error (other than Supabase's own default privileges, which a plain role can't restore and which the app doesn't rely on).

Then it checks the photo backup (`scripts/photo-backup-drill.ts`), with a test file of its own (never a real photo): the backup copies it byte for byte; after it's deleted here it's still in the backup and restores identical; 30 days after a deletion it's gone from the backup; and every real file has an identical copy.

Last run: 2026-10-23, passed: 104 tables, 24,078 rows, 67 tables with row level security, 125 policies, 100 functions.

**Every quarter: a real restore of production.**

1. Restore the latest production backup (or PITR to a recent minute) into a **new, temporary** Supabase project; never over production.
2. Compare row counts with production for the main tables (`clients`, `appointments`, `sales`, `payments`, `gift_cards`, `client_packages`) using the counting query in `scripts/backup-drill.sh`; they should match, allowing for what happened since the backup.
3. Point a local checkout at it (`.env.local`) and open the calendar, a client and a sale.
4. Run `npm run photos -- verify` against production (it reads only), and restore one photo into the temporary project's bucket to see it open.
5. Write the date and result below, then delete the temporary project.

## Record

| Date | Check | Result | By |
| --- | --- | --- | --- |
| 2026-10-23 | Local drill (`npm run backup:drill`) | Passed: all 104 tables, RLS, policies and functions restored | Claude (set-up) |
| 2026-10-23 | Local drill with the photo backup | Passed: copied, kept after deletion, restored byte for byte, removed after 30 days | Claude (set-up) |
| | Production: `PHOTO_BACKUP_*` pointing at a separate project, and the first `npm run photos -- verify` | To do when production is set up | |
| | Hosted project: plan, PITR window and retention confirmed in the dashboard | To do when production is set up | |
| | First quarterly production restore | To do | |

## Login emails (invites and password resets)

Staff logins are invited from the Team page, and anyone can reset a forgotten password from the sign-in page. Supabase Auth sends those emails, so the hosted project needs, once:

1. **Authentication → URL Configuration:** Site URL set to the app's address (the emails link to `<Site URL>/auth/confirm`).
2. **Authentication → Email Templates:** the Invite user and Reset password templates (subject and body) copied from `supabase/templates/invite.html` and `recovery.html`, with the subjects in `supabase/config.toml`. Their links must stay `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` (or `recovery`).
3. **Authentication → SMTP Settings:** a real email provider. Supabase's built-in sender is only for trying things out (a few emails an hour, to team addresses).

Locally the emails land in Mailpit at http://127.0.0.1:54324; restart local Supabase after changing a template.

## Scheduled jobs

The database runs them (Supabase's scheduler, `pg_cron`), so they work on any Vercel plan, including the free one (whose own cron jobs are limited). Each job calls one of the app's endpoints, `/api/cron/<job>`, through `pg_net`, with `CRON_SECRET` as a bearer token; the endpoints refuse anything else. The jobs and their schedule are in `supabase/migrations/…_scheduled_jobs.sql`.

| Job | Endpoint | When (UTC) | Chicago | What it does |
| --- | --- | --- | --- | --- |
| `maestra-photo-backup` | `/api/cron/photo-backup` | 07:00 daily | 1 or 2am | Copies new and changed Storage files to the backup |
| `maestra-insights` | `/api/cron/insights` | 08:00 daily | 2 or 3am | Recalculates what Denise has learned for every salon |
| `maestra-risk-check` | `/api/cron/risk` | 09:00 daily | 3 or 4am | Denise's risk check on each location's day: fixes for visits likely to run over, waiting for staff to approve |
| `maestra-memberships` | `/api/cron/memberships` | 10:00 daily | 4 or 5am | Membership renewals, retries of failed payments, pauses and endings that start |
| `maestra-risk-check-morning` | `/api/cron/risk` | 12:00 daily | 6 or 7am | The risk check again, with the night's online bookings, before the salon opens |
| `maestra-automations` | `/api/cron/automations` | :15 every hour | | Rebook reminders, win-back, birthday and review messages that are due (each salon's sending hours, 9am to 8pm local, are checked in the app) |
| `maestra-policy-fees` | `/api/cron/fees` | every 15 minutes | | Late-cancel and no-show fees whose 10 minutes are up, charged to the card on file (with receipts), refunds of waived fees and of deposits the salon owes back |
| `maestra-events` | `/api/cron/events` | :45 every hour | | Events: reminders three days before a scheduled payment, scheduled payments and balances that are due, charged to the card on file, and their receipts (each salon's 9am to 8pm, local) |

Appointment reminders (texts before a visit) don't exist yet; they come with texts and email. When they do, they'll be one more job here.

**Setting up an environment** (once for production, once for any preview project that should run jobs):

1. Set `CRON_SECRET` (at least 16 random characters) in the app's environment (Vercel → Settings → Environment Variables), and redeploy.
2. With that project's `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` and the same `CRON_SECRET` in your environment, run `npm run jobs -- configure https://<the app's address>`. This stores the address and secret in the project's Vault; nothing else holds them.
3. `npm run jobs -- run insights` starts one now; `npm run jobs -- status` shows every job, its schedule and its last runs. `npm run jobs -- off` stops them calling the app.

Until it's configured, the jobs run but do nothing. Locally they're off; run the same jobs by hand with `npm run insights`, `npm run photos -- backup`, or the "Run renewals now" and "Send due messages now" buttons.

**If a job fails:** `npm run jobs -- status` shows whether the database ran it; the request and the app's answer are in `net._http_response` for a while, and the endpoint's errors are in the app's logs (Vercel → Logs). Each job must finish within the plan's time limit for a function; the insights job is the longest, so watch it as salons are added. Every job is safe to run again: renewals and messages are recorded once, and copies skip what's already backed up.

## The public demo

A separate deployment for salon owners and stylists to try Maestra: its own Vercel project and its own Supabase project (`maestra-demo`), with only the seeded salons in it. `DEMO_MODE=true` turns on everything below; without it none of it exists, so a real deployment never behaves like the demo (`lib/demo.ts`).

**What's different in the demo**

- A slim bar on every page: "Demo: fake data, resets nightly. Don't enter real client info.", with the demo outbox and **Feedback** (`components/demo-bar.tsx`). Notes go to `demo_feedback` with the page (tokens taken out), the role and salon, and the time; only the service role reads it, so view it in the Supabase dashboard (Table Editor → `demo_feedback`). It survives the nightly reset.
- The sign-in page is one-tap buttons (`app/login/demo-logins.tsx`, `demoSignIn` in `app/demo/actions.ts`): Maple & Ash's owner, manager, front desk and Bridget, Harbor & Vine's owner, and a client (Aurora Baker, signed in to her account on Maple & Ash's booking site). The front desk and Harbor & Vine open on the calendar's next day with visits (Maple & Ash is closed Sundays and Mondays).
- Nothing is sent: codes show on screen (`DemoCode`), and every text and email is in the outbox at `/dev/outbox`. Invites, password resets and password changes are off, and the demo's sign-in accounts can't be changed or deactivated.
- Payments use the test provider (no `STRIPE_SECRET_KEY`): test cards …4242 (works), …0002 (declined), …9995 (insufficient funds), listed on every card form.
- Denise is live, on an allowance per salon per day (`DEMO_AI_DAILY_TOKENS`, default 250,000 tokens, whatever Settings says), with her own message when it's used up, and 20 questions per connection every 10 minutes.
- Sign-in, one-tap sign-in and feedback are rate limited per connection (`hit_rate_limit`).
- `/api/demo/status` says what's set, yes or no, never a value, and the commit it was built from.

**Its settings** (Vercel → the demo project → Settings → Environment Variables, for Production and Preview):

| Variable | Value |
| --- | --- |
| `DEMO_MODE` | `true` |
| `NEXT_PUBLIC_SUPABASE_URL` | the demo project's URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | its publishable key |
| `SUPABASE_SECRET_KEY` | its secret key |
| `NEXT_PUBLIC_SITE_URL` | the demo's address, e.g. `https://maestra-demo.vercel.app` |
| `CRON_SECRET` | a new random string, used only by the demo |
| `ANTHROPIC_API_KEY` | a key for the demo (a separate key with its own spend limit in the Anthropic console is best) |
| `DEMO_AI_DAILY_TOKENS` | optional, Denise's allowance per salon per day |

Never set `PHOREST_*`, `STRIPE_SECRET_KEY`, `TWILIO_AUTH_TOKEN` or the photo backup's settings there.

**The database.** `npm run demo:db` works on the demo's project, with its settings in `.env.demo.local` (git-ignored) and `MAESTRA_ENV_FILE=.env.demo.local` in front of the command: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DEMO_DATABASE_URL` (Connect → Session pooler; GitHub can't reach the direct one) and `CRON_SECRET`.

- `migrate` applies every migration (`supabase db push`).
- `reset --yes` is the nightly reset. First it checks the database has exactly the migrations the code running it has, and stops without changing anything if not (the seeds are written for those tables). Then, in one transaction, it empties every table but `demo_feedback`, deletes the logins, loads `seed.sql`, `seed-demo-open-daily.sql` (the demo only: Maple & Ash open Sundays and Mondays too, so both salons are open every day and today always has visits), `seed-demo.sql` and `seed-large.sql` and sets Denise's allowance: if anything fails, it all rolls back and yesterday's data stays. Then it removes stored files, recalculates insights and checks both salons have active staff and visits today. It refuses a database with any salon besides the two seeded ones, and one whose connection string isn't for the same project as the URL. `check` checks the migrations too.
- `check [app url]` shows Row Level Security is on for every table, only the seeded salons are there, and, given the app's address, what the deployed app has set.

**Nightly reset.** `.github/workflows/demo-reset.yml` runs `reset` at 07:30 UTC (GitHub often starts scheduled runs hours late), and on Actions → Reset the demo → Run workflow. It checks out the `demo` branch, so it runs the code that's live, never main's: on 2026-10-28 it ran main's seeds, which needed the scheduling tables, against a demo database that didn't have them yet, and stopped partway after emptying it. A failed run emails whoever last changed the workflow's schedule (GitHub → Settings → Notifications → Actions). It needs repository secrets `DEMO_DATABASE_URL`, `DEMO_SUPABASE_URL` and `DEMO_SUPABASE_SECRET_KEY` (and optionally a variable `DEMO_AI_DAILY_TOKENS`). GitHub turns scheduled workflows off after 60 days without a commit; Actions shows it, and "Enable workflow" turns it back on.

**Scheduled jobs.** `MAESTRA_ENV_FILE=.env.demo.local npm run jobs -- configure https://<the demo's address>`, as for any environment. They run on the demo's data (test cards only).

**Releasing to it.** `npm run release:demo` from a clean, pushed main: the local checks and the week, the demo database's migrations and safety check, the demo data again if a seed changed, then the `demo` branch pushed (Vercel builds the demo from it: Settings → Environments → Production → Branch Tracking is `demo`), a wait until `/api/demo/status` shows the new commit, and the demo's checks against the live site. It stops at the first failure, and says what changed by then. If the live checks fail after the push, roll back in Vercel (Deployments → the previous one → Instant Rollback).

**Checking it.** `npm run test:demo` runs the demo's checks (`e2e-demo/`) against a local server with `DEMO_MODE=true`, or with `DEMO_URL=https://…` against a deployment (only reading, apart from a client's sign-in code). For a protected preview, put the project's `VERCEL_AUTOMATION_BYPASS_SECRET` in `.env.local`.

## Local development: stale styles

**What happened.** After the navy sidebar arrived, a dev server that had been running since before it showed the sidebar with white text on the old light background: the Maestra logo, the salon's name, the current page and the signed-in name were all invisible. Restarting the dev server fixed it. Classes the app already used elsewhere, like `text-white`, applied; the new color classes (`bg-sidebar`, `text-sidebar-text`) didn't.

**Why.** The dev server (Next.js 16 with Turbopack) can serve `app/globals.css` one save behind: on Oct 27, 2026, saving a value of 74% served the 75% from the save before, and saving 75% again then served 74%. Touching the file without changing it doesn't rebuild it. So the stylesheet reaching the browser can be missing whatever the last save added, until the next save or a restart. Production builds (Vercel, and the test, week and screenshot builds) compile from scratch and aren't affected.

**Why the sidebar can't break the same way again.** Its background and text colors are now also set in plain CSS in `app/globals.css` (`[data-sidebar]`, with the colors written in), so they don't depend on a new class being in the stylesheet. `e2e/sidebar.spec.ts` checks the sidebar's real background and that its salon name, links and signed-in name pass AA.

**If styles look wrong or old in development** (colors missing, a component unstyled, a change not showing): save `app/globals.css` once more with any real change (and undo it), or stop the dev server, delete the cache and start it again:

```
rm -rf .next
npm run dev
```

The first load of each page is slower afterwards while it compiles. The test, week and screenshot builds have their own folders (`.next-e2e`, `.next-week`, `.next-screenshots`) and aren't affected.
