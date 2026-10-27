// npm run screenshots [-- --yes] [-- --reuse]
//
// Marketing screenshots of Maple & Ash for the pitch deck, saved to
// screenshots/ (git-ignored). It resets the local database (it asks first,
// unless --yes), loads the demo data as of a busy moment (the most recent
// open day, about 40% of the way through it, so some clients are checked
// out, some in the chair and the rest still to come), builds the app for
// production and runs it on its own port, then drives Chromium at 1440×900,
// 2× and light mode through each screen.
//
// The demo clock: the seed, the insights, the app server (scripts/
// demo-clock.ts) and the browser all run at that moment, the same number of
// minutes behind the real clock, so everything agrees. Nothing on screen is
// faked: each shot is the real page over the demo data, and the conflict,
// the question for Denise (a real Claude call, when ANTHROPIC_API_KEY is
// set), the checkout and the client's sign-in are done through the app as
// staff and clients would.
//
// --reuse takes the shots again without resetting, seeding or building
// (the same day, after a full run); with --build it builds again first (the
// same data, the app as it is now). --out=<folder> saves them somewhere
// else (screenshots/polish/… for before-and-after pairs, scripts/polish-pairs.ts).

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types.ts";
import { addDays, fromLocal, todayIn, toLocal, weekdayOf, type LocalDate } from "../lib/scheduling/time.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to the environment.
}

const BUSINESS = "b0000000-0000-4000-8000-000000000001";
const SLUG = "maple-and-ash";
const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) || "screenshots";
const DIST = ".next-screenshots";
const PASSWORD = "password123";
const VIEWPORT = { width: 1440, height: 900 };
const ASK = "Who’s cancelled late this month?";
// What to keep off the shots (there are no cookie banners).
const HIDE = `[class*="animate-toast-in"], [data-testid$="-toast"], a[href^="/dev/outbox"] { display: none !important; } * { caret-color: transparent !important; }`;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(1);
}
const admin = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const reuse = process.argv.includes("--reuse");
if (!reuse && !process.argv.includes("--yes")) {
  if (!process.stdin.isTTY) {
    console.error("This resets the local database (npm run seed:demo). Run it with --yes to go ahead.");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("This resets the local database, so anything you've added locally goes. Continue? [y/N] ");
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) process.exit(0);
}

