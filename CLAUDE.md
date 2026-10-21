# Salon Platform — Project Instructions

A full salon management platform (booking, POS, inventory, reporting, marketing) built from scratch, with AI handling back-office work. The full product spec lives in `docs/spec.md` — read it before starting any new module.

## Stack
- **App:** Next.js (App Router) + TypeScript, Tailwind CSS
- **Database + auth + storage:** Supabase (Postgres). Schema changes go through SQL migrations in `supabase/migrations/` — never edit the database by hand.
- **Hosting:** Vercel (preview deploy on every push)
- **Later phases:** Stripe (Connect + Terminal), Twilio (SMS), email provider, Claude API

## Non-negotiable rules
1. **Multi-tenant from day one.** Every table with salon data has a `business_id`. Supabase Row Level Security (RLS) is enabled on every table so one salon can never see another's data. Write an RLS policy with every new table.
2. **Never store card numbers.** All payment data stays in Stripe.
3. **Secrets live in environment variables only** (`.env.local`, Vercel env settings). Never commit keys. `.env.local` stays in `.gitignore`.
4. **All AI actions go through the AI action log.** AI proposes a change → it's stored with the reason → a human approves (or auto-mode applies it) → it can be undone.
5. **AI never chats with clients.** Client messages use approved templates only.
6. **Booking rules live in one place** (`lib/scheduling/`), used by the calendar, online booking and the AI. No duplicate scheduling logic in UI code.
7. **Times are stored in UTC** and shown in the location's timezone.

## Core data model
Business → Location → Staff, Resource; Service, StaffService; Client; Appointment → AppointmentItem (service + staff + resource + times); Product, StockLevel, StockMovement; Sale, Payment; Notification; AiActionLog. See `docs/spec.md` for fields.

## How to work
- Build in thin slices: one feature per task, working end to end (database → API → UI).
- Write automated tests for every scheduling rule (no double-booking, processing gaps, staff hours, resource conflicts).
- Use the seed script (`supabase/seed.sql` or `scripts/seed.ts`) for realistic fake data: 1 business, 1 location, 6 stylists, ~40 services, ~500 clients, a month of appointments. Never use real client data in development.
- After each slice: run the linter, type check and tests, then summarize what changed and how to try it.
- Prefer simple, readable code over clever code. Ask before adding a new dependency.

## Commands
- `colima start` — start the Docker runtime that local Supabase needs (stop with `colima stop`)
- `npx supabase start` — start local Supabase (database, auth, Studio at http://127.0.0.1:54323)
- `npm run dev` — local app
- `npm run lint` / `npm run typecheck` / `npm test` — unit tests, no database needed
- `npm run test:db` — RLS and database tests; needs local Supabase running with the seed loaded
- `npm run test:e2e` — Playwright UI tests in `e2e/`; needs local Supabase with the seed, and uses the running dev server (or starts one). Fails on any browser console error, which includes Next.js dev overlay errors. First time: `npx playwright install chromium`
- `npx supabase db reset` — rebuild local database from migrations + seed
- `npm run db:types` — regenerate `lib/database.types.ts` after a migration

## Current phase
Phase 1 — Foundation: auth, business/location setup, staff (with schedules and skills), services, clients. Phorest import comes at the end of phase 1.
