# Maestra: what's built, for the demo

Checked against the app itself and its automated tests on November 5, 2026, not against plans or earlier notes.

**Status**
- ✅ **Works:** built, tested, and does the real thing.
- 🟡 **Partly / demo only:** the screens and rules are real, but something is simulated. Usually one of three things:
  - **Card charges** use a built-in test card system, so no money moves. The test cards are Visa ending 4242 (always works), 0002 (declined) and 9995 (insufficient funds).
  - **Card payments at the desk** are recorded as taken on the salon's own card machine. Nothing is charged from the screen.
  - **Texts and emails to clients** wait in the **outbox**, a page you can open from the demo bar at the top of the screen. Nothing reaches a real phone or inbox.
- 🔜 **Not built yet.**

**On the public demo** (https://maestra-demo.vercel.app):
- The sign-in page has one tap per account:
  - Olivia (owner)
  - Daniel (manager)
  - Sam (front desk)
  - Bridget (stylist)
  - Renata (owner of Harbor & Vine, the large salon)
  - Aurora Baker (a client, on the booking site)
- Both salons are open every day, with visits today.
- The data resets every night.
- Denise is connected to her AI service, with a daily allowance and at most 20 questions every 10 minutes.

---

# Part 1: What Maestra does

## Calendar and booking

| What | Status | Where | Show it |
|---|---|---|---|
| **Day calendar.** A column per stylist with their hours and chair. Visits are colored by service and status. | ✅ | Calendar | Open Calendar as Sam. Scroll across the team, then tap **Key** under the calendar to explain the colors. |
| Week view | 🔜 | Calendar → **Week** is greyed out, with the hint "Week view is coming soon" | Don't click it. |
| **Book a visit.** Several services and stylists in one visit, with the booking rules checked as you go. | ✅ | Tap an empty time, or **New booking** | Tap 2pm in Gil's column → Women's Cut & Style → pick a client → **Create booking**. |
| **Drag a visit to a new time or stylist.** It snaps to 5 minutes and shows a live label of where it will land. | ✅ | Drag any visit on the calendar | Drag a visit from Bridget's column to Gil's and watch the label read "2:10–3:10pm · Gil". |
| **"Move anyway?" checks** when a drop isn't normal: another client then, a service the stylist doesn't usually do, or outside their hours | ✅ | Appears when you let go | Drop a visit on top of another client. The preview turns amber, then it asks "Double-book anyway?". |
| **Change a visit's length** by dragging its edge | 🟡 | Only blocked time can be stretched. Visits change length in **Edit booking**. | Show it on a lunch block instead. |
| **Blocked time,** one-off or every week (lunch, break, training, meeting) | ✅ | **More → Block time** | Point at Sandra's weekday lunch, 12:30–1pm. |
| **Repeating visits,** with suggestions when one date doesn't fit | ✅ | Booking form → **Repeat** | Book Maria Lopez with Bridget every 6 weeks for 4 visits → **Check dates**. None are in the demo data, so book one live. |
| **Group bookings** (a party, booked and moved together) | ✅ | Booking form → **Book a group instead** | Book three guests for a party live. None are in the demo data. |
| **Waitlist** | ✅ | **More → Waitlist** | Open it: five clients are waiting, one of them "Prefers Gil". |
| **Walk-ins,** with the next free qualified stylist | ✅ | **More → Walk-ins → Add a walk-in** | Add a walk-in for a men's cut and see the suggested stylist and wait. |
| **Check in, check out, no-show,** each with Undo | ✅ | Booking details: the big button at the bottom, and **⋯** | Tap a visit → **Check in**, then **Undo** on the message that appears. |
| **Booking details,** the right-hand panel | ✅ | Tap any visit | Tap Maria Lopez: latex allergy in red, card on file, Denise's one-line note, then the **Notes, Formula, Photos, History** tabs. |
| **Move to another day,** with Denise's nearest times if it doesn't fit | ✅ | Booking details → **⋯ → Move to another day** | Move a visit to next Tuesday. The calendar jumps there with it open. |
| **"Let [client] know?"** after any move. Only staff send it. | 🟡 (the message waits in the outbox) | Appears at the top of the calendar after a move | After a drag: "Let Maria know about the new time?" → **Send** → open the outbox. |
| **Running late,** for a stylist or a client | ✅ | Stylist's column menu → "**Gil is running late…**". For one client: booking details → **⋯ → Running late**. | Gil's ⋯ → Gil is running late → 20 min → **Show what it pushes into**. |
| **Mark a stylist out:** all day, leaving early or coming in late, with a plan for every client | ✅ (client messages wait in the outbox) | Stylist's column menu → "**Mark Nola out…**" | Mark Nola out → **All day**. Each client gets Move, Reschedule or Call → **Apply plan**. |
| **Who's on the calendar,** saved views, departments, and an "N off today" list | ✅ | The department dropdown, and the off chip | Tap "1 off today" to see who's off and why, then **New view…**. |
| **Zoom:** Compact, Comfortable, Detailed, and "Fit all" | ✅ | The display menu in the toolbar | Switch to Compact → **Fit all** at Harbor & Vine (35 stylists). |
| **Patch test checks.** Color needs one, and checking in warns or blocks. | ✅ | Booking details → "Before this visit" | Open a new client's color visit and show "Patch test — none on file". |
| **Rebook** a checked-out visit (the same services, six weeks on) | ✅ | Booking details → **Rebook** | Open a checked-out visit → **Rebook**. |
| **Live updates.** Every screen sees a change within a second or two. | ✅ | Automatic | Book on a laptop and watch it appear on an iPad. |
| **My day,** the stylist's phone view (their day, timers, earnings, goals) | ✅ | Sign in as Bridget | Show **Start service → Processing → Back in chair → Finish service**. |

## Online booking site and client accounts

| What | Status | Where | Show it |
|---|---|---|---|
| **The salon's own booking site,** in its colors, made for phones: services, stylist (or no preference), time, details, review | ✅ | maple-and-ash booking site (Settings → Online booking has the link) | Book a Blowout with "No preference" on a phone. |
| **Confirming the client's phone or email with a code** | 🟡 (on the demo the code shows on screen; normally it goes to the outbox) | "Your details" step → **Send code** | Type any phone number and read the code off the screen. |
| **Card to hold a booking, and deposits paid online** (25% on balayage and other long color services) | 🟡 (test cards) | The review step | Book a Balayage and pay the deposit with 4242 4242 4242 4242. |
| **Change or cancel link** for the client | ✅ (the link itself goes out through the outbox) | The confirmation screen | Open the link → **Reschedule** → **Move my booking**. |
| **Client accounts:** visits, cards, points, "Book again" | ✅ | Booking site → **My account** | Tap the client button on the demo sign-in to see Aurora Baker's account. |
| **Patch tests online.** New color clients book a patch test first. | ✅ | The services step asks | Choose a color service and answer "No" to the patch test question. |
| **Booking links for Google, Instagram, Facebook and the website,** with Reports showing where bookings came from | ✅ | Settings → Online booking → "Booking links for Google and social" | Copy the Instagram link, then show Reports → "Where online bookings came from". |
| **Found by Google:** each salon page has its own title, description and salon details | ✅ | Automatic | Not worth demoing live. |
| **Wedding and event inquiries** from the site, with up to 6 photos | ✅ | Booking site → **Weddings and events** | Send an inquiry, then find it under Events → Inquiry. |
| **Harbor & Vine's own site** | ✅ | The harbor-and-vine booking site | Show that a second salon has its own brand and stylists. |

## Checkout and payments

| What | Status | Where | Show it |
|---|---|---|---|
| **Full-screen checkout** for the iPad: lines by stylist, products, scanning, quick-add tiles | ✅ | Booking details → **Check out**, or **New sale** | Check out Linda Park. |
| **Card, cash, gift card, package, membership and split payments** | 🟡 (card is recorded as taken on the salon's machine) | Payment column | Pay $40 in cash (change shown) and the rest by **Card** → **Complete sale**. |
| **Tips per stylist** (18, 20, 25% or custom) | ✅ | "Tips · on each stylist's services" | Tap 20% for Bridget. |
| **Discounts,** whole sale or one line, always with a reason. Limits by role, and a manager signs in on the spot for more. | ✅ | **Discount** under the lines | Take 10% off as Sam. |
| **Selling a product that's out of stock** needs a manager's OK | ✅ | Appears when you add one | Add an out-of-stock product → **Manager OK**. |
| **Rebook before they leave,** at the client's usual rhythm | ✅ | "Rebook" on the checkout | **Book it** at the suggested time. |
| **Receipts:** print or email | ✅ print · 🟡 email (outbox) | After **Complete sale** | Tap **Email** → show it in the outbox. |
| **Text a payment link instead** (the client pays and tips on their own phone) | 🟡 (test cards, text in the outbox) | Checkout → **Text a payment link instead** | Send it, open the link from the outbox, pay with 4242. The checkout turns to "Paid by link". |
| **Void and refund,** with stock and gift cards put back | ✅ (online card refunds use test cards) | Sales → a sale → **Void sale** / **Refund** | Refund one product from today's sale. |
| **Sales list and end-of-day close-out** (expected cash vs counted) | ✅ | **Sales**; Reports → **Close out the day** | Type the cash counted → **Save count**. |
| **Real card payments** (Stripe and card readers) | 🔜 | | Don't promise. |

## Gift cards, packages, memberships and rewards

| What | Status | Where | Show it |
|---|---|---|---|
| **Gift cards:** sell physical or digital, reload, redeem, balance check, promotional cards, history | ✅ (digital cards are emailed to the outbox) | Checkout → **Gift card**; **Gift cards** page | Sell a $100 digital gift card, then **Check a balance**. |
| **Packages** (for example 5 Blowouts) used at checkout | ✅ | Settings → Packages; checkout → **Package** | The checkout ticks the package by itself for a client who has one. |
| **Memberships** (Blowout Club, Color Club): member prices, included services, pause, end, renewals | 🟡 (renewals charge test cards) | Settings → Memberships; client profile → Membership | Show the past-due member on the Dashboard ("Membership payments that failed") → **Try the payment again**. |
| **Rewards:** points on every sale, tiers (Silver, Gold, VIP), rewards at checkout, referrals | ✅ | Settings → Rewards; checkout → **Rewards** | Check out Linda Park. She's 40 points from a free gloss, so add a retail product and redeem **Free gloss**. |

## Promotions and specials

| What | Status | Where | Show it |
|---|---|---|---|
| **Promotions:** codes, automatic, and last-minute specials, with limits and exclusions | ✅ | **Promotions → New promotion** | Point at WELCOME15, "Retail $10 off $60" and "Last-minute 15%" (never on Master color). |
| **Specials on the booking site** (times marked "15% off") | ✅ | Booking site, date and time step | Pick a time in the next 48 hours and show the badge. |
| **Results per promotion:** uses, revenue, discount cost, gaps filled, new clients | ✅ | Promotions list and Reports → Promotions | Show the numbers under "Last-minute 15%". |
| **Denise's ideas for open time:** regulars who'd fit a gap, sent a fixed offer message by staff | 🟡 (message in the outbox) | Promotions → **Ideas for open time** | Tap **Message** → **Send** on one suggestion. |

## Policies and fees

| What | Status | Where | Show it |
|---|---|---|---|
| **Cancellation policy:** card on file, deposits, late cancel and no-show fees, repeat offenders, stricter rules per stylist (Gil's: 72 hours) | ✅ | Settings → **Policies** | Open "What clients see". |
| **Card link** for a client to save a card and agree to the policy | 🟡 (test cards, link in the outbox) | Booking details → **Send card link** | Send it, open it from the outbox, save 4242. |
| **Fees charged automatically** after a no-show or late cancel, with 10 minutes to undo, waiving and receipts | 🟡 (test cards) | **Policy** page; booking details | Mark a carded client as a no-show and show the fee on Policy. |
| **Policy page:** recovered, charged, waived, failed, repeat offenders | ✅ | Sales → **Policy** | Open it as Olivia. |

## Clients and profiles

| What | Status | Where | Show it |
|---|---|---|---|
| **Client list,** sortable: last visit, next visit, usual stylist, spend | ✅ | **Clients** | Sort by Spend, the biggest spender first. |
| **Profile:** allergies, tags (VIP, New, member, No texts), notes with who edited them, and quick **Book**, **Message**, **Check out** | ✅ | Clients → a client | Open Maria Lopez. |
| **Color formulas** with products in grams, which also take that stock off the shelf | ✅ | Profile → **Formulas**; booking details → **Formula** | Show a Goldwell formula on a color client. |
| **Before and after photos,** private, with marketing consent | ✅ | Booking details → **Photos** | Upload a before photo. |
| **Patch tests** | ✅ | Profile → **Patch tests → Add patch test** | Record one for a new color client. |
| **Consultation and consent forms,** signed on the iPad | ✅ | **Forms**; profile → **Forms** | Show "Color consent" → fill it in on the screen. |
| **Message client:** quick picks or staff's own words, following each client's text and email choices | 🟡 (outbox) | Profile → **Message**; booking details → **⋯ → Message client** | Write a message, and show that the STOP'd client (Bella Carter) gets email only. |
| **Download all the salon's data** (a zip of spreadsheets) | ✅ | Settings → **Your data → Download all data** | Show the download log. |

## Team, levels and scheduling

| What | Status | Where | Show it |
|---|---|---|---|
| **Team directory,** add a member, deactivate (history kept) | ✅ | **Team → Add team member** | Open Gil's page. |
| **Invite emails and password resets** for staff | 🟡 (off on the demo) | Team → a member → **Send invite** | Mention it only. |
| **Levels** (Master, Senior, Artisan, Junior), with prices per level and a color and badge on the calendar | ✅ | Settings → **Levels** | Show the gold ring on Gil's avatar and the Key. |
| **Scheduling:** the week as drafts, then **Publish week**, plus repeating patterns (Lois every other Saturday) | ✅ | **Scheduling** | Next week has a draft with Sandra picking up a Saturday → **Publish week**. |
| **Time-off requests,** with clients booked shown and "Approve and plan clients" | ✅ | Staff: **Time off**. Managers: **Scheduling → Requests**. | Hannah's short-notice Saturday request → **Approve and plan clients**. |
| **Shift swaps** for the front desk and assistants | ✅ | **Shift swaps**; managers on Scheduling → Requests | Jordan's Thursday going to Sam is waiting for a manager → **Approve swap**. |
| **Chairs and stations,** home chairs and lending a chair for a day | ✅ | Settings → **Stations**; **Scheduling → Floor today** | Shae is on Sandra's Chair 4 this Saturday. |
| **Calendar order** | ✅ | Team → **Calendar order**, or drag a column header | Drag Lois to the front. |
| **Shared front-desk iPad:** switch user with a PIN | ✅ | Settings → **Shared devices**, then **Switch user** | Switch to Bridget with PIN 5937. |

## Commission, tips, payroll and goals

| What | Status | Where | Show it |
|---|---|---|---|
| **Commission plans:** flat or tiered, back-bar fees, hourly | ✅ | Settings → **Commission** | Gil's "Senior tiers": 40, 45 and 50% by month, with a $3 back-bar fee. |
| **Payroll:** sales, commission, tips and hours per person, with the tickets behind each figure; CSV for the payroll provider | ✅ (a report and export, not payouts) | Sales → **Payroll → Export CSV** | Tap Bridget's name to see her tickets. |
| **Itemized tips:** each tip, average tip and top tippers | ✅ | Payroll → Tips; My day → My tips | Show Bridget's average tip. |
| **Live earnings on My day** ("You're $412 from 45%…") | ✅ | Bridget or Gil → My day | Sign in as Gil and read his next tier. |
| **Goals with pacing** ("You're on pace…"), set by owners or by stylists for themselves | ✅ | Team → **Goals**; My day → My goals | Show Bridget's monthly service goal. |
| **Paying staff** (direct deposit, payroll providers) | 🔜 | | Don't promise. |

## Inventory and ordering

| What | Status | Where | Show it |
|---|---|---|---|
| **Products and stock,** retail and back bar in grams or ml, low-stock flags | ✅ | **Inventory** | Filter to Low stock. |
| **Color used on services comes off the shelf by itself** | ✅ | Automatic at checkout | Show a color product's history after a color checkout. |
| **Purchase orders:** draft, sent, received in parts | 🟡 (**Mark as sent** only marks it; nothing is sent to the supplier) | Inventory → **Orders** | Receive part of the Lakeshore "Toner restock" order. |
| **Stocktakes,** shelf by shelf on a tablet, flagging possible shrinkage | ✅ | Inventory → **Start a stocktake** | Count one shelf → **Review and finish**. |

## Events and bridal

| What | Status | Where | Show it |
|---|---|---|---|
| **Pipeline:** Inquiry → Proposal sent → Booked → Trial done → Event day → Completed, plus Lost | ✅ | **Events** | Open it. Eight demo events are spread across the stages. |
| **Builder:** party, packages, travel, early start, a live total, payment schedule | ✅ | Events → **New event** | Add a bride and 4 bridesmaids. |
| **Timeline:** planned back from the ready-by time, a row per artist, drag to adjust | ✅ | The event → Timeline | Open the Rossi wedding (this Sunday, party of 6). |
| **Proposal and contract:** the client signs and pays the deposit online | 🟡 (outbox, test cards) | The event → **Send proposal** | Patel is waiting on the deposit. Open the link from the outbox. |
| **Payments:** deposit, second payment, balance, failed payments | 🟡 (test cards) | The event → Payments | Rossi's balance was declined → **Ask for another card**. |
| **The team's time held on the calendar,** trials booked, day-of sheet to print | ✅ | The event; **Print or save as PDF** | Show the Rossi hold on the calendar, then the day sheet. |
| **Completing an event into one sale** for payroll | ✅ | **Complete event** | Brooks (last Sunday, paid in full) → **Complete event**. |

## Reports

| What | Status | Where | Show it |
|---|---|---|---|
| **Reports:** what the salon owes in services, gift cards, memberships (monthly revenue, churn), promotions, rewards, bridal and events, where online bookings came from, rebooked at checkout, close out the day | ✅ | **Reports** (owners and managers) | Rebooked at checkout by stylist, then membership revenue. |
| **General sales and revenue reports** (sales by stylist over time, by service) | 🔜 (the Dashboard and Payroll show some of this) | | Don't promise a full reporting suite. |

## Roles and permissions

| What | Status | Where | Show it |
|---|---|---|---|
| **Five roles,** each seeing only what it should: owner, manager, front desk, stylist (their own book, no salon money) and assistant (their stylist's book, read-only) | ✅ | Automatic | Sign in as Bridget: no Sales, no salon money. |
| **Switches per person** (reports, refunds, discounts over the limit, waiving fees, payroll…) | ✅ | Team → a member → "What they can do" | Give Sam reports, then take them away. |
| **Each salon's data kept apart** | ✅ | Automatic | Switch between Maple & Ash and Harbor & Vine accounts. |

## Settings

| What | Status | Where | Show it |
|---|---|---|---|
| **The salon's own settings:** hours, logo and colors, levels, stations, time off, online booking, booking page photos, policies, tax and receipts, gift cards, packages, events, memberships, rewards, automations, messages, shared devices, payroll, commission, your data, billing | ✅ | **Settings** | Settings → Booking page: the cover and stylist portraits. |
| **Marketing automations:** rebook reminders, win-back, birthdays, review requests, with results | 🟡 (outbox) | Settings → **Automations** | Show the preview, then **Send due messages now** → the outbox. |
| **Billing for Maestra itself** (plan, Denise's daily limit) | 🟡 (shows the plan and limit, no real billing) | Settings → **Billing** | Skip. |
| **Importing from Phorest or other software** | 🔜 (a behind-the-scenes test against Phorest only; no import screen) | | Don't promise. |

## Demo mode

| What | Status | Where | Show it |
|---|---|---|---|
| **One-tap sign-in** for every role and a client | ✅ | The demo sign-in page | Start as Sam, the front desk. |
| **Demo bar** with the outbox and **Feedback** | ✅ | The top of every page | Open the outbox after any message. |
| **Nightly reset** to fresh data | ✅ | Automatic | Mention it: "play freely". |

---

# Part 2: What Denise does

Denise works in two ways:
- **Plain rules, no AI.** Most of what she does: spotting problems, the fixes, the brief, reorders and suggestions. It runs even without the AI.
- **Her AI service** handles only four things:
  - answering free-form questions;
  - reading a booking typed in plain words;
  - the "Why it works" sentence on a fix;
  - drafting an event from a description.

Without the AI, each of those falls back to simpler wording or a form. On the demo the AI is connected.

## What she watches for

| What | Status | Where | Show it |
|---|---|---|---|
| **The day going wrong:** a stylist running over, a client late, someone calling out, a double-booking | ✅ | Calendar → Denise's card (her face under the calendar, the badge bounces) | Report Gil running 20 min late. Her card shows the fix. |
| **Visits likely to run over,** from each stylist's real times (checked twice a night) | ✅ | The Dashboard's "Risks today" | "Gil usually takes about 25 min longer than booked for…" |
| **Clients who haven't arrived** 15 minutes after their time | ✅ | Denise's card: "Not arrived yet", with **Mark no-show** | Point at a past-due visit that's still booked. |
| **The morning brief:** Risks today, Might not show, Due back with nothing booked, Low stock for today, Coming in with credit, Events coming up | ✅ | Dashboard → **Denise's brief** | Read it top to bottom as Olivia. |
| **Event problems:** a failed payment, a balance due, no trial booked, the headcount cutoff, a team member now off | ✅ | Dashboard → "Events coming up" | Rossi's declined balance, and Okafor (no trial; Nola off that day). |
| **Time that opens up,** matched to the waitlist | ✅ | Denise's card → **Book** | Cancel a visit and watch the waitlist match appear. |
| **Stock running short** for what's booked | ✅ | Denise's card, "reorders ready to review" | Tap **Review on Inventory**. |

## What she suggests or drafts (staff decide)

| What | Status | Where | Show it |
|---|---|---|---|
| **Fixes for the day:** the fewest clients moved by the least, previewed on the calendar, with **Apply fix**, **Dismiss** and **Undo** | ✅ (the "Why it works" sentence uses her AI service) | Calendar → Denise's card | Apply, then Undo. The calendar goes back exactly. |
| **A plan for every client when a stylist is out** | ✅ | Column menu → **Mark … out** | "Nola called out" in her chat → **Mark Nola out**. |
| **Reorders drafted per supplier** from the next two weeks of bookings and formulas | ✅ (nothing is ordered by itself) | Inventory → "Denise's reorder suggestions" → **Draft this order** | Draft one, then **Undo**. |
| **Better service lengths** from each stylist's real times | ✅ | **Durations** (owners and managers) → **Use 2 hr 55 min** | Show the "Denise suggests" column, then Use and Undo. |
| **Marketing automations worth turning on** | ✅ | Settings → Automations → "Denise suggests" → **Turn on** | Turn one on, then **Undo**. |
| **Next month's schedule draft,** covering front-desk gaps | ✅ | Scheduling → Denise's card → **Draft December** | **Add to the draft**, then look at the week. |
| **Regulars to fill open time** with a special | 🟡 (outbox) | Promotions → **Ideas for open time** | As in Part 1. |
| **Rebooking at checkout** at the client's usual rhythm | ✅ | Checkout → Rebook | **Book it**. |
| **An event drafted from a description** | ✅ | Events → New event → **Describe it to Denise → Draft it** | "Wedding June 14, bride plus 4 bridesmaids, hair and makeup, ready by 1pm at the Langford". |

## What she answers

| What | Status | Where | Show it |
|---|---|---|---|
| **Questions about the salon,** answered from its own data | ✅ | Her face in the corner of any page, **Ask Denise** in the sidebar, or ⌘K / Ctrl+K | "Who's cancelled late this month?" · "Who's working this afternoon?" · "Which regulars are overdue?" · "How long does Shae take for a men's cut?" · "What weddings do we have in June?" |
| **Owner questions** (sales, gift cards owed, unused packages, rewards, "Can I give Nola Friday off?") | ✅ (owners and managers only) | The same | As Olivia: "Can I give Nola Friday off?" |
| **"How do I…?" about Maestra,** answered from the help guide with a button to the right screen | ✅ | The same | "How do I sell a gift card?" brings the steps and **Open new sale**. |
| **The page you're on:** on a client's profile, "When's their next visit?" means that client | ✅ | The same | Ask it on Maria Lopez's profile. |
| **Each role gets only what it may see.** Stylists see their own numbers and no money. | ✅ | Automatic | Ask Bridget's Denise about sales: she says who can see that. |

## What she does from chat

| What | Status | Where | Show it |
|---|---|---|---|
| **Book by typing.** She finds the client and the best three times, each with a reason and a **Book** button; also another day, a same-level stylist, the waitlist or a new client. | ✅ (front desk, managers, owners) | Her chat on any page | "Maria, cut with Gil Thursday morning" → **Book** → **Confirm booking**. |
| **Running late** | ✅ | Her chat | "Gil is running 20 minutes late" gives a link to the running-late panel. |
| **Someone calling out or leaving early** | ✅ | Her chat | "Nola called out", or "Gil has to leave at 1" → **Mark Nola out**. |
| **Messaging clients** | Never, by design | | She drafts nothing to clients. Staff send fixed messages or their own. |

## Her guardrails

| What | Status |
|---|---|
| **Staff approve every change.** She never moves a visit, orders stock or turns anything on by herself. | ✅ |
| **Everything she suggests is logged** with its reason, who applied it and when, and can be undone. Undo checks the old times are still free. | ✅ |
| **She never messages clients.** The system refuses any client message from a fix, and after a fix staff are shown the message to send themselves. | ✅ |
| **Every number comes from the salon's own data,** worked out by Maestra. Her AI service only explains. | ✅ |
| **Privacy:** her AI service gets first names only (no last names, phones, emails, notes, allergies or payment details), and each salon sees only its own data. | ✅ |
| **She never guesses anyone's pronouns.** An answer that does is reworded. | ✅ |
| **A daily allowance per salon,** with plain wording after it (on the demo, 20 questions per 10 minutes too) | ✅ |
| **Works without her AI:** watching, fixes, the brief and suggestions keep going | ✅ |
| **Meet Denise,** a page explaining all of this, with questions to try | ✅ Settings → **Denise**, or **What can Denise do?** in her header |

---

# Best 10 demo moments

1. **Meet Denise.** Sign in as Sam, open Denise and tap **What can Denise do?**. It frames the whole demo in one minute.
2. **The morning brief.** Dashboard as Olivia: risks, likely no-shows, overdue regulars and Rossi's declined wedding balance, before the doors open.
3. **A stylist runs late.** Calendar → Gil's ⋯ → **Gil is running late…** → 20 min → **Show what it pushes into**. Denise's fix is previewed on the calendar → **Apply fix** → **Undo**.
   - The planted "Gil in the chair now" moment only exists when the demo data loads during opening hours, and the live demo resets overnight. Before the demo, try a stylist with a client in the chair and a client right after. If no fix appears, use moment 4 instead.
4. **Someone calls out.** Type "Nola called out" to Denise → **Mark Nola out** → a plan for every client → **Apply plan**.
5. **Booking by typing.** "Maria, cut with Gil Thursday morning" → three times with reasons → **Book** → the policy check → booked. Maria's latex allergy and card on file show on the card.
6. **Drag anywhere.** Drag a visit onto another stylist and read the live label. Drop it on another client: the preview turns amber and it asks "Double-book anyway?". Then **Let Maria know?** → **Send** → the outbox.
7. **Checkout on the iPad.** Linda Park: a product, a 20% tip, **Free gloss** from her points, split cash and card, then **Book it** for her next visit.
8. **Ask her about the business.** "Who's cancelled late this month?", then "How do I sell a gift card?" (steps plus a button).
9. **The client side, on a phone.** The booking site with a deposit (test card 4242), then Aurora Baker's account and **Book again**.
10. **The wedding.** Events → Rossi: the timeline, the team's time held on the calendar, and the day sheet. Then **Describe it to Denise** for a new one.

# Don't promise yet

- **Real card charges.** Card payments at the desk are recorded only, and online payments use test cards. There's no Stripe or card reader yet.
- **Real texts and emails to clients.** Every message waits in the outbox; none reach a phone or inbox. Appointment reminders don't exist yet.
- **Importing from Phorest or other software.** There's no import screen.
- **Week view** on the calendar.
- **Paying staff.** Payroll is a report and a spreadsheet, not payouts.
- **Orders sent to suppliers.** "Mark as sent" only marks it.
- **Full sales reporting** (revenue by stylist or service over time).
- **More than one location** working together (each team member works at one location for now).
