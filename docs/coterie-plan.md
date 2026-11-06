# Coterie17: plan from their feedback

Written November 5, 2026, from Coterie17's feedback ("Coterie17 Feedback: Maestra Roadmap"). Nothing here is built yet. Each item has been checked against the code as it is today (commit 5f85947), not against the docs.

**Effort:**
- **S:** a day or two
- **M:** about a week
- **L:** two weeks or more, usually with database changes across many areas

---

## Tier 1: must-haves before Coterie could switch

### 1. Scheduling and staff

**1a. Month view of the staff schedule**
- **What exists:**
  - Scheduling is one week at a time, with drafts, **Publish week**, Copy last week and repeating patterns of 1–4 weeks.
  - Denise can draft next month's front desk cover, but the result is reviewed week by week.
- **What's missing:**
  - A month grid.
  - Clicking a person to see their month.
  - Copying one person's schedule to another person.
- **Effort:** M.
- **Depends on:** nothing. It reuses the week's drafts and Publish.
- **Decide:**
  - Does the month view edit and publish, or only show?
  - Is "copy between people" a copy of the repeating pattern, or of specific dates?

**1b. Multiple roles per person**
- **What exists:**
  - Each person has exactly one role, one level, one list of services, one pay rate or plan, and one location.
  - Event work (hair, makeup) is the only per-person extra.
- **What's missing:** time blocks that carry a role. Each role would set:
  - the services that can be booked in that block;
  - whether the block shows online;
  - whether it is paid hourly or on commission.

  For example: Wash House in the morning, then Beauty Bar in the afternoon.
- **Effort:** L. It touches the booking rules, online booking, Denise's slot finding, the calendar columns, payroll and permissions.
- **Depends on:**
  - Coterie's exact role definitions.
  - Multi-location work, if Wash House and Beauty Bar are separate locations. Today each team member works at one location (docs/backlog.md).
- **Decide:**
  - Are Wash House and Beauty Bar locations, departments or service menus?
  - Is a "role" here a job role (artisan or assistant), or a station or department?
  - Should permissions follow the time block (an assistant in the morning sees less), or stay per person?

**1c. Clock in and out**
- **What exists:**
  - Payroll counts *scheduled* hours (shifts less approved time off).
  - Visits record check-in and checkout times, but staff don't record their own.
- **What's missing:**
  - Clock in and out.
  - Reminders to clock in and out.
  - Scheduled and actual hours side by side.
  - Manager edits, with a log of each change.
  - Payroll paying from actual hours.
- **Effort:** M.
- **Depends on:** notifications for reminders (an in-app notice works today; texts need live texting).
- **Decide:**
  - Does hourly pay come from actual hours, from scheduled hours, or from whichever is lower?
  - Should clocking in be possible only from the salon's shared iPad (PIN), or from phones too?

**1d. Time-off coding, year view and reports**
- **What exists:**
  - Time off has a reason: vacation, sick, personal or other.
  - Requests, approvals, blackouts and a full history of each request.
  - Shift swaps are separate (front desk and assistants only).
- **What's missing:**
  - PTO as its own code, and swaps shown as a code.
  - A year view per person.
  - PTO earned and remaining (accrual rules).
  - A report of days out by code, with an export.
- **Effort:** M. The accrual rules are the hard part.
- **Depends on:** Coterie's PTO accrual rules.
- **Decide:**
  - Is "vacation" renamed to PTO, or kept and PTO added?
  - Does PTO accrue per hour worked, per pay period, or as a yearly grant?

**1e. Copy service timings from one person to another**
- **What exists:**
  - Each stylist can have their own active, processing and finishing times per service.
  - Denise suggests lengths from real times on **Durations**.
- **What's missing:** "Copy Bridget's timings to Shae", followed by adjusting them.
- **Effort:** S.
- **Depends on:** nothing.
- **Decide:** none.

**1f. Payroll by role**
- **What exists:**
  - Payroll per person for any pay period, with commission plans (flat or tiered, back-bar fees, hourly), tips and a CSV export.
  - Pay rates are kept as history.
