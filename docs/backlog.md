# Backlog

Known gaps to pick up later. Move an item into a task when it's scheduled.

## Schedules

- [ ] **Effective-from dates for weekly hours.** Weekly hours are a single template today, so a change applies to every week straight away. Let managers schedule new hours from a date (e.g. "new hours from March 1") while keeping the current ones until then.
- [ ] **Salon-wide closures.** Holidays and other days the whole location is closed (or has shorter hours), separate from the weekly opening hours. Availability in `lib/scheduling/` should treat them like the location being closed.
- [ ] **Warn about pending time off during booking.** Only approved time off blocks availability. When booking a stylist who has a pending request for that time, the booking engine should warn the front desk.

## Phorest import

- [ ] **Save appointments, products and gift cards.** The importer maps them (`lib/import/phorest/model.ts`) but their tables come in phases 2, 5 and 7. Add a save step when each table exists.
- [ ] **Check processing gaps after import.** Phorest gives a service's total duration and a gap time but not where the gap falls. Imported services treat the gap as processing at the end and are flagged for review; a manager should set service, processing and finishing times for color services.
- [ ] **Staff-specific durations and gap times.** Phorest's `userDurations` / `userGapTimes` aren't imported (no per-stylist duration yet).
- [ ] **Client fields with no home yet:** birthday, address, banned flag, account balances and loyalty points are reported as dropped by the dry run.
- [ ] **Import command.** Only the dry run exists. A real import needs a target business, a confirmation step, and polling for changes during the switch-over week (`updatedAfter` / `updated_from` filters).
