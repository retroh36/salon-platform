# Operations: backups, restores and the owners' data export

A salon can't open its doors without its calendar, so its data has to survive a bad deploy, a mistaken delete or the loss of a provider. This page covers what is kept where, how it's backed up, how to restore it, and how the backup is checked.

## What lives where

| What | Where | In the database backups? |
| --- | --- | --- |
| Everything salons enter: clients, visits, formulas, sales, payments, gift cards, packages, stock, settings, the AI action log, logins | Supabase Postgres (`public`, `private`, `auth` schemas) | Yes |
| File metadata (which file belongs to which salon) | Supabase Postgres (`storage` schema) | Yes |
| The files themselves: salon logos, stylist photos, before and after photos | Supabase Storage buckets `salon-logos`, `staff-photos`, `visit-photos` | **No** (see [Files](#files-storage)) |
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

Supabase's database backups don't include the files in Storage buckets; they only include the `storage.objects` rows that point at them. Logos and stylist photos can be uploaded again, but **before and after photos can't be replaced**, so they need a backup of their own:

- Copy the buckets every night to separate object storage in another account (an S3 or R2 bucket with versioning on and no public access), using the service role key from a scheduled job. The `visit-photos` copy must stay private: it holds client photos.
- Until that job exists, this is a known gap (`docs/backlog.md`, Operations).

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

Last run: 2026-10-23, passed: 104 tables, 24,078 rows, 67 tables with row level security, 125 policies, 100 functions.

**Every quarter: a real restore of production.**

1. Restore the latest production backup (or PITR to a recent minute) into a **new, temporary** Supabase project; never over production.
2. Compare row counts with production for the main tables (`clients`, `appointments`, `sales`, `payments`, `gift_cards`, `client_packages`) using the counting query in `scripts/backup-drill.sh`; they should match, allowing for what happened since the backup.
3. Point a local checkout at it (`.env.local`) and open the calendar, a client and a sale.
4. Write the date and result below, then delete the temporary project.

## Record

| Date | Check | Result | By |
| --- | --- | --- | --- |
| 2026-10-23 | Local drill (`npm run backup:drill`) | Passed: all 104 tables, RLS, policies and functions restored | Claude (set-up) |
| | Hosted project: plan, PITR window and retention confirmed in the dashboard | To do when production is set up | |
| | First quarterly production restore | To do | |
