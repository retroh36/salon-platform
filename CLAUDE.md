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
7. **Times are stored in UTC** and shown in the location's timezone. Exception: recurring schedules (opening hours, working hours, one-off changes, time off) are local wall-clock times (minutes since midnight on local dates), so a 9:00 shift stays 9:00 across daylight saving. Convert between the two only with `lib/scheduling/time.ts` (`toLocal`, `fromLocal`).

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
- `npm run import:phorest:dry-run` — calls the **real** Phorest API (GET only) with the `PHOREST_*` credentials in `.env.local`, maps everything and prints only record counts and mapping issues; saves nothing. Ask the user before running it. `-- --months-back=N --months-ahead=N` sets the appointment range (default 24 and 12)

## Phorest importer (`lib/import/phorest/`)
- **Read-only toward Phorest.** All requests go through `http.ts`, which only sends GET (enforced in `readOnlyFetch`, proved by `tests/unit/phorest/http.test.ts`). Never add another way to call Phorest.
- **Never print or log** Phorest credentials, the business ID, or any record values. Report problems through `IssueLog` (entity, field, reason, count: no values) and errors as status + endpoint template.
- Modules under `lib/import/` and `lib/scheduling/` run under plain Node (for the dry-run script), so relative imports use explicit `.ts` extensions and avoid TypeScript-only runtime syntax (enums, parameter properties).

## Design (`docs/design/`)
- Mockups: `docs/design/mockup-1.png` (features) and `mockup-2.png` (visual style).
- Tokens (colors, fonts, radius, shadows, motion) live in `app/globals.css` under `@theme`. Every text/background pair must pass WCAG AA: add new pairs to `tests/unit/design-tokens.test.ts`.
- Shared components are in `components/ui/`: Button, fields (`fieldClass`, `selectClass`, `checkboxClass`), page blocks (`PageHeader`, `Card`, `Badge`, `Alert`), Avatar, StatusChip, Tabs, Segmented, Listbox, DatePicker, FitText (text that shortens instead of being cut off), icons and the AppFrame layout. Every page uses `AppShell` (`components/app-shell.tsx`), which wraps AppFrame. Use only token colors, not Tailwind's palette (`neutral-*` and so on).
- Motion is CSS only, with no animation library: transitions use `duration-(--motion-fast|base|slow)` (150-250ms), and day changes use React `<ViewTransition>`. `prefers-reduced-motion` turns all of it off (see the end of `globals.css`).

## Scheduling (`lib/scheduling/`)
- `availability.ts`: when a staff member can work (opening hours, shifts, one-off changes, approved time off).
- `booking.ts`: whether an appointment item can be booked (`checkItem`, `checkAppointment`), with a reason code for each problem. Processing time is free for the stylist but not for the chair or room. Any code that creates or moves appointments must check here first.
- `load.ts`: loads schedules and a `BookingContext` from Supabase for those checks.
- `book.ts`: the only way to book, edit or move appointments, and to change their status or notes. It checks the rules, then saves through the database functions `save_appointment`, `set_appointment_status` and `set_appointment_notes`, which record who made the change. Appointments and items can't be written directly (no RLS write policies). A per-location `calendar_version` stops two people booking the same slot at once: a save checked against an out-of-date calendar is refused and re-checked.

## Current phase
Phase 1 (foundation) is done, apart from the Phorest import, which is paused waiting on credentials (see `docs/backlog.md`). Phase 2: calendar and booking. Done so far: resources, appointments, booking rules, the day-view calendar, and booking, editing, moving and status changes from it. Next: online booking.
