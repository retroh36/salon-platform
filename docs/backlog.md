# Backlog

Known gaps to pick up later. Move an item into a task when it's scheduled.

## Schedules

- [ ] **Effective-from dates for weekly hours.** Weekly hours are a single template today, so a change applies to every week straight away. Let managers schedule new hours from a date (e.g. "new hours from March 1") while keeping the current ones until then.
- [ ] **Salon-wide closures.** Holidays and other days the whole location is closed (or has shorter hours), separate from the weekly opening hours. Availability in `lib/scheduling/` should treat them like the location being closed.
- [ ] **Warn about pending time off during booking.** Only approved time off blocks availability. When booking a stylist who has a pending request for that time, the booking engine should warn the front desk.

## Calendar and booking

- [ ] **A console line on "We can't find that page".** Pages load their data inside a Suspense boundary (Cache Components), so when a link is bad (an old manage link, a salon that isn't there) the page's shell has already been sent when `notFound()` runs: the visitor sees the right page, rendered in the browser, with a 200 status and React's error #419 in the console. The browser tests let only that line through where they open a missing page on purpose (`allowNotFoundLogs`). If search engines or monitoring ever count it, check the slug or token before the Suspense boundary so the server can answer 404.
- [ ] **Rules checked in the app only.** The database itself refuses a double-booking (a stylist's busy time or a chair held twice), but the other booking rules (hours, time off, blocked time) and status changes run in `lib/scheduling/` before the database functions save. A staff member who can book could skip them by calling those functions directly with their own login. If that matters (e.g. before opening an API), have the functions accept only calls from the server.
- [ ] **Move a whole visit.** Dragging moves one service; a visit with two stylists needs each moved separately (or edited in the panel).
- [ ] **Undo a move.** A drag saves straight away; offer "Undo" in the notice.
- [ ] **Confirm appointments.** "Confirmed" exists as a status but there's no action for it yet; it comes with reminders (phase 3).
- [ ] **Category colors chosen by the salon.** The calendar colors categories in alphabetical order from a fixed palette, so adding a category can shift colors. Let managers pick a color per category.
- [ ] **Breaks during processing.** A stylist must be on shift for a whole item, processing included, so a color can't process over their lunch. Some salons allow it; make it a setting.
- [ ] **Client double-booking.** The booking rules check stylists and resources, not clients; the same client could be booked in two places at once.
- [ ] **Pending time off on the calendar.** Only approved time off is shown; pending requests could be shown faintly so the front desk knows.

- [ ] **The hour the clocks skip or repeat.** Left as it is for now, since salons are closed then. In spring, a wall-clock time between 2:00 and 3:00am doesn't exist: the app (`fromLocal`, `shiftStart` in `lib/scheduling/time.ts`) refuses it, while Postgres moves it an hour forward, and the event builder would send no start for a task in that hour. In autumn, 1:00 to 2:00am happens twice and `fromLocal` always picks the first, so a visit at the second 1:30am (an import, say) moves an hour earlier if it's edited or moved. If it ever matters, pick one rule (the next minute that exists) and use it in both places.

## Denise (AI assistant)

- [ ] **Send notifications.** Fixes record client and stylist messages in `notifications` (status `pending`); nothing is sent until texts and email arrive (phase 3).
- [ ] **Ask Denise in the browser tests.** Without an API key the e2e tests only cover "I'm not connected yet"; the tool loop and suggestions are unit-tested with a fake client. A browser test of the suggestion card (pick a client, book, undo) needs a stubbed Claude endpoint.
- [ ] **Clients in two places.** The resolver keeps a visit's services together when it moves them, but like the booking rules it doesn't check a client against their other visits.
- [ ] **Undo a call-out.** "Out for the day" adds approved time off; taking it back means deleting that time off on the team schedule.
- [ ] **AI action log page.** Owners can't browse the log yet (it's in `ai_actions`).
- [ ] **Run scans in the background.** Denise looks over the day when the calendar loads or changes; with no one on the calendar, nothing watches it.

## Inventory

- [ ] **Sales through the point of sale.** "Record sale" only takes retail out of stock; payments, prices and receipts come with the point of sale (phase 4).
- [ ] **Send orders to suppliers.** "Mark as sent" records that an order went out; emailing it to the supplier comes with email.
- [ ] **Barcode scanning.** Products have barcodes, but counting and receiving are by hand; a camera scanner would speed up both on an iPad.
- [ ] **Who counts.** Stocktakes are owners and managers only, per the permissions; salons may want the front desk to count without finishing.
- [ ] **Usage history in forecasts.** Denise forecasts from upcoming bookings (formulas and recipes); walk-ins, retail sales trends and waste aren't in it yet.
- [ ] **Several locations.** Stock is per location, but there are no transfers between locations.

## Phorest import

- [ ] **Blocked: dry run gets 401 (paused 2026-10-21).** `npm run import:phorest:dry-run` is rejected with 401 on the first request (`GET /api/business/{businessId}/branch`), both times it was tried: first with no `global/` username prefix against the docs host, then with the prefix against the US API gateway. Waiting on Phorest to confirm the username format, which API server the account is on, and the password. Once confirmed, update `.env.local` and run the dry run again (`-- --months-back=6 --months-ahead=3`).
- [ ] **Save appointments, products and gift cards.** The importer maps them (`lib/import/phorest/model.ts`) but only appointments have tables so far (products and gift cards come in phases 5 and 7). Phorest gives each item a start and end but no processing split or resource, so imported items will be all busy time with no chair.
- [ ] **Check processing gaps after import.** Phorest gives a service's total duration and a gap time but not where the gap falls. Imported services treat the gap as processing at the end and are flagged for review; a manager should set service, processing and finishing times for color services.
- [ ] **Staff-specific durations and gap times.** Phorest's `userDurations` / `userGapTimes` aren't imported (no per-stylist duration yet).
- [ ] **Client fields with no home yet:** birthday, address, banned flag, account balances and loyalty points are reported as dropped by the dry run.
- [ ] **Import command.** Only the dry run exists. A real import needs a target business, a confirmation step, and polling for changes during the switch-over week (`updatedAfter` / `updated_from` filters).

## Operations

- [ ] **Photo backups to a separate project.** The nightly Storage backup is built (`lib/photo-backup.ts`); point it at a bucket in a separate Supabase project (`PHOTO_BACKUP_SUPABASE_URL`, `docs/operations.md`) when production is set up.
- [ ] **Set up login emails in production.** Site URL, the Invite and Reset password templates from `supabase/templates/`, and an SMTP provider in the hosted project, so staff invites and password resets arrive (`docs/operations.md`, "Login emails").
- [ ] **Week view.** The calendar's Week view (and dragging a visit onto another day there); visits move to another day from "⋯" → Move to another day for now.
- [ ] **Configure scheduled jobs in production.** `CRON_SECRET` in Vercel, then `npm run jobs -- configure` against the production project (`docs/operations.md`).
- [ ] **Confirm the hosted backups.** When the production Supabase project is set up: a paid plan, Point-in-Time Recovery on, retention of 7+ days, and two owners with 2FA; then the first quarterly restore (`docs/operations.md`).