const run = (command: string, args: string[], env: Record<string, string> = {}, input?: string) =>
  execFileSync(command, args, { stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"], input, env: { ...process.env, ...env } });

// 1. The default seed, then the moment to show.
if (!reuse) {
  console.log("Resetting the local database…");
  run("npx", ["supabase", "db", "reset"]);
}
const { data: location, error: locationError } = await admin.from("locations").select("id, timezone, location_hours(weekday, start_minute, end_minute)").eq("business_id", BUSINESS).single();
if (locationError) throw locationError;
const tz = location.timezone;
const moment = busyMoment(location.location_hours, tz, new Date());
const offset = moment.getTime() - Date.now();
const clock = { MAESTRA_DEMO_OFFSET_MS: String(offset) };
const now = () => new Date(Date.now() + offset);
const today = toLocal(moment, tz).date;
console.log(`Demo moment: ${today} at ${hhmm(toLocal(moment, tz).minute)} (${tz}).`);

// 2. The busy month and the large salon as of that moment: the seed's
// now() reads the demo clock (a now() ahead of pg_catalog's on the search
// path, for this session only), then what Denise has learned.
// The seed plants the moment Denise fixes (a color in the chair with a
// client booked after it), whatever else the day holds.
// Database functions with their own search path read the real clock, so the
// one that decides whether an event's date has passed reads the demo clock
// while the seed loads (the moment can be the day before: Rossi's wedding
// "this Sunday" is then today), and is put back after.
const eventToday = (clock: string) => `create or replace function private.event_today(p_event_id uuid) returns date language sql stable security definer set search_path = '' as $$
  select (${clock} at time zone l.timezone)::date from public.events e join public.locations l on l.id = e.location_id where e.id = p_event_id;
$$;\n`;
const prelude = `create schema demo_clock;
create function demo_clock.now() returns timestamptz language sql stable as $$ select '${moment.toISOString()}'::timestamptz $$;
${eventToday(`'${moment.toISOString()}'::timestamptz`)}set search_path = demo_clock, public, extensions, pg_catalog;\n`;
const postlude = `\nreset search_path;\n${eventToday("now()")}drop schema demo_clock cascade;\n`;
if (!reuse) {
  console.log("Loading the demo data…");
  for (const file of ["supabase/seed-demo.sql", "supabase/seed-large.sql"]) {
    run("docker", ["exec", "-i", "supabase_db_salon-platform", "psql", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {}, `${prelude}${readFileSync(file, "utf8")}${postlude}`);
  }
  if (!(await colorRunningOver()) || !(await visitToCheckOut())) throw new Error("The demo data has no color in the chair with a client after it, or no visit to check out.");
}
if (!reuse) run("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./scripts/demo-clock.ts", "scripts/insights.ts"], clock);

// 3. A production build on its own port, on the demo clock.
const appEnv = { NEXT_DIST_DIR: DIST, NEXT_PUBLIC_SITE_URL: BASE };
if (!reuse || process.argv.includes("--build")) {
  console.log("Building for production…");
  run("npx", ["next", "build"], appEnv);
}
mkdirSync(OUT, { recursive: true });
const server: ChildProcess = spawn("npx", ["next", "start", "--port", String(PORT)], {
  env: { ...process.env, ...appEnv, ...clock, NODE_OPTIONS: "--import ./scripts/demo-clock.ts" },
  stdio: ["ignore", openSync(`${DIST}/server.log`, "w"), openSync(`${DIST}/server.log`, "a")],
  detached: true,
});
const failed: [string, string][] = [];
let browser: Browser | null = null;
try {
  await waitForServer();
  browser = await chromium.launch();
  await capture(browser);
} finally {
  await browser?.close();
  if (server.pid) process.kill(-server.pid);
}

console.log(`\nSaved to ${OUT}/.`);
if (failed.length) {
  console.log("Couldn't capture:");
  for (const [name, why] of failed) console.log(`  ${name}: ${why}`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------

async function capture(browser: Browser) {
  const owner = await signedIn(browser, "owner@mapleandash.test");
  const stylist = await signedIn(browser, "bridget@mapleandash.test");
  const visitor = await context(browser);
  const front = await signedIn(browser, "frontdesk@mapleandash.test");
  const staff = new Map(((await admin.from("staff").select("id, first_name, last_name").eq("business_id", BUSINESS)).data ?? []).map((s) => [s.id, `${s.first_name} ${s.last_name}`]));

  await shot("01-calendar", owner, async (page) => {
    await page.goto("/calendar");
    await waitForReact(page, "section[data-staff-id]");
  });

  // Mid-drag: a booked visit picked up and held half an hour later.
  await shot("30-calendar-drag", front, async (page) => {
    await page.goto("/calendar");
    await waitForReact(page, "section[data-staff-id]");
    const block = main(page).locator("[data-block][data-visit=upcoming]").first();
    const box = (await block.boundingBox())!;
    const ppm = Number(await main(page).locator("[data-px-per-minute]").first().getAttribute("data-px-per-minute"));
    await page.mouse.move(box.x + 24, box.y + 12);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + 24, box.y + 12 + (i * 30 * ppm) / 6);
    return { keepMouse: true };
  });

  // The whole app, page by page (for before-and-after comparisons).
  const page_ = (name: string, ctx: BrowserContext, path: string, ready = "main h1") =>
    shot(name, ctx, async (page) => {
      await page.goto(path);
      await waitForReact(page, ready);
    });
  await shot("14-booking-panel", front, async (page) => {
    await page.goto("/calendar");
    await waitForReact(page, "[data-block]");
    await main(page).locator("[data-block]").nth(3).click();
    await page.getByTestId("visit-status").waitFor();
  });
  await shot("15-denise-panel", front, async (page) => {
    await page.goto("/calendar?denise=1");
    await waitForReact(page, "section[data-staff-id]");
    await page.getByRole("tabpanel", { name: /Denise/ }).waitFor();
  });
  // A booking in Denise's bubble on the Clients page: Maria Lopez's
  // balayage with Bridget, afternoons, through "Book with the form" (so no
  // Claude call even with the key set), the best times with her alerts.
  await shot("31-denise-booking", front, async (page) => {
    await page.goto("/clients");
    await waitForReact(page, "[data-testid=denise-bubble-launcher]");
    await page.getByTestId("denise-bubble-launcher").click();
    const bubble = page.getByRole("complementary", { name: "Denise" });
    await bubble.getByRole("button", { name: "Book with the form" }).click();
    const form = bubble.getByTestId("booking-form");
    await form.getByLabel("Find a client").fill("Maria Lopez");
    await form.getByRole("list", { name: "Matching clients" }).getByRole("button").first().click();
    await form.getByLabel("Service").selectOption({ label: "Balayage" });
    await form.getByLabel("Stylist").selectOption({ label: "Bridget" });
    await form.getByRole("radio", { name: "Afternoon" }).click();
    await form.getByRole("button", { name: "Find times" }).click();
    await bubble.getByTestId("booking-card").waitFor();
    await bubble.getByTestId("booking-card").evaluate((el) => el.scrollIntoView({ block: "end" }));
  });
  // The calendar header: New booking and New sale in view, the rest under More.
  await shot("34-calendar-header", front, async (page) => {
    await page.goto("/calendar");
    await waitForReact(page, "section[data-staff-id]");
    await main(page).getByRole("button", { name: "More", exact: true }).click();
    const menu = page.getByRole("menu", { name: "More" });
    await menu.waitFor();
    return { clip: await union([main(page).getByRole("heading", { level: 1 }), menu, main(page).getByRole("button", { name: "New booking" })], 24) };
  });
  await page_("16-dashboard-front-desk", front, "/dashboard", "[data-testid=dashboard-brief]");
  await page_("17-events", owner, "/events");
  await page_("18-clients", front, "/clients");
  const { data: aurora } = await admin.from("clients").select("id").eq("business_id", BUSINESS).eq("email", "aurora.baker203@example.com").maybeSingle();
  if (aurora) await page_("19-client-profile", front, `/clients/${aurora.id}`);
  await page_("20-payroll", owner, "/payroll");
  await page_("21-reports", owner, "/reports");
  await page_("22-settings", owner, "/settings");
  await page_("23-sales", owner, "/sales");
  await page_("24-inventory", owner, "/inventory");
  await page_("25-team", owner, "/team");
  await page_("26-gift-cards", front, "/gift-cards");
  await page_("27-settings-policies", owner, "/settings/policies");
  await page_("28-my-day-full", stylist, "/my-day");
  await page_("29-booking-site", await context(browser), `/book/${SLUG}`, "[data-testid=booking-flow] button[aria-pressed]");

  await shot("02-denise-fix", owner, async (page) => {
    const overrun = await colorRunningOver();
    if (!overrun) throw new Error("no color in the chair today with a client booked after it");
    await page.goto("/calendar");
    await waitForReact(page, "section[data-staff-id]");
    const column = main(page).getByRole("region", { name: staff.get(overrun.staffId), exact: true });
    await column.getByRole("button", { name: new RegExp(escape(overrun.client)) }).first().click();
    const details = page.getByRole("tabpanel", { name: "Booking details" });
    await details.getByRole("button", { name: "More actions" }).click();
    await details.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name: "Running late", exact: true }).click();
    const form = details.getByRole("form", { name: "Running late" });
    // 20 minutes: moving the next client later beats handing them to
    // another stylist (which Denise counts as 30), so the fix stays in view.
    await form.getByText("20 min", { exact: true }).click();
    const which = form.getByLabel("Which service is running over?");
    if (await which.count()) await which.selectOption(overrun.itemId);
    await form.getByRole("button", { name: "Tell Denise" }).click();
    const denise = page.getByRole("tabpanel", { name: /Denise/ });
    const card = denise.locator("section[data-conflict]").filter({ hasText: `${overrun.stylist.endsWith("s") ? `${overrun.stylist}'` : `${overrun.stylist}'s`} running 20 minutes late` });
    await card.getByRole("button", { name: "Apply fix" }).waitFor({ timeout: 90_000 });
    await page.waitForFunction(() => !document.querySelector("[data-testid=denise-thinking]"), null, { timeout: 90_000, polling: 250 });
    // Her card for it at the top of her panel (her overnight risk check
    // may have others), its fix previewed on the calendar.
    // Once her explanations are in (they arrive after the fixes and move
    // the cards).
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await card.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await card.getByRole("button", { name: "Apply fix" }).hover();
    await main(page).locator("[data-fix-ghost]").first().waitFor();
    await main(page).locator("[data-fix-ghost]").first().scrollIntoViewIfNeeded();
    return { keepMouse: true };
  });

  await shot("03-dashboard-brief", owner, async (page) => {
    await page.goto("/dashboard");
    await main(page).getByTestId("dashboard-brief").waitFor();
  });

  await shot("04-ask-denise", owner, async (page) => {
    await page.goto(`/calendar?ask=${encodeURIComponent(ASK)}`);
    await page.getByRole("region", { name: "Conversation with Denise" }).waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => !document.querySelector("[data-testid=denise-thinking]") && (document.querySelector("section[aria-label='Conversation with Denise']")?.children.length ?? 0) >= 2,
      null,
      { timeout: 120_000, polling: 250 },
    );
  });

  await shot("05-my-day", stylist, async (page) => {
    await page.goto("/my-day");
    await main(page).getByTestId("live-earnings").waitFor();
    if (!(await main(page).getByTestId("goal-alert").count())) throw new Error("Denise's goal alert isn't showing for Bridget");
    await main(page).getByTestId("my-tips").locator("summary").click();
    // Today's earnings, the goal alert and My tips are taller than one
    // screen: show the whole page, then crop to them.
    const height = await main(page).evaluate((el) => el.scrollHeight + 40);
    await page.setViewportSize({ width: VIEWPORT.width, height: Math.max(VIEWPORT.height, height) });
    // Down to the first few itemized tips (the full list runs on for the period).
    const tips = main(page).getByTestId("my-tips");
    return { clip: await union([main(page).getByTestId("live-earnings"), main(page).getByTestId("goal-alert"), tips.locator("summary"), tips.getByTestId("tip-item").nth(2)], 32) };
  });

  await shot("06-policies", owner, async (page) => {
    await page.goto("/policy");
    await main(page).getByRole("heading", { level: 1 }).waitFor();
  });

  await shot("07-checkout", owner, async (page) => {
    const visit = await visitToCheckOut();
    if (!visit) throw new Error("no checked-in visit today of $60 or more without a membership or package");
    await page.goto(`/checkout/new?appointment=${visit.appointmentId}&from=/calendar`);
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}$/);
    await waitForReact(page, "#product-search");
    const ticket = page.getByRole("main", { name: "Ticket" });
    await ticket.getByLabel("Add a product: name, brand, SKU or scan").fill(visit.product);
    await ticket.getByRole("list", { name: "Matching products" }).getByRole("button").first().click();
    await ticket.getByRole("button", { name: "Promotion" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("promotion-offer").filter({ hasText: "Retail $10 off $60" }).getByRole("button", { name: "Apply" }).click();
    await dialog.waitFor({ state: "detached" });
    await ticket.getByTestId("applied-promotion").first().waitFor();
  });

  await shot("08-client-account", visitor, async (page) => {
    const client = await accountClient();
    if (!client) throw new Error("no client with an email, a gift card balance and a visit coming up");
    await admin.from("rate_limits").delete().neq("key", "");
    await page.goto(`/book/${SLUG}/account`);
    await waitForReact(page, "form[aria-label='Sign in'] button[type=submit]");
    await page.getByLabel("Email").fill(client.email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await page.getByLabel("6-digit code").waitFor();
    // The code went to the outbox (texts and email aren't connected yet).
    const { data: sent } = await admin.from("outbox_messages").select("body").eq("to_address", client.email.toLowerCase()).order("created_at", { ascending: false }).limit(1).single();
    const code = /code is (\d{6})/.exec(sent?.body ?? "")?.[1];
    if (!code) throw new Error("the sign-in code didn't reach the outbox");
    await page.getByLabel("6-digit code").fill(code);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByTestId("client-account").getByTestId("upcoming-visit").first().waitFor();
  });

  await shot("09-promotions", owner, async (page) => {
    await page.goto("/promotions");
    const list = main(page).getByRole("heading", { name: "Running now" });
    await list.waitFor();
    await list.evaluate((el) => el.closest("section")?.scrollIntoView({ block: "start" }));
  });

  // A new visitor, not the client signed in above.
  await shot("10-specials-booking", await context(browser), async (page) => {
    await page.goto(`/book/${SLUG}`);
    await waitForReact(page, "[data-testid=booking-flow] button[aria-pressed]");
    const flow = page.getByTestId("booking-flow");
    await flow.getByRole("button", { name: /^Women's Cut & Style\s*\d/ }).click();
    await flow.getByRole("button", { name: "Continue" }).click();
    await flow.getByRole("button", { name: /Shae M\./ }).click();
    await flow.getByRole("button", { name: "Continue" }).click();
    await flow.getByTestId("specials-note").waitFor();
    const badge = flow.getByTestId("special-badge").first();
    if (!(await badge.count())) {
      // The first day with times may not be in the special's hours: try the next few.
      const days = flow.getByRole("radiogroup", { name: "Date" }).getByRole("radio", { name: /\d+ times?$/ });
      for (let i = 0; i < Math.min(3, await days.count()) && !(await badge.count()); i++) await days.nth(i).click();
    }
    await badge.waitFor({ timeout: 5_000 });
    await flow.getByRole("radiogroup", { name: "Date" }).scrollIntoViewIfNeeded();
  });

  await shot("11-denise-gaps", owner, async (page) => {
    await page.goto("/promotions");
    await main(page).getByTestId("opening-ideas").waitFor();
    if (!(await main(page).getByTestId("opening-idea").count())) throw new Error("Denise has no ideas for open time (no gap of an hour or more with a regular who fits)");
  });

  // The demo's on-location wedding, a party of 6, in the event builder:
  // the details, party and live total, then the timeline across the artists.
  const rossi = async (page: Page) => {
    const { data } = await admin.from("events").select("id").eq("business_id", BUSINESS).eq("title", "Rossi wedding").single();
    if (!data) throw new Error("no Rossi wedding in the demo data");
    await page.goto(`/events/${data.id}/edit`);
    await waitForReact(page, "[data-task]");
  };

  await shot("12-event-builder", owner, async (page) => {
    await rossi(page);
  });

  await shot("13-event-timeline", owner, async (page) => {
    await rossi(page);
    await main(page).locator("#event-timeline").evaluate((el) => el.closest("section")?.scrollIntoView({ block: "start" }));
  });

  // Rewards at checkout: Linda (planted in the demo seed, 40 points from a
  // free gloss) buying retail, with Denise's line and a reward taken.
  await shot("33-rewards-checkout", front, async (page) => {
    const { data: linda } = await admin.from("clients").select("id").eq("business_id", BUSINESS).eq("first_name", "Linda").eq("last_name", "Park").maybeSingle();
    if (!linda) throw new Error("no Linda Park in the demo seed");
    const { data: product } = await admin.from("products").select("name").eq("business_id", BUSINESS).eq("type", "retail").eq("is_active", true).gte("price_cents", 3000).order("name").limit(1).single();
    await page.goto(`/checkout/new?client=${linda.id}&from=/calendar`);
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}$/);
    await waitForReact(page, "#product-search");
    const ticket = page.getByRole("main", { name: "Ticket" });
    await ticket.getByLabel("Add a product: name, brand, SKU or scan").fill(product!.name);
    await ticket.getByRole("list", { name: "Matching products" }).getByRole("button").first().click();
    await ticket.getByTestId("rewards").getByRole("button", { name: /^\$10 off/ }).click();
    await ticket.getByTestId("applied-reward").waitFor();
  });

  // Marking a stylist out: the stylist with the most clients on the next
  // day with visits, Denise's plan for every client all day, then leaving
  // early at 1pm, with the moves dashed on the calendar (nothing is saved).
  const out = await busiestTomorrow();
  if (!out) throw new Error("no stylist with visits on a day after today");
  await shot("32-mark-out-all-day", front, async (page) => {
    await page.goto(`/calendar?date=${out.date}&out=${out.staffId}`);
    await page.getByTestId("out-row").first().waitFor();
    await page.getByTestId("apply-plan").and(page.locator(":enabled")).waitFor();
  });
  await shot("32b-mark-out-leaving-early", front, async (page) => {
    await page.goto(`/calendar?date=${out.date}&out=${out.staffId}&leaves=13:00`);
    await page.getByTestId("out-row").first().waitFor();
    await page.getByTestId("apply-plan").and(page.locator(":enabled")).waitFor();
  });
}

// The next day after today with visits, and the stylist with the most of
// them that day.
async function busiestTomorrow() {
  for (let ahead = 1; ahead < 8; ahead++) {
    const date = addDays(today, ahead);
    const { data } = await admin
      .from("appointment_items")
      .select("staff_id, appointments!inner(status)")
      .eq("location_id", location!.id)
      .in("appointments.status", ["booked", "confirmed"])
      .gte("starts_at", fromLocal(date, 0, tz)!.toISOString())
      .lt("starts_at", fromLocal(addDays(date, 1), 0, tz)!.toISOString());
    const count = new Map<string, number>();
    for (const i of data ?? []) count.set(i.staff_id, (count.get(i.staff_id) ?? 0) + 1);
    const [best] = [...count].sort((a, b) => b[1] - a[1]);
    if (best) return { staffId: best[0], date };
  }
  return null;
}

// One screenshot: the steps, then a still page. A failure is reported at
// the end rather than stopping the rest.
async function shot(name: string, ctx: BrowserContext, steps: (page: Page) => Promise<{ clip?: Clip; keepMouse?: boolean } | void>) {
  const page = await ctx.newPage();
  try {
    const { clip, keepMouse } = (await steps(page)) ?? {};
    await settle(page, keepMouse);
    await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", caret: "hide", ...(clip ? { clip } : {}) });
    console.log(`  ${name}.png`);
  } catch (error) {
    failed.push([name, error instanceof Error ? error.message.split("\n")[0] : String(error)]);
    console.log(`  ${name}.png: couldn't capture`);
  } finally {
    await page.close();
  }
}

type Clip = { x: number; y: number; width: number; height: number };

async function union(locators: Locator[], pad: number): Promise<Clip> {
  const boxes = (await Promise.all(locators.map((l) => l.first().boundingBox()))).filter((b) => b !== null);
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) + pad - x, height: Math.max(...boxes.map((b) => b.y + b.height)) + pad - y };
}

