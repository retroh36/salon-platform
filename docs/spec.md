# Maestra — Product Spec

Oct 21, 2026 · @Julian

## Overview

A full salon management platform, built from scratch, that matches Phorest and Boulevard on core features and beats them with AI running the back office. The product is called Maestra: the master who conducts the whole salon.

**Positioning.** Phorest and Boulevard are calendars with reports attached. Maestra watches the schedule, stock and numbers continuously and acts on them, so the front desk and owner spend less time firefighting.

**Guiding principles**

- **AI runs the back office; people own the client relationship.** Conversations, consultations and service advice stay with stylists and the front desk. AI only sends automated notices (reminders, time changes, confirmations).
- **Suggest first, automate later.** Every AI action starts as a one-tap approval. A salon can switch an action to automatic once it trusts it.
- **Every AI action is logged and reversible.** Owners can see what changed, why, and undo it.
- **Easy to switch to.** One-click import from Phorest so a salon can move over without retyping anything.

## Core modules

Feature parity with Phorest and Boulevard, grouped into four areas. Phase numbers refer to Build phases below.

| Area | Module | What it covers | Phase |
| --- | --- | --- | --- |
| Front of house | Calendar | Multi-stylist columns, drag-and-drop, color-coded services, processing-time gaps, rooms and chairs as resources | 2 |
| Front of house | Online booking | Booking site and embeddable widget, deposits, cancellation policies, waitlist | 2 |
| Front of house | Client profiles | Visit history, color formulas, photos, notes, allergies, consent forms | 1 |
| Front of house | Notifications | SMS and email reminders, confirmations, time-change notices | 3 |
| Money | POS and checkout | Services, retail, tips, split payments, card terminals, receipts | 4 |
| Money | Gift cards and packages | Sell, redeem, track balances | 7 |
| Money | Memberships and loyalty | Recurring billing, points, member pricing | 7 |
| Money | Commission and payroll | Tiered service and retail commission, booth renters, payroll export | 6 |
| Back office | Staff | Schedules, time off, roles and permissions, skills per stylist | 1 |
| Back office | Multi-location | Separate branches under one account, shared clients | 6 |
| Back office | Inventory | Products, suppliers, purchase orders, back-bar vs. retail stock | 5 |
| Back office | Reporting | Revenue, rebooking rate, retention, utilization, retail per client | 6 |
| Marketing | Campaigns | Email and SMS campaigns, audience segments | 7 |
| Marketing | Automations | Review requests, win-back flows, birthday offers | 7 |
| Marketing | Client app | Branded mobile booking app | Later |

## AI features

AI works behind the scenes on scheduling, inventory, owner insight and marketing. Client conversations, consultations and service advice stay human.

### Scheduling brain

- **Live conflict resolver.** It watches for overruns, double-bookings, stylist call-outs and late arrivals. It ranks possible fixes by least disruption (fewest clients moved, smallest time shift, same stylist kept). The front desk approves the fix with one tap, and the system then updates the calendar, alerts the stylists and sends the client an automated time-change notice.
- **Duration learning.** It learns each stylist's real time per service from completed appointments, and suggests those durations when booking instead of the menu default.
- **Gap filler.** When a slot opens, it ranks waitlisted and due-to-rebook clients who fit the slot. The front desk picks who to offer it to.
- **Day packing.** It suggests start times that keep each stylist's day tight and avoid unbookable gaps.
- **No-show risk.** It flags appointments likely to no-show, based on the client's history and booking pattern, so the desk can ask for a deposit or confirm by phone.

### Inventory

- **Usage tracking.** Each service carries a product recipe (for example, color and developer amounts for a full highlight). Completed services draw down back-bar stock automatically.
- **Predictive stocktake.** It forecasts run-out dates from upcoming bookings, not just past sales.
- **Reorder drafts.** It builds supplier orders ahead of shortages for the owner to approve.
- **Shrinkage alerts.** It flags when counted stock doesn't match what services and sales say should be left.

### Owner intelligence

- **Ask your salon.** Plain-English questions answered from the salon's own data, such as "which clients haven't been back in 90 days?"
- **Morning brief.** A daily summary of today's risks, likely no-shows, low stock and open slots.
- **Churn alerts.** It flags clients whose visit gap is stretching, so a stylist can reach out personally.
- **Stylist scorecards.** Each stylist sees their rebook rate, retail sales and utilization, with suggestions.

### Marketing

- **Campaign drafts.** It writes promo emails and texts and picks the clients most likely to respond. A person reviews before anything is sent.
- **Off-peak pricing (optional).** It suggests discounts to fill slow days.

### Guardrails for every AI feature

- Starts in suggest mode; the owner can turn on auto mode per feature.
- Every action is logged with the reason and can be undone.
- Automated client messages use approved templates only; no free-form AI chat with clients.

## Data model

Everything hangs off a Business, which has one or more Locations. These are the core entities for phases 1–5.

