# Going live: real payments, texts and email

Maestra already contains everything for Stripe (card payments), Twilio (texts) and Resend (email). Until the keys are set and a salon turns on **Go live**:

- every text and email waits in the outbox;
- only test cards work;
- no money moves.

Switching each one on takes no new code: you sign up, add the keys and press the buttons below.

## The safety rules (built in)

**Nothing real ever goes out unless all of these are true** (`liveGate` in `lib/live.ts`):

- `MAESTRA_ENV=production` is set;
- the app is a production build;
- on Vercel, the deploy is the Production one (never a Preview);
- the database is hosted (not local);
- it isn't the demo (`DEMO_MODE`) or the browser tests' server.

If any of those is false, keys are ignored for anything real. So putting the keys somewhere else by mistake can't send a text or charge a card. Two small exceptions:

- Stripe's **test** keys (`sk_test_…`) only ever use Stripe's own test mode, where no money moves. They may be used on a staging copy (never the demo) to try the real card form.
- The texts-and-email **test send** on Settings → Messages is real on production even before the salon goes live, because it only goes to the number or address the owner types.

**Each salon then turns it on itself:**

- Settings → Messages → **Go live**, and Settings → Payments → **Go live**.
- Only owners (the `billing` permission) can, and every change is logged with who made it (`go_live_events`).
- Messages written before going live are never sent later.

## 1. What to sign up for

| Service | What it does | Sign up | What to set up there |
|---|---|---|---|
| **Stripe** | Cards on file, deposits, no-show and late-cancel fees, payment links, event payments, membership renewals, refunds | stripe.com: a Stripe account for Maestra as a **platform**, then **Connect** turned on in the dashboard | Connect → Settings: platform profile, branding (Maestra name, icon and colors), **Standard** accounts. Each salon connects its own Stripe account from Maestra, so money goes straight to the salon. |
| **Twilio** | Texts (visit confirmations, card and payment links, automations, staff messages) and STOP/START/HELP | twilio.com: upgrade from trial (add billing) | <ul><li>Buy one US phone number, or a toll-free number.</li><li>Create a **Messaging Service** and add the number to it.</li><li>Complete **A2P 10DLC registration** (a brand, then a campaign of "Customer care / account notifications", with sample messages) for a local number, or **toll-free verification** for a toll-free one.</li></ul>US carriers block unregistered texts, and approval can take 1–3 weeks, so start this first. |
| **Resend** | Email (receipts, digital gift cards, confirmations, automations) | resend.com | Add and verify the domain you send from (for example `mail.maestra.app`): add the DNS records Resend shows (SPF, DKIM and the return path). |

Everything else is already set up: Supabase (database and scheduled jobs) and Vercel (hosting).

## 2. Which keys go where

Put these **only in the Vercel project for the production app**, under Settings → Environment Variables, with the **Production** environment ticked. Never tick Preview or Development, never put them in the demo project (`maestra-demo`), and never commit them. Locally you never need them.

| Variable | Where to find it | Notes |
|---|---|---|
| `MAESTRA_ENV` | — | Exactly `production`. This is the switch that lets anything real happen at all. |
| `NEXT_PUBLIC_SITE_URL` | — | The production address, for example `https://app.maestra.app` (links in texts and email, and where Stripe sends owners back to). |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys | `sk_live_…`. Use `sk_test_…` first to try everything in test mode. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Same page | `pk_live_…`, which must match the secret key (both live or both test). |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks, after adding the endpoint below | `whsec_…` |
| `TWILIO_ACCOUNT_SID` | Twilio console home | `AC…` |
| `TWILIO_AUTH_TOKEN` | Twilio console home | Also checks the signatures on inbound texts and status callbacks. |
| `TWILIO_MESSAGING_SERVICE_SID` | Messaging → Services | `MG…` (preferred). Or `TWILIO_FROM_NUMBER` (`+1…`) instead. |
| `RESEND_API_KEY` | Resend → API Keys | `re_…`, "Sending access" for the verified domain is enough. |
| `EMAIL_FROM_ADDRESS` | — | An address on the verified domain, for example `hello@mail.maestra.app`. Emails show the salon's name with it. |
| `RESEND_WEBHOOK_SECRET` | Resend → Webhooks, after adding the endpoint below | `whsec_…` |
| `CRON_SECRET` | — | Any long random string (already set if the scheduled jobs are running). |

