# Maestra help guide

One short page per task, written for front desk staff in plain language. Denise answers "How do I…?" questions from these pages only (her `how_to` tool, `lib/help/`): the best page's steps, who can do it, and a button that opens the screen it starts on. If no page covers a question she says so rather than guessing, so **every new or changed feature updates its page here in the same commit**.

## A page

`docs/help/<task-in-kebab-case>.md`:

```
---
title: Sell a gift card
keywords: gift card, gift certificate, voucher, ring up a gift card
who: owner, manager, front_desk
open: /checkout/new?from=/sales | Open new sale
---

Sell a physical or digital gift card at checkout, on its own or with a visit.

1. Go to **Sales** and tap **New sale**.
2. Under the lines, tap **Gift card**.
3. …

## Good to know

- Gift cards are $5 to $1,000 and aren't taxed or discounted.

## If it doesn't work

- **Complete sale** is greyed out: the reason is shown just above it.
```

- **title**: the task as staff would say it, starting with a verb. Titles are unique.
- **keywords**: the words and phrases staff might use for it, slang and other salons' software included ("ring up", "voucher", "comp"). Search matches the question against the title and keywords first, so this is how a page gets found.
- **who**: the roles that can do it: `owner`, `manager`, `front_desk`, `stylist`, `assistant`. Owners can also give someone a permission their role lacks (Team → their page); `who` lists the roles that can by default. Check the permission in the code. Someone not listed gets no steps from Denise, only who can.
- **open** (optional): the screen to start on, then `|` and its button label, starting with "Open". It must be a real page (no ids).
- **Body**: one sentence on what it is; numbered steps (3 to 10, one action each, with on-screen labels in bold, exactly as they appear); then up to five "Good to know" bullets and up to three "If it doesn't work" bullets. Under about 250 words. Say "tap", "the calendar", "booking details", "Denise's panel". No code names or file paths.
- Say plainly when something only half works yet (texts and email wait in the outbox; card payments are recorded as taken on the salon's terminal; memberships and payment links use test cards).

`tests/unit/help.test.ts` checks every page parses, has steps, and opens a real screen, and that common questions find the right page. `EVAL_DRY=1 npm run eval:denise` checks the how-to questions in the eval find theirs.
