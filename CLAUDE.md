# Maestra — Project Instructions

Maestra is a full salon management platform (booking, POS, inventory, reporting, marketing) built from scratch, with AI (Denise) handling back-office work. The full product spec lives in `docs/spec.md` — read it before starting any new module.

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
- Use the seed for realistic fake data. `supabase/seed.sql` (the default, loaded by `npx supabase db reset`): 1 business, 1 location, the team (owner, manager, front desk and seven stylists, each with a login), ~40 services with level prices, ~500 clients, products, forms and settings, and a clear calendar. `supabase/seed-demo.sql` (`npm run seed:demo`) adds a busy month on top: appointments, time off, blocked time and a waitlist. Never use real client data in development.
- After each slice: run the linter, type check and tests, then summarize what changed and how to try it.
- Prefer simple, readable code over clever code. Ask before adding a new dependency.

## Commands
- `colima start` — start the Docker runtime that local Supabase needs (stop with `colima stop`)
- `npx supabase start` — start local Supabase (database, auth, Studio at http://127.0.0.1:54323)
- `npm run dev` — local app
- `npm run lint` / `npm run typecheck` / `npm test` — unit tests, no database needed
- `npm run test:db` — RLS and database tests; needs local Supabase running with the demo data (`npm run seed:demo`)
- `npm run test:e2e` — Playwright UI tests in `e2e/`; needs local Supabase with the demo data, and uses the running dev server (or starts one). Fails on any browser console error, which includes Next.js dev overlay errors. First time: `npx playwright install chromium`
- `npx supabase db reset` — rebuild local database from migrations + the default seed (clear calendar)
- `npm run seed:demo` — reset, then add the busy demo month (`supabase/seed-demo.sql`, loaded with `psql` in the database container); the tests need it
- `npm run db:types` — regenerate `lib/database.types.ts` after a migration
- `npm run import:phorest:dry-run` — calls the **real** Phorest API (GET only) with the `PHOREST_*` credentials in `.env.local`, maps everything and prints only record counts and mapping issues; saves nothing. Ask the user before running it. `-- --months-back=N --months-ahead=N` sets the appointment range (default 24 and 12)

## Phorest importer (`lib/import/phorest/`)
- **Read-only toward Phorest.** All requests go through `http.ts`, which only sends GET (enforced in `readOnlyFetch`, proved by `tests/unit/phorest/http.test.ts`). Never add another way to call Phorest.
- **Never print or log** Phorest credentials, the business ID, or any record values. Report problems through `IssueLog` (entity, field, reason, count: no values) and errors as status + endpoint template.
- Modules under `lib/import/` and `lib/scheduling/` run under plain Node (for the dry-run script), so relative imports use explicit `.ts` extensions and avoid TypeScript-only runtime syntax (enums, parameter properties).

## Brand (`docs/brand.md`)
- **Follow `docs/brand.md` for anything users see**: the name, logo files and their sizes, colors and their roles, typography, voice and Denise. Keep the two brands apart: Maestra (login, browser tab and icons, loading screen, platform emails, "Powered by Maestra") and the salon's own (its name and logo at the top of the sidebar and on messages to its clients). Logo files are in `public/brand/maestra/`; don't redraw or recolor them.

## Design (`docs/design/`)
- Mockups: `docs/design/mockup-1.png` (features) and `mockup-2.png` (visual style).
- Tokens (colors, fonts, radius, shadows, motion) live in `app/globals.css` under `@theme`. Every text/background pair must pass WCAG AA: add new pairs to `tests/unit/design-tokens.test.ts`.
- Shared components are in `components/ui/`: Button, fields (`fieldClass`, `selectClass`, `checkboxClass`), page blocks (`PageHeader`, `Card`, `Badge`, `Alert`), Avatar, StatusChip, Tabs, Segmented, Listbox, DatePicker, FitText (text that shortens instead of being cut off), icons and the AppFrame layout. Every page uses `AppShell` (`components/app-shell.tsx`), which wraps AppFrame. Use only token colors, not Tailwind's palette (`neutral-*` and so on).
- Motion is CSS only, with no animation library: transitions use `duration-(--motion-fast|base|slow)` (150-250ms), and day changes use React `<ViewTransition>`. `prefers-reduced-motion` turns all of it off (see the end of `globals.css`).

## Team, levels and prices
- Stylists have a level: Artisan, Senior or Master (`staff.level`, `STAFF_LEVELS` in `lib/schedule-forms.ts`). It's set in staff settings (Schedule page); on the calendar it shows only as color (gold, silver, bronze: the `level-*` tokens), as a ring around the avatar (`Avatar level`) and a bar along the top of the column, with a legend entry. No level text on the calendar.
- A stylist's price for a service is their own (`staff_services.price_cents`), else their level's (`service_level_prices`, set with `set_service_level_prices`), else the menu price. `stylistPrice` in `lib/services.ts` and `private.stylist_price` in the database work it out the same way; booking and Denise's fixes use the database one.

## Scheduling (`lib/scheduling/`)
- `availability.ts`: when a staff member can work (opening hours, shifts, one-off changes, approved time off).
- `booking.ts`: whether an appointment item can be booked (`checkItem`, `checkAppointment`), with a reason code for each problem. Processing time is free for the stylist but not for the chair or room. Any code that creates or moves appointments must check here first.
- `load.ts`: loads schedules and a `BookingContext` from Supabase for those checks.
- `blocks.ts`: blocked time (lunch, break, training, meeting, personal), one-off or repeating on weekdays, in wall-clock minutes (`time_blocks`, with `time_block_skips` for days taken out). The booking rules treat each occurrence like another client: the stylist's busy time can't overlap it (processing can). Moving one day of a repeating block (`move_time_block`) skips that day and adds a one-off. Denise's resolver may move a lunch or break by up to 30 minutes as part of a fix (never training, meetings or personal time); the move is in the proposal (`block_moves`) and undo puts it back.
- `series.ts` / `series-book.ts`: recurring appointments (`appointment_series`; each visit is an ordinary appointment with `series_id` and `series_index`). `planSeries` checks every date and suggests alternatives (nearest time that day, another stylist, a nearby day); `bookSeries` saves visit by visit through `saveBooking`. Edits, drag-moves and cancellations apply to this visit, this and following, or all (`visitsInScope`), each visit checked on its own; ones that don't fit are reported.
- `patch-tests.ts`: whether a client's patch tests cover a service that needs one (`services.requires_patch_test`), by the salon's rules (`businesses.patch_test_*`). With enforcement `block`, `saveBooking` refuses with a `patch_test` problem; otherwise `lib/client-checks.ts` (`visitWarnings`) warns in the booking and details panels, along with required forms not yet signed (`lib/forms.ts`).
- `waitlist.ts`: free time, the opening a cancellation, no-show or applied Denise fix leaves (`openingAround`), waitlist clients who fit it (`matchOpening`: asked for the stylist first, then longest waiting), and the next free qualified stylist for walk-ins (`nextFree`, `walkInQueue`). Loading and booking live in `lib/waitlist-load.ts` and `lib/waitlist-book.ts` (through `saveBooking`). Denise shows openings in her panel; staff book and contact the client.
- `groups.ts` / `group-book.ts`: group bookings (`appointment_groups`; each guest is an ordinary appointment with `group_id`). `checkGroup` checks all guests together; `bookGroup` books everyone or no one; `moveGroupItem` moves the whole party by the same amount (checked as one change first); `changeGroupStatus` cancels everyone. The resolver keeps groups together when they fit within about an hour (`GROUP_SPLIT_MINUTES` in `resolve.ts`).
- `book.ts`: the only way to book, edit or move appointments, and to change their status or notes. It checks the rules, then saves through the database functions `save_appointment`, `set_appointment_status` and `set_appointment_notes`, which record who made the change. Appointments and items can't be written directly (no RLS write policies). A per-location `calendar_version` stops two people booking the same slot at once: a save checked against an out-of-date calendar is refused and re-checked.

## Denise (the AI assistant)
- Denise (short for DNIS, Digital Navigator of Issues and Scheduling) is the name for the AI everywhere in the app. She speaks in first person, briefly and warmly. Art is in `public/brand/denise/` (`wave`: nothing to do, `think`: working, `point`: presenting a fix, `face`: small icon). Periwinkle is her color, only for her messages, suggestions and badge; navy (from the Maestra logo) is the app's main color.
- `lib/scheduling/ai-actions.ts` is the AI action log: Denise records proposals (`recordProposals`, up to 3 ranked options per problem, keyed by a subject like `overrun:<id>`), and staff apply, reject or undo them (`applyAction`, `rejectAction`, `undoAction`). Applying and undoing check the booking rules (`checkMoves`, `checkAppointment`) first, then call the database functions `apply_ai_action` / `undo_ai_action`, which check nothing changed since, record the exact previous state and restore it. Only booked and confirmed visits are ever moved. The `ai_actions` table can't be written directly.
- `lib/scheduling/disruptions.ts`: staff report a visit running over or a client running late (`reportRunningLate`: which one depends on whether the client has checked in) and a stylist out for the rest of the day (`reportCallOut`, which also adds approved time off). Stored in `schedule_disruptions`.
- `lib/scheduling/resolve.ts` (pure): `findConflicts` applies the reports to the day (`effectiveCalendar`), finds overruns, late clients, call-outs and double-bookings, and searches for up to 3 fixes each, ranked by fewest clients moved, then the smallest delay (a stylist change counts as 30 minutes). It never moves checked-in or finished visits, or anyone earlier or into the past, and every option passes `checkMoves`.
- `lib/denise/`: `scan.ts` loads a day, finds conflicts, words them (`wording.ts`, first person) and records them as proposals with the notifications they'd send (`lib/notifications.ts`: fixed templates for clients, never AI text). `fixes.ts` approves (re-checking the rules against the day with its reports), rejects and undoes. Notifications are only recorded in `notifications` for now; nothing is sent.
- On the calendar (`app/calendar/denise-panel.tsx`, `denise-actions.ts`): the right panel is closed until something opens it (an appointment, a new booking, a new conflict or reorder, a question for Denise) and closes with X, Escape or a click on empty calendar space; while closed, Denise's face sits in the corner with a badge that bounces for anything new. Her tab shows glowing blocks and dashed previews of where a fix would move them, Apply / Dismiss / Undo, and "Running late" (appointment panel) and "Out for the day" (stylist header menu). Her art is `components/denise.tsx` (`DenisePose`, `DeniseFace`); colors are the `denise-*` tokens.
- Claude (`lib/denise/claude.ts`, `@anthropic-ai/sdk`, model `claude-haiku-5-5`) is used only when `ANTHROPIC_API_KEY` is set: it writes the explanations of fixes (kept while a fix is unchanged) and answers "Ask Denise" (`lib/denise/assistant.ts`) through tools that call the scheduling functions (`findOpenings` in `lib/scheduling/openings.ts`, `checkAppointment`). It never writes to the database: `propose_booking` records a proposal staff approve, choosing the client then. Send Claude first names and scheduling facts only, never client phone numbers, emails, allergies or notes, and never log the key. Tests use a fake client; no test calls the real API.

## Inventory
- Tables: `suppliers`, `products` (brand, line, shade/name, SKU, barcode, type `retail` / `back_bar`, unit `g` / `ml` / `unit`, container `size`, cost, retail price, shelf), `stock_levels` (on hand, reorder point and quantity, per location) and `stock_movements` (every change with its reason: `service_use`, `sale`, `count`, `order_received`, `adjustment`, and the amount after it).
- Amounts are in the product's unit, so back-bar color is tracked in grams or ml, partly used tubes included; retail is in whole units. `lib/inventory.ts` has the formatting, value, low-stock, filter and form helpers.
- On hand only changes through `private.move_stock`, called by the database functions for each flow (`adjust_stock` for sales and adjustments; later stages add service use, orders and counts). Stock levels and movements can't be written directly.
- Color usage (`lib/color-usage.ts`): a formula entry can be tied to a service on a visit (`client_formulas.appointment_item_id`) and list products and amounts (`formula_products`), recorded with `add_formula` from the appointment panel or the client profile. Services have default recipes (`service_products`, set with `set_service_recipe`). Checking a visit out runs `private.deduct_item_stock` for each service: the latest formula with products, or else the recipe. It moves only the difference from what's already been taken, so formulas recorded or corrected after checkout put stock right.
- Ordering (`lib/purchase-orders.ts`, `/inventory/orders`): `purchase_orders` go draft → sent → partly received → received. Owners and managers write (`save_purchase_order`), send and delete drafts; the front desk receives (`receive_purchase_order`), which adds containers × size to stock as `order_received` movements and records the cost paid as the product's cost. Low stock (below the reorder point) is flagged on the Inventory page and the Dashboard.
- Denise's reorders (`lib/denise/reorder.ts`, pure forecast in `lib/inventory-forecast.ts`): from stock on hand and on order, and what the next two weeks of bookings will use (the visit's formula, else the client's latest for that service, else their latest color formula, else the recipe), she suggests one order per supplier, recorded in the AI action log (feature `reorder`). A manager approves it into a draft order (`apply_reorder_draft`, undo with `undo_reorder_draft` until it's sent); nothing is ordered automatically.
- Stocktakes (`lib/stocktake.ts`, `/inventory/count`, made for a tablet): owners and managers count shelf by shelf (full containers plus the open one's grams or ml). Each count snapshots the expected amount when it's entered, so sales or service use afterwards aren't counted against it. Finishing applies the differences as `count` movements; products not counted stay as they are. Missing stock worth $15+ or a fifth of what's expected is flagged as possible shrinkage.
- Permissions: owners and managers manage everything; the front desk sells retail and receives orders; stylists record formulas and view stock (`canManageInventory`, `canSellRetail`, `canReceiveOrders`). The database enforces the same.

## Current phase
Phase 1 (foundation) is done, apart from the Phorest import, which is paused waiting on credentials (see `docs/backlog.md`). Phase 2 (calendar and booking) is done up to online booking, including Denise (AI action log with undo, conflict resolver, her panel, Ask Denise with Claude), blocked time, recurring appointments, patch tests and consultation forms, the waitlist and walk-ins, and group bookings. Inventory (phase 5) was brought forward and is done: products, suppliers, stock, color usage, ordering with Denise's reorder drafts, and stocktakes. Next: notifications (texts and email).
