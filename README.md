# Maestra

Maestra runs a salon: the calendar and online booking, clients, the team's
schedules, services, stock, and the back office, with **Denise**, Maestra's
AI assistant, spotting problems and proposing fixes for staff to approve.

*Maestra: the master who conducts the whole salon. Your salon's brain. Meet Denise.*

- Product spec: [`docs/spec.md`](docs/spec.md)
- Brand guide: [`docs/brand.md`](docs/brand.md)
- How to work in this codebase: [`CLAUDE.md`](CLAUDE.md)

## Stack

Next.js (App Router) and TypeScript, Tailwind CSS, Supabase (Postgres, auth,
storage) with Row Level Security on every table, hosted on Vercel. Denise
uses the Claude API when `ANTHROPIC_API_KEY` is set.

## Running it locally

You need Node.js, Docker (on a Mac, `colima start`) and the Supabase CLI.

```sh
npm install
colima start                 # the Docker runtime local Supabase needs
npx supabase start           # database, auth, storage; Studio at http://127.0.0.1:54323
npx supabase db reset        # migrations and realistic fake data
cp .env.example .env.local   # then fill in the keys `supabase status` prints
npm run dev                  # http://localhost:3000
```

Sign in with a seeded account, for example `owner@mapleandash.test`,
`frontdesk@mapleandash.test` or `priya@mapleandash.test` (password
`password123`). The seed is a made-up salon, Maple & Ash; there's no real
client data in development.

## Checks

```sh
npm run lint
npm run typecheck
npm test             # unit tests, no database needed
npm run test:db      # RLS and database tests (local Supabase with the seed)
npm run test:e2e     # Playwright (first time: npx playwright install chromium)
```

## Two brands

Maestra is the product brand: the login screen, browser tab and app icon,
the loading screen, platform emails, and "Powered by Maestra" in the
sidebar. Each salon keeps its own brand, its name and logo (set by owners in
Settings), at the top of the sidebar and on messages to its clients.