| Entity | Key fields | Belongs to |
| --- | --- | --- |
| Business | name, plan, settings | — |
| Location | address, hours, timezone | Business |
| Staff | name, role, skills, commission rules, work schedule | Location |
| Service | name, category, default duration, processing gap, price, product recipe | Business |
| StaffService | custom price and learned duration per stylist | Staff + Service |
| Resource | chair, room or station | Location |
| Client | contact info, preferences, notes, allergies, formulas, consent | Business |
| Appointment | client, start, end, status, deposit, source | Location |
| AppointmentItem | service, staff, resource, start, end | Appointment |
| Waitlist entry | client, wanted services, time windows | Location |
| Product | SKU, barcode, type (retail or back-bar), cost, price, supplier | Business |
| StockLevel | on hand, reorder point | Product + Location |
| StockMovement | change, reason (sale, service use, count, order) | StockLevel |
| Sale | items, tips, payments, totals | Location |
| Payment | method, amount, processor reference | Sale |
| Notification | channel, template, recipient, status | Business |
| AI action log | feature, proposed change, reason, approved by, undone | Business |

Appointments are split into items so one visit can involve several stylists or services, such as color with one stylist and a blowout with another.

## Phorest migration

A one-time import pulls a salon's existing data from the Phorest API into the new platform. The API is used only for migration, not as an ongoing dependency.

| Phorest API | Imports into | Notes |
| --- | --- | --- |
| Branches | Location | One location per branch |
| Staff (incl. work timetables) | Staff | Schedules become the starting work schedule |
| Services | Service, StaffService | Durations and prices carry over; learned durations start from these |
| Clients | Client | Contact info, notes, preferences |
| Appointments | Appointment, AppointmentItem | Past history plus all future bookings |
| Products | Product, StockLevel | Stock levels, pricing, barcodes |
| Purchases | Sale (history only) | Feeds reporting and AI baselines |
| Vouchers | Gift cards | Balances carried over |
| Courses, Loyalty | Packages, Loyalty | Phase 7 |

**Constraints to plan around**

- Access is gated: credentials are requested from Phorest by email and may carry fees.
- No sandbox, so the import must be read-only and tested carefully against live data.
- No webhooks: during the switch-over week, the importer polls for changes to catch bookings made in Phorest before cutover.
- Card payment data cannot be exported, so clients re-enter cards in the new system.
- Credentials are stored in a secrets manager, never in code or chat.
- Review Phorest's API terms before launch to confirm migration use is permitted.

Sources: [Phorest API getting started](https://developer.phorest.com/docs/getting-started), [Phorest common API use cases](https://developer.phorest.com/docs/common-api-use-cases), [Supergood Phorest API report](https://supergood.ai/api-report-card/phorest)

## Tech stack and architecture

Three apps (front desk app, online booking site, stylist view) all talk to one Platform API, which owns the booking rules. Behind the API sit the Postgres database, background workers and the AI engine. External services: Claude API (AI reasoning), Stripe (payments, terminals), Twilio (texts and email), Phorest API (one-time import).

The AI engine proposes changes through that same API, so every AI action passes the same checks and lands in the log.

- **Apps:** Next.js and TypeScript, one codebase. The stylist view is a mobile-friendly web app first, native app later.
- **Database:** Postgres on a managed host such as Supabase or Neon.
- **Background workers:** a job queue for reminders, forecasts, the Phorest import and scheduled AI runs.
- **AI:** Claude API for conflict resolution, forecasting explanations, "ask your salon" and campaign drafts.
- **Payments:** Stripe Connect, so each salon is paid directly, plus Stripe Terminal for card readers.
- **Messaging:** Twilio for SMS, with an email provider such as Postmark or Resend.
- **Hosting:** Vercel for the apps, with daily database backups and uptime monitoring.

## Build phases and milestones

**Launchable core**

1. **Foundation** — accounts, staff, services, clients, Phorest import
2. **Booking engine** — calendar, online booking, conflict resolver
3. **Notifications** — SMS and email reminders and time-change notices
4. **Payments** — Stripe checkout, deposits, tips, card terminals

**Gate: pilot salon goes live** — runs a full week on the platform.

**Full platform**

5. **Inventory and stocktake** — back-bar recipes, forecasts, reorder drafts, shrinkage
6. **Reporting and insights** — reports, commission, payroll, ask your salon, daily brief
7. **Growth features** — gift cards, memberships, loyalty, campaigns

Phases 1 to 4 make a product one salon can run its whole day on; the pilot salon going live for a full week is the gate before phases 5 to 7. Dates are not set yet and depend on team size.

## Open questions and risks

**Open questions**

- [x] Product name and brand: Maestra (see docs/brand.md)
- [ ] Pilot salon: which salon tests phase 1–4, and who there gives feedback?
- [ ] Pricing model: per location, per stylist, or tiered plans?
- [ ] Booth-renter salons: support from launch or later?
- [ ] Card terminals: which Stripe Terminal readers to support?
- [ ] Team: solo build with AI help, or bring in a developer partner?

**Risks**

- **Scope.** Full parity is years of work for a large team. Mitigation: ship phases 1–4 as a product one salon can run on, then expand.
- **Payments and compliance.** Card handling must stay inside Stripe so the platform never stores card numbers.
- **SMS registration.** US business texting requires carrier (10DLC) registration, which takes weeks. Start it early in phase 3.
- **Reliability.** A salon can't operate if the calendar is down. Plan for backups, uptime monitoring and an offline-friendly front desk view.
- **AI mistakes.** A wrong reschedule annoys a real client. Mitigation: suggest mode by default, logging and one-click undo.
- **Phorest terms.** Confirm the API agreement allows migration use before building the importer.