- **What's missing:**
  - Pay split by role within one person, then combined.
  - Calculated weekly and reported every two weeks.
- **Effort:** M once 1b exists. L if it's built first.
- **Depends on:**
  - 1b (roles on time blocks).
  - 1c (actual hours, if hourly pay uses them).
  - **Coterie's exact payroll rules** (still to come).
- **Decide:** wait for their rules before building anything here.

### 2. Front desk money controls

**2a. Cash drawer**
- **What exists:**
  - The end-of-day close-out: the expected cash (the float plus the day's cash), the count, the difference and a note.
  - One close-out per location per day.
- **What's missing:**
  - A required opening count, compared with last night's close.
  - The deposit amount.
  - Optional mid-day counts.
  - A discrepancy report over time.
  - Denise helping to look into a shortage.
- **Effort:** M.
- **Depends on:** nothing.
- **Decide:**
  - Does a missing opening count block taking cash, or only warn?
  - Who can open and close the drawer?

  Denise's part would follow the usual rule: our code finds the facts (cash sales, voids, refunds, cash change given, and who did each in the window), and she only explains them.

**2b. Audit trail**
- **What exists:** logs for many things, each with who and when:
  - sales: completed, voided, refunded, receipts;
  - gift cards, packages, memberships, policy fees, time off, shift swaps, events, consent and pay rates;
  - Denise's actions;
  - on a visit, who booked it, undone check-ins and patch-test overrides.

  Visits are never deleted, only canceled.
- **What's missing:**
  - One audit page, searchable by person, type and date.
  - A full log for visits: each move, edit, cancel and no-show with who and when. Today booking details' History shows only part of this.
- **Effort:** M. It needs a log written by the database for every visit change, then the page.
- **Depends on:** nothing.
- **Decide:** who sees the audit page (owners only, or the new bookkeeper role too).

**2c. Alerts**
- **What exists:**
  - Notices for failed payments, membership failures and policy fees.
  - Nothing for voids, $0 sales, deletions or "paid by other".
- **What's missing:**
  - Alerts to owners and managers for each of these.
  - A "paid by other" payment type: Maestra has no such type today, so it would be added only if Coterie needs it.
- **Effort:** S–M.
- **Depends on:** 2b.
- **Decide:**
  - Should alerts arrive in the app only, or by email too? Email needs live email.
  - What does "paid by other" mean at Coterie?

**2d. Sales reconcile to payments**
- **What exists:**
  - The day's money by type of payment (taken, refunded, net) on the close-out.
  - Payments are recorded with each sale.
- **What's missing:**
  - A bookkeeper report that matches deposits by date and type of payment, including card batches once Stripe is live.
  - An export of it.
- **Effort:** M.
- **Depends on:**
  - Stripe, for real card batches and payouts to match against. Before then it can match cash and recorded card payments.
- **Decide:** what export format the bookkeeper's software takes (QuickBooks, Xero, or CSV).

### 3. Permissions

**3a. Permission checkboxes by group, copyable, with Denise respecting them**
- **What exists:**
  - Five roles, each with its own defaults.
  - Owners turn ten switches on or off per person on the member's page.
  - One rule, enforced in the database, decides who can do what. Denise's questions already follow the same rule.
- **What's missing:**
  - Groups: named sets of switches, assigned to people.
  - Editing a group's switches once for everyone in it.
  - Copying a group.
  - Possibly more switches than the ten there are today.
- **Effort:** M. The database rule stays; groups feed it.
- **Depends on:** nothing.
- **Decide:**
  - Which switches Coterie needs beyond the current ten. Their list would help.
  - Can a person's own switches override their group?

**3b. A bookkeeper role**
- **What exists:** nothing. The roles are owner, manager, front desk, stylist and assistant.
- **What's missing:** a role that sees only reports (and probably payroll and the audit trail), with no calendar or client details.
- **Effort:** M. A new role must be checked against the access rules of every table, with tests proving it's kept out of everything else.
- **Depends on:** 3a is a good time to add it.
- **Decide:** what the bookkeeper sees:
  - Reports, Payroll, Sales, Policy and the audit trail?
  - Client names on sales, or none?

### 4. Services built from steps, with several processing gaps

- **What exists:**
  - A service has one active time, one processing gap and one finishing time.
  - Other clients can be booked in the gap.
  - A visit can hold several services back to back, which checkout shows as separate lines.
- **What's missing:**
  - A service made of any number of steps (highlight, processing, gloss, processing, cut), booked as one.
  - Each gap open for other clients.
  - Each step editable on the visit.
  - Checkout splitting it back into lines.
- **Effort:** L. It changes the core scheduling model in several places:
  - the booking rules;
  - the database's double-booking guard, which assumes one gap;
  - Denise's fixes and learned lengths, online booking and the calendar block;
  - stylists' own timings and checkout.
- **Depends on:** nothing, but it should land before 1b or after it, not at the same time.
- **Decide:**
  - Can steps use different stylists (an assistant does the gloss)?
  - How is the price split into checkout lines: set per step, or shared out?

### 5. Inventory and ordering

- **What exists:**
  - Products with brand, line, name, SKU, one barcode, type (retail or back bar), unit, container size, cost per container, retail price and shelf.
  - Stock per location, with a reorder point and reorder quantity.
  - Purchase orders: draft, sent, partly received, received.
  - Stocktakes, and color use coming off the shelf.
  - Denise's reorder drafts.
- **What's missing:**
  - **Copy a product** to a new size (S).
  - A **Color** type (S–M, since color is back bar today with grams).
  - **Employee price** (S, plus checkout applying it: M).
  - **Several barcodes** per product (S–M).
  - **Taxable, and a tax rate per product** (M). Tax is one retail rate per salon today.
  - **Minimum reorder quantity** (S). Today there's a reorder quantity, not a minimum.
  - A **usage report** for any period: used and sold, on hand, a suggested reorder, and Denise comparing the same period last year (M).
  - An **"expected" date** on orders (S).
- **Effort:** M overall.
- **Depends on:** nothing.
- **Decide:**
  - Does employee pricing need staff accounts at checkout (who's buying)?
  - Is Color its own type, or back bar tagged as color?

### 6. Gift cards done right

- **What exists:**
  - Gift cards can't be deleted, only voided with a reason.
  - Reports show the unused balance as what the salon owes.
  - Reload exists at checkout.
  - Client accounts show balances.
- **What's missing:**
  - **"This is a gift"** at checkout: the card hidden from the buyer's and the recipient's accounts until it's redeemed, while staff always see it (S–M).
  - Clients **adding a card to their account by code or scan** (M, with rate limits like the balance check).
  - Clients **reloading online** (M, test cards until Stripe).
- **Depends on:** Stripe, for real reloads online.
- **Decide:**
  - Once a gift is redeemed, does it show in the recipient's account, the buyer's, or both?
  - Is voiding enough for "never deletable", or should voids also need an owner?

---

## Tier 2: big upgrades

### 7. Denise builds reports when asked

- **What exists:**
  - Denise answers questions with fixed lookups (overdue clients, sales, late cancellations and others).
  - Our code works out every figure.
- **What's missing:**
  - Reports built from a question ("Hair clients with 3+ visits since June 2024 who haven't been in this year").
  - The same format every time, a CSV export, and saving a report to run again.
- **Effort:** L.
- **The safe design:** Denise turns the question into a fixed report definition (filters from a set list), our code runs it under the person's permissions, and the saved definition reruns without her.
- **Depends on:** 3a and 3b, so reports follow the permissions.
- **Decide:** which filters to offer first (visits, services, stylist, dates, spend, last visit).
- **Rules:** see Conflicts: Denise never calculates, and her AI service gets first names only.

### 8. Denise does safe tasks, with someone confirming

- **What exists:** the AI action log already covers fixes, lengths, reorders, automations, schedule drafts and bookings, each with Confirm, a log and Undo.
- **What's missing:**
  - More kinds of task: "Change Hannah's blowout time to 30 minutes" and "Copy Bridget's timings to Shae" (this uses 1e).
  - Each one prepared by Denise and confirmed by a person.
- **Effort:** M for the first few, then S each.
- **Depends on:** 1e for copying timings.
- **Decide:** which tasks come first. Change a length and copy timings are good first picks.

### 9. Running late, refined

- **What exists:**
  - Fixes rank by the fewest clients moved, then the smallest delay. A change of stylist counts as 30 minutes of delay.
  - Clients marked "Only books with their preferred stylist" are kept with them in Mark out, but **not** in running-late fixes.
  - Stylists can report "I'm running late…" on their own column.
- **What's missing:**
  - Clients who requested their stylist are never moved to another stylist. This needs a "requested" mark on the visit, which doesn't exist yet.
  - Absorbing the delay first: using gaps, or lengthening the next visit when there's room.
  - The stylist being alerted first, with time to fix it before the front desk is told.
- **Effort:** M.
- **Depends on:** nothing. Alerting the stylist on their phone works in the app now; a text needs live texting.
- **Decide:**
  - How long the stylist gets before the front desk is alerted.
  - Is "requested" set per visit at booking, or taken from the client's setting?

### 10. No-shows and the policy

The headline was "$74,000 in no-shows not charged". Most of what's needed to show this clearly exists already.

- **What exists:**
  - Fees charge themselves after a no-show or late cancel (10 minutes to undo).
  - Waiving needs a reason, and only roles the salon picks can waive.
  - The **Policy** page shows recovered, charged, waived and failed fees, repeat offenders, and the month's incidents.
  - Policy agreement is checked online and on bookings made through Denise's chat, with "Text a card link".
  - Forms can be required per service and signed on the iPad.
- **What's missing:**
  - A **separate checkout type** for fees (S–M). Fees are their own records today, not sales.
  - **Grace:** waive the first fee with a kind message, and credit it if they rebook with the same stylist within a set time (M).
  - The **report** with "not charged, and why", as dollars over any period (S, building on Policy).
  - Agreement **older than a year** prompting again, on every booking path (S–M).
  - **Signed medical forms** for waxing and retinol (S: they're consent forms with a signature, already possible as templates).
  - **Forms sent automatically** for phone bookings, with reminders (M, and it needs live texting and email).
- **Depends on:** Stripe for real charges, and live texting and email for sending forms and the grace message.
- **Decide:**
  - The grace window, and whether it's per client per year.
  - Is the grace message a fixed template the salon edits? It must be: see Conflicts.

### 11. Waitlist offers sent by themselves

- **What exists:**
  - Denise matches openings to the waitlist (those who asked for the stylist first, then the longest waiting).
  - Staff book them and get in touch with the client themselves.
- **What's missing:** the offer texted to the next client, with a time limit, then moving down the list.
- **Effort:** M once texting is live.
- **Depends on:** live texting, and a reply link or a reply by text.
- **Decide:** **see Conflicts.** This is the big decision.

### 12. Promotions and rewards

- **What exists:**
  - Promotions by service, category, stylist, level or product, with dates, limits, exclusions and last-minute specials.
  - Rewards with tiers and bonuses.
  - Earning on packages and memberships is a salon choice. Gift cards never earn points.
- **What's missing:**
  - **Weekday and time-of-day windows** on promotions ("Tuesdays 12 to 3") (S–M).
  - **A set price**, as in "$30 blowout". Today a promotion takes a percent or an amount off (S).
  - **Points multipliers** for a date range, with conditions such as $100+ gift cards (M).
  - An option to **earn points on gift cards** (S, but see Conflicts).
- **Depends on:** nothing.
- **Decide:** whether points are earned when a gift card is bought, or when it's spent.

### 13. Families and paying clients

- **What exists:** nothing for families. Group bookings exist for parties, but each guest is their own client.
- **What's missing:**
  - Denise spotting a child or spouse booked under a parent's profile, and offering to make their own profile (M).
  - A paying client separate from the client being serviced, on visits and at checkout, including rewards and receipts (M–L).
  - **Card authorization:** the card's owner approves someone else using it, by link (M).
- **Depends on:**
  - Stripe, for real card authorization.
  - Live texting or email, for the approval link.
- **Decide:**
  - Who earns points: the payer or the client?
  - Does a linked family see each other's visits in the client account?

---

## Tier 3: later, but exciting

### 14. Events, like HoneyBook

- **What exists:**
  - The pipeline from Inquiry to Completed.
  - Proposals, contracts and deposits online, the payment schedule and reminders.
  - Trials, the timeline, the team's time held on the calendar, and the day-of sheet.
  - Members can pay their own share by link.
- **What's missing:**
  - Automatic next steps (a nudge when a proposal hasn't been looked at) (M).
  - **Holding a date** far ahead with a deposit before the party is known, kept until the booking window opens (M).
  - **Self-booking links:** party members book their own service, add a card and sign (L).
  - The same for **classes and open houses** with limited places (L).
  - Easier service changes after booking (S–M).
- **Depends on:** the HoneyBook walkthrough, live email, and Stripe.
- **Decide:** whether classes are events or a new kind of booking.

### 15. New-client intake: "Find my stylist"

- **What exists:** the booking site, patch-test questions, and consultation services.
- **What's missing:**
  - A quiz for hair history, goals and photos, leading to a suggested stylist.
  - Denise flagging when a visit may need extra time.
- **Effort:** M–L.
- **Depends on:** nothing.
- **Decide:**
  - How a stylist is matched: our own rules from answers to services and levels?
  - Is Denise's flag our rule, or her reading of the answers? Photos never go to her AI service today.

### 16. Marketing

- **What exists:**
  - Four automations (rebook, win-back, birthday, review), sent to the outbox.
  - Last-minute specials sent by staff.
  - Consent and opt-out handling.
- **What's missing:**
  - Email and text **campaigns** to client lists built by Denise (with item 7).
  - Social posting later.
- **Effort:** M after 7 and live sending.
- **Depends on:** live texting and email, and 7.
- **Decide:** who writes campaign wording. It must be staff or fixed templates: see Conflicts.

---

## Not on their list, but needed to switch

- **Importing from Phorest.** There's no import screen yet, and appointments and products aren't imported. Coterie is sending an export; this is needed before any switch.
- **Live texts and email.** Items 1c (reminders), 10, 11, 13 and 16 need them.
- **Stripe.** Items 2d, 6, 10 and 13 need it for real money.

---

## Proposed phases

**Phase 1. Money controls and permissions** (items 2, 3, plus the no-show report from 10). About 3–4 weeks.
- Includes:
  - the visit audit log and audit page;
  - alerts;
  - the cash drawer with opening and mid-day counts;
  - reconciling sales to payments (cash and recorded card first);
  - permission groups;
  - the bookkeeper role;
  - the "not charged, and why" no-show report.
- Why first: it answers Coterie's headline ($74k) and is the trust layer for everything after it. Its rules (who sees what) also shape items 7 and 13.

**Phase 2. Quick wins: inventory and gift cards** (items 5, 6, 1e). About 2 weeks.
- Includes:
  - product fields;
  - copying products;
  - the Color type;
  - the usage report;
  - "This is a gift";
  - clients adding cards by code;
  - copying service timings.
- Why now: these are small, need no answers from Coterie, and remove many objections in their list.

**Phase 3. Scheduling and staff** (1a, 1c, 1d). About 3 weeks.
- Includes:
  - the month view;
  - clock in and out, with scheduled and actual hours;
  - time-off codes, the year view, PTO and the report.
- Needs Coterie's PTO accrual rules.

**Phase 4. Roles per time block and payroll by role** (1b, 1f). About 3–4 weeks.
- Waits on Coterie's role definitions and payroll rules. It's the riskiest change, so it goes after the trust layer and before steps.

**Phase 5. Services built from steps** (item 4). About 2–3 weeks.
- A change to the core scheduling model, done on its own with the full test suite.

**Phase 6. Denise grows up** (items 7, 8, 9). About 3 weeks.
- Includes:
  - reports from a question;
  - safe tasks with Confirm;
  - running late refined.

**Phase 7. Live texts, email and Stripe** (needed by everything after it, and by the switch itself). Then:
- 10's grace message and forms sent automatically;
- 11 waitlist offers;
- 13 families and card authorization;
- 12 promotion windows and multipliers (these could move earlier, since they need nothing).

**Phase 8. Tier 3** (items 14, 15, 16), after the HoneyBook walkthrough.

**Phorest import** runs alongside, as soon as Coterie's export arrives.

---

## Conflicts with existing rules

1. **Waitlist offers sent by themselves (11) vs. "Denise never writes to or messages clients."**
   - The rule covers Denise. Fixed-template messages the system sends by itself (confirmations, receipts, automations) are already allowed.
   - So a waitlist offer can be a **salon setting** (off by default, turned on by an owner), using the salon's own fixed template, sent from the salon on the client's allowed channel, with the consent rules and opt-out.
   - Denise may pick who's next only by our ranking code, never by AI, and never writes the text.
   - It also needs a new rule, since today a moved or offered time reaches a client only when staff send it: this would be the first system message about an opening the client didn't start. **Decision for you:** accept that framing, or keep offers staff-sent with one tap.
2. **Grace messages (10) and forms sent automatically.** These must be fixed templates the salon edits, never written by Denise. They also follow consent: visit messages, with the STOP rule.
3. **Denise building reports (7) vs. "our code calculates every fact" and privacy.**
   - She may only turn the question into a report definition. Our code runs it, with the asker's permissions, and the CSV comes from our code.
   - Client last names, phones and emails can be in the CSV (staff with access), but must never be sent to her AI service.
4. **Denise doing tasks (8).** This fits rule 4 as long as each task goes through the AI action log with Confirm and Undo. Nothing she does may skip it, even "small" changes.
5. **Campaigns (16).** Denise can build the list; the wording must be staff's own or a fixed template, never AI-written.
6. **Points on gift cards (12).** Today gift cards never earn points or count toward tiers, because a gift card is money owed, not a sale. Earning when it's bought means points on a liability (and again when it's spent). **Decision for you:** if it's allowed, earn on purchase only, with services paid by that gift card not earning again.
7. **Roles per time block (1b) vs. one role per person.**
   - Permissions, the access rules on every table, and "each team member works at one location" all assume one role per person.
   - The safest design keeps one *access* role per person and adds a *working* role per time block (services, online, pay). Coterie should confirm that permissions needn't change mid-day.
8. **Paying client (13) vs. "Never store card numbers."** Card authorization must be a provider token with the owner's consent recorded, like the cancellation policy. This is fine with Stripe; until then it's test cards only.
9. **Services built from steps (4) vs. booking rules in one place.** It must be built inside `lib/scheduling/` and the database's double-booking guard, never as calendar-only logic.
10. **A bookkeeper role (3b) vs. "RLS on every table".** It's not a conflict, but every table's rules must be checked for the new role, and the permission tests must prove it sees only reports.

---

## Decisions needed from you or Coterie (in one place)

1. Waitlist offers sent by themselves: a salon setting with a fixed template, or staff-sent with one tap?
2. Points on gift cards: allow, and when they're earned.
3. Wash House and Beauty Bar: locations, departments or menus? Does a role change permissions mid-day?
4. Coterie's payroll and commission rules per role, and the PTO accrual rules.
5. What the bookkeeper sees.
6. Which permission switches Coterie needs beyond today's ten.
7. Clocked hours or scheduled hours for hourly pay.
8. The grace rules for no-shows.
9. ~~Steps in one service done by different people, and how the price splits.~~ Decided: a service bundle of menu services, each with its own stylist and price; steps stay inside one service.
10. The bookkeeper's accounting software, for the reconciliation export.
