# Backlog

Known gaps to pick up later. Move an item into a task when it's scheduled.

## Schedules

- [ ] **Effective-from dates for weekly hours.** Weekly hours are a single template today, so a change applies to every week straight away. Let managers schedule new hours from a date (e.g. "new hours from March 1") while keeping the current ones until then.
- [ ] **Salon-wide closures.** Holidays and other days the whole location is closed (or has shorter hours), separate from the weekly opening hours. Availability in `lib/scheduling/` should treat them like the location being closed.
- [ ] **Warn about pending time off during booking.** Only approved time off blocks availability. When booking a stylist who has a pending request for that time, the booking engine should warn the front desk.

## Calendar and booking

- [ ] **Rules checked in the app only.** The booking rules and status changes run in `lib/scheduling/` before the database functions save. A staff member who can book could skip them by calling those functions directly with their own login. If that matters (e.g. before opening an API), have the functions accept only calls from the server.
- [ ] **Move a whole visit.** Dragging moves one service; a visit with two stylists needs each moved separately (or edited in the panel).
- [ ] **Undo a move.** A drag saves straight away; offer "Undo" in the notice.
- [ ] **Confirm appointments.** "Confirmed" exists as a status but there's no action for it yet; it comes with reminders (phase 3).
- [ ] **Touch dragging.** Drag uses pointer events and should work on tablets, but it's only been tested with a mouse.
- [ ] **Category colors chosen by the salon.** The calendar colors categories in alphabetical order from a fixed palette, so adding a category can shift colors. Let managers pick a color per category.
- [ ] **Breaks during processing.** A stylist must be on shift for a whole item, processing included, so a color can't process over their lunch. Some salons allow it; make it a setting.
- [ ] **Client double-booking.** The booking rules check stylists and resources, not clients; the same client could be booked in two places at once.
- [ ] **Pending time off on the calendar.** Only approved time off is shown; pending requests could be shown faintly so the front desk knows.

## Denise (AI assistant)

- [ ] **Send notifications.** Fixes record client and stylist messages in `notifications` (status `pending`); nothing is sent until texts and email arrive (phase 3).
- [ ] **Ask Denise in the browser tests.** Without an API key the e2e tests only cover "I'm not connected yet"; the tool loop and suggestions are unit-tested with a fake client. A browser test of the suggestion card (pick a client, book, undo) needs a stubbed Claude endpoint.
- [ ] **Clients in two places.** The resolver keeps a visit's services together when it moves them, but like the booking rules it doesn't check a client against their other visits.
- [ ] **Undo a call-out.** "Out for the day" adds approved time off; taking it back means deleting that time off on the team schedule.
- [ ] **AI action log page.** Owners can't browse the log yet (it's in `ai_actions`).
- [ ] **Run scans in the background.** Denise looks over the day when the calendar loads or changes; with no one on the calendar, nothing watches it.

## Phorest import

- [ ] **Blocked: dry run gets 401 (paused 2026-10-21).** `npm run import:phorest:dry-run` is rejected with 401 on the first request (`GET /api/business/{businessId}/branch`), both times it was tried: first with no `global/` username prefix against the docs host, then with the prefix against the US API gateway. Waiting on Phorest to confirm the username format, which API server the account is on, and the password. Once confirmed, update `.env.local` and run the dry run again (`-- --months-back=6 --months-ahead=3`).
- [ ] **Save appointments, products and gift cards.** The importer maps them (`lib/import/phorest/model.ts`) but only appointments have tables so far (products and gift cards come in phases 5 and 7). Phorest gives each item a start and end but no processing split or resource, so imported items will be all busy time with no chair.
- [ ] **Check processing gaps after import.** Phorest gives a service's total duration and a gap time but not where the gap falls. Imported services treat the gap as processing at the end and are flagged for review; a manager should set service, processing and finishing times for color services.
- [ ] **Staff-specific durations and gap times.** Phorest's `userDurations` / `userGapTimes` aren't imported (no per-stylist duration yet).
- [ ] **Client fields with no home yet:** birthday, address, banned flag, account balances and loyalty points are reported as dropped by the dry run.
- [ ] **Import command.** Only the dry run exists. A real import needs a target business, a confirmation step, and polling for changes during the switch-over week (`updatedAfter` / `updated_from` filters).