// Fonts loaded, images in, finite animations done, nothing hovered (unless
// the shot hovers something on purpose).
async function settle(page: Page, keepMouse = false) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  if (!keepMouse) await page.mouse.move(700, 1);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((done) => {
      i.addEventListener("load", done);
      i.addEventListener("error", done);
    })));
    await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})));
  });
  await page.waitForTimeout(500);
}

async function context(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: "light", locale: "en-US", timezoneId: tz });
  await ctx.clock.install({ time: now() });
  await ctx.addInitScript((css) => {
    addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: css })));
  }, HIDE);
  return ctx;
}

async function signedIn(browser: Browser, email: string) {
  const ctx = await context(browser);
  const page = await ctx.newPage();
  await page.goto("/login");
  await waitForReact(page, "input[name=email]");
  await main(page).getByLabel("Email").fill(email);
  await main(page).getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(calendar|my-day)$/);
  await page.close();
  return ctx;
}

// The visible page's main content (Next.js keeps hidden copies of pages
// navigated away from).
function main(page: Page) {
  return page.locator("main").filter({ visible: true });
}

async function waitForReact(page: Page, selector: string) {
  await page.waitForFunction(
    (sel) => [...document.querySelectorAll(sel)].some((el) => el.checkVisibility() && Object.keys(el).some((k) => k.startsWith("__reactProps"))),
    selector,
    { timeout: 30_000, polling: 100 },
  );
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/login`)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`The app didn't start on ${BASE} (see ${DIST}/server.log).`);
}