Redeploy production after adding them (Vercel → Deployments → Redeploy), since environment variables are read at build and start.

## 3. Webhooks to add

Replace `https://APP` with the production address.

| Where | URL | Events |
|---|---|---|
| Stripe → Developers → Webhooks → Add endpoint, **"Events on Connected accounts"** | `https://APP/api/payments/stripe/webhook` | `account.updated`, `account.application.deauthorized` |
| Twilio → Messaging Service → Integration → **Incoming messages: Send a webhook** | `https://APP/api/messages/inbound` (HTTP POST) | Replies, including STOP / START / HELP |
| Twilio delivery status | Nothing to add: each text asks for its own status callback (`https://APP/api/messages/status`) | Delivered, failed, and carrier STOPs |
| Resend → Webhooks → Add endpoint | `https://APP/api/messages/email-events` | `email.delivered`, `email.bounced`, `email.complained` |

Each endpoint refuses requests whose signature doesn't check out.

On the Twilio Messaging Service, leave **Advanced Opt-Out** on. Twilio answers STOP itself, and Maestra records it so no salon texts that number again.

## 4. Make sure the scheduled jobs point at production

Texts and email are sent every minute by a job the database runs (`maestra-messages`, with the others). If production already runs the nightly jobs, this is done. Otherwise, with the production database's settings:

```
npm run jobs -- configure https://APP
npm run jobs -- status
```

## 5. Switch each one on

### Texts and email

1. Add the Twilio and/or Resend keys and webhooks above, and redeploy.
2. As a salon owner, open **Settings → Messages**. **Texts** and **Email** should say **Connected**.
3. Under **Send a test to yourself**, send a text and an email to yourself and check they arrive.
4. Tap **Go live**. From then on, new messages go to clients, by the channels they've agreed to, with STOP always honored.
5. To stop: **Stop sending to clients** (messages then wait in the outbox again).

### Card payments

1. Add the Stripe **test** keys and webhook first, and redeploy.
2. As a salon owner, open **Settings → Payments** and tap **Connect with Stripe**. Stripe opens: the salon signs in to (or makes) its own Stripe account and fills in its business and bank details, then comes back. **Stripe account** says **Ready**, and **Payments** says **Test mode**.
3. Try it with Stripe's test card `4242 4242 4242 4242`:
   - a card link;
   - a booking with a deposit;
   - a payment link;
   - a no-show fee;
   - a refund.
4. Swap in the **live** keys (`sk_live_…`, `pk_live_…`, and the live webhook's secret), and redeploy. A salon connected in test mode connects again with the live keys: tap **Connect with Stripe** once more.
5. Tap **Go live**. **Payments** says **Live**, and clients' cards are charged for real.
6. To stop: **Stop taking real payments**. Disconnecting (**Disconnect Stripe…**) also works; cards clients saved stay in the salon's Stripe account.

Card payments taken at the front desk are still recorded as taken on the salon's own card machine. Stripe Terminal (card readers) comes later, behind the same layer.

## 6. Good to know

- **Cards are never stored by Maestra.**
  - Clients type them into Stripe's own form, loaded from Stripe.
  - Maestra keeps only a reference and "Visa …4242".
  - Every charge has an idempotency key, so a retry never charges twice.
- **Fees and refunds** follow the salon's policy as now. Stripe's processing fee comes out of the salon's Stripe balance, and Maestra takes no cut (no application fee is set).
- **Currency:** US dollars, US salons.
- **Costs to expect:**
  - Stripe: per-card fees, paid by the salon.
  - Twilio: a number, a monthly fee for A2P registration, and per text.
  - Resend: free up to a monthly limit, then a plan.
- **If something goes wrong:**
  - A text or email that fails is marked failed on the outbox row, with a short code and no message text.
  - A bounced email address and a STOP'd number are never tried again.
  - A card that's declined shows the reason where it was used and on the Dashboard.
- **Turning everything off quickly:** remove `MAESTRA_ENV` in Vercel and redeploy. Every send and live charge stops at once, for every salon, whatever their switches say.
