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

## Denise (the AI assistant)
- Denise (short for DNIS, Digital Navigator of Issues and Scheduling) is the name for the AI everywhere in the app. She speaks in first person, briefly and warmly. Art is in `public/brand/denise/` (`wave`: nothing to do, `think`: working, `point`: presenting a fix, `face`: small icon). Periwinkle is her color, only for her messages, suggestions and badge; plum stays the app's main color.
- `lib/scheduling/ai-actions.ts` is the AI action log: Denise records proposals (`recordProposals`, up to 3 ranked options per problem, keyed by a subject like `overrun:<id>`), and staff apply, reject or undo them (`applyAction`, `rejectAction`, `undoAction`). Applying and undoing check the booking rules (`checkMoves`, `checkAppointment`) first, then call the database functions `apply_ai_action` / `undo_ai_action`, which check nothing changed since, record the exact previous state and restore it. Only booked and confirmed visits are ever moved. The `ai_actions` table can't be written directly.
- `lib/scheduling/disruptions.ts`: staff report a visit running over or a client running late (`reportRunningLate`: which one depends on whether the client has checked in) and a stylist out for the rest of the day (`reportCallOut`, which also adds approved time off). Stored in `schedule_disruptions`.
- `lib/scheduling/resolve.ts` (pure): `findConflicts` applies the reports to the day (`effectiveCalendar`), finds overruns, late clients, call-outs and double-bookings, and searches for up to 3 fixes each, ranked by fewest clients moved, then the smallest delay (a stylist change counts as 30 minutes). It never moves checked-in or finished visits, or anyone earlier or into the past, and every option passes `checkMoves`.
- `lib/denise/`: `scan.ts` loads a day, finds conflicts, words them (`wording.ts`, first person) and records them as proposals with the notifications they'd send (`lib/notifications.ts`: fixed templates for clients, never AI text). `fixes.ts` approves (re-checking the rules against the day with its reports), rejects and undoes. Notifications are only recorded in `notifications` for now; nothing is sent.
- On the calendar (`app/calendar/denise-panel.tsx`, `denise-actions.ts`): Denise's tab (with a badge), a toast when she spots something new, glowing blocks and dashed previews of where a fix would move them, Apply / Dismiss / Undo, and "Running late" (appointment panel) and "Out for the day" (stylist header menu). Her art is `components/denise.tsx` (`DenisePose`, `DeniseFace`); colors are the `denise-*` tokens.
- Claude (`lib/denise/claude.ts`, `@anthropic-ai/sdk`, model `claude-haiku-5-5`) is used only when `ANTHROPIC_API_KEY` is set: it writes the explanations of fixes (kept while a fix is unchanged) and answers "Ask Denise" (`lib/denise/assistant.ts`) through tools that call the scheduling functions (`findOpenings` in `lib/scheduling/openings.ts`, `checkAppointment`). It never writes to the database: `propose_booking` records a proposal staff approve, choosing the client then. Send Claude first names and scheduling facts only, never client phone numbers, emails, allergies or notes, and never log the key. Tests use a fake client; no test calls the real API.

## Inventory
- Tables: `suppliers`, `products` (brand, line, shade/name, SKU, barcode, type `retail` / `back_bar`, unit `g` / `ml` / `unit`, container `size`, cost, retail price, shelf), `stock_levels` (on hand, reorder point and quantity, per location) and `stock_movements` (every change with its reason: `service_use`, `sale`, `count`, `order_received`, `adjustment`, and the amount after it).
- Amounts are in the product's unit, so back-bar color is tracked in grams or ml, partly used tubes included; retail is in whole units. `lib/inventory.ts` has the formatting, value, low-stock, filter and form helpers.
- On hand only changes through `private.move_stock`, called by the database functions for each flow (`adjust_stock` for sales and adjustments; later stages add service use, orders and counts). Stock levels and movements can't be written directly.
- Color usage (`lib/color-usage.ts`): a formula entry can be tied to a service on a visit (`client_formulas.appointment_item_id`) and list products and amounts (`formula_products`), recorded with `add_formula` from the appointment panel or the client profile. Services have default recipes (`service_products`, set with `set_service_recipe`). Checking a visit out runs `private.deduct_item_stock` for each service: the latest formula with products, or else the recipe. It moves only the difference from what's already been taken, so formulas recorded or corrected after checkout put stock right.
- Ordering (`lib/purchase-orders.ts`, `/inventory/orders`): `purchase_orders` go draft → sent → partly received → received. Owners and managers write (`save_purchase_order`), send and delete drafts; the front desk receives (`receive_purchase_order`), which adds containers × size to stock as `order_received` movements and records the cost paid as the product's cost. Low stock (below the reorder point) is flagged on the Inventory page and the Dashboard.
- Denise's reorders (`lib/denise/reorder.ts`, pure forecast in `lib/inventory-forecast.ts`): from stock on hand and on order, and what the next two weeks of bookings will use (the visit's formula, else the client's latest for that service, else their latest color formula, else the recipe), she suggests one order per supplier, recorded in the AI action log (feature `reorder`). A manager approves it into a draft order (`apply_reorder_draft`, undo with `undo_reorder_draft` until it's sent); nothing is ordered automatically.
- Permissions: owners and managers manage everything; the front desk sells retail and receives orders; stylists record formulas and view stock (`canManageInventory`, `canSellRetail`, `canReceiveOrders`). The database enforces the same.

## Current phase
Phase 1 (foundation) is done, apart from the Phorest import, which is paused waiting on credentials (see `docs/backlog.md`). Phase 2: calendar and booking. Done so far: resources, appointments, booking rules, the day-view calendar, and booking, editing, moving and status changes from it; Denise (AI action log with undo, conflict resolver, her panel, and Ask Denise with Claude). Next: online booking.