// The most recent open day (today if it's far enough along), about 40% of
// the way through its opening hours, on the half hour.
function busyMoment(hours: { weekday: number; start_minute: number; end_minute: number }[], timeZone: string, real: Date): Date {
  for (let back = 0, date: LocalDate = todayIn(timeZone, real); back < 14; back++, date = addDays(date, -1)) {
    const open = hours.filter((h) => h.weekday === weekdayOf(date));
    if (!open.length) continue;
    const from = Math.min(...open.map((h) => h.start_minute));
    const to = Math.max(...open.map((h) => h.end_minute));
    const at = fromLocal(date, Math.round((from + (to - from) * 0.4) / 30) * 30, timeZone)!;
    if (at.getTime() <= real.getTime() - 5 * 60_000) return at;
  }
  throw new Error("The salon has no opening hours.");
}

function dayRange() {
  const close = Math.max(...location!.location_hours.filter((h) => h.weekday === weekdayOf(today)).map((h) => h.end_minute));
  return { from: fromLocal(today, 0, tz)!.toISOString(), to: fromLocal(addDays(today, 1), 0, tz)!.toISOString(), close: fromLocal(today, close - 60, tz)!.toISOString() };
}

// A color service in the chair now, with the same stylist's next client
// booked within an hour of its end: running over pushes into them.
async function colorRunningOver() {
  const { from, to } = dayRange();
  const { data } = await admin
    .from("appointment_items")
    .select("id, staff_id, starts_at, ends_at, appointment:appointments!inner(status, client:clients(first_name, last_name)), service:services!inner(category)")
    .eq("business_id", BUSINESS)
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("starts_at");
  const items = (data ?? []) as unknown as {
    id: string;
    staff_id: string;
    starts_at: string;
    ends_at: string;
    appointment: { status: string; client: { first_name: string; last_name: string | null } | null };
    service: { category: string };
  }[];
  const t = now().getTime();
  for (const item of items) {
    if (item.appointment.status !== "checked_in" || item.service.category !== "Color" || !item.appointment.client) continue;
    const end = Date.parse(item.ends_at);
    if (end <= t) continue;
    const next = items.find((n) => n.staff_id === item.staff_id && ["booked", "confirmed"].includes(n.appointment.status) && Date.parse(n.starts_at) >= end - 60_000 && Date.parse(n.starts_at) < end + 3_600_000);
    // Room to push them 20 minutes later: a free 20 minutes after them
    // before the stylist's next client (or the salon's last hour).
    const after = next && items.find((n) => n.staff_id === item.staff_id && n.appointment.status !== "canceled" && Date.parse(n.starts_at) >= Date.parse(next.ends_at));
    const room = next && (after ? Date.parse(after.starts_at) - Date.parse(next.ends_at) >= 20 * 60_000 : Date.parse(next.ends_at) + 20 * 60_000 <= Date.parse(dayRange().close));
    if (next && room) {
      const { data: stylist } = await admin.from("staff").select("first_name").eq("id", item.staff_id).single();
      return { itemId: item.id, staffId: item.staff_id, stylist: stylist!.first_name, client: `${item.appointment.client.first_name} ${item.appointment.client.last_name ?? ""}`.trim() };
    }
  }
  return null;
}

// A checked-in visit today of $60 or more (the retail offer's minimum
// spend), for a client with no membership and no package covering its
// services (either would take over the ticket), and a retail product to add.
async function visitToCheckOut() {
  const { from, to } = dayRange();
  const { data: visits } = await admin
    .from("appointments")
    .select("id, client_id, appointment_items(price_cents, service_id)")
    .eq("business_id", BUSINESS)
    .eq("status", "checked_in")
    .gte("starts_at", from)
    .lt("starts_at", to)
    .not("client_id", "is", null)
    .order("starts_at");
  const [{ data: members }, { data: packages }] = await Promise.all([
    admin.from("client_memberships").select("client_id").eq("business_id", BUSINESS).in("status", ["active", "past_due", "paused"]),
    admin.from("client_package_items").select("service_id, client_package:client_packages!inner(client_id)").eq("business_id", BUSINESS),
  ]);
  const memberIds = new Set((members ?? []).map((m) => m.client_id));
  const covered = new Set((packages ?? []).map((p) => `${(p.client_package as { client_id: string }).client_id}:${p.service_id}`));
  const visit = (visits ?? []).find(
    (v) =>
      !memberIds.has(v.client_id!) &&
      !v.appointment_items.some((i) => covered.has(`${v.client_id}:${i.service_id}`)) &&
      v.appointment_items.reduce((s, i) => s + i.price_cents, 0) >= 6000,
  );
  const { data: product } = await admin.from("products").select("name").eq("business_id", BUSINESS).eq("type", "retail").gte("price_cents", 2400).order("price_cents").limit(1).single();
  return visit && product ? { appointmentId: visit.id, product: product.name } : null;
}

// A client with an email, money left on a gift card they bought, and the
// most visits coming up.
async function accountClient() {
  const { data: cards } = await admin
    .from("gift_cards")
    .select("client_id, expires_at, client:clients!inner(email)")
    .eq("business_id", BUSINESS)
    .eq("kind", "purchased")
    .eq("status", "active")
    .gt("balance_cents", 0)
    .not("client.email", "is", null);
  let best: { email: string; upcoming: number } | null = null;
  for (const card of cards ?? []) {
    if (card.expires_at && Date.parse(card.expires_at) < now().getTime()) continue;
    const { count } = await admin.from("appointments").select("id", { count: "exact", head: true }).eq("client_id", card.client_id!).in("status", ["booked", "confirmed"]).gt("starts_at", now().toISOString());
    if (count && (!best || count > best.upcoming)) best = { email: (card.client as { email: string }).email, upcoming: count };
  }
  return best;
}

function hhmm(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
