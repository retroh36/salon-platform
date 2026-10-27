import type { Browser, Page } from "@playwright/test";
import { admin, SEED } from "../tests/db/helpers";
import { allowNotFoundLogs, allowOfflineLogs, AUTH, expect, putBackSales, test, visitTab, waitForHydration } from "./fixtures";

// Stock and sales this file uses are put back afterwards.
putBackSales();

// The public booking site, on a phone. Signed out, like a client.
const SLUG = "maple-and-ash";
const B = SEED.business;
const RUN = Date.now().toString(36);
// Made-up numbers in the 555-01xx range, in an area code the seed doesn't use.
const newPhone = () => `(4${String(Math.floor(Math.random() * 90) + 10)}) 555-01${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
const created: string[] = [];
const STARTED = new Date().toISOString();

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
test.use({ ...phone, storageState: { cookies: [], origins: [] } });

// Tests come from one address, faster than any client would.
test.beforeEach(async () => {
  await admin.from("rate_limits").delete().neq("key", "");
});

// Everyone this run added (named Ob<run>…), even if a test stopped early.
test.afterAll(async () => {
  const { data } = await admin.from("clients").select("id").eq("business_id", B).like("first_name", `Ob${RUN}%`);
  const ids = [...new Set([...created, ...(data ?? []).map((c) => c.id)])];
  if (ids.length) {
    await admin.from("appointments").delete().eq("business_id", B).in("client_id", ids);
    await admin.from("clients").delete().in("id", ids);
  }
  await admin.from("appointments").delete().eq("business_id", B).eq("source", "online").like("notes", `%${RUN}%`);
  // Online visits booked for seeded clients during this file.
  await admin.from("appointments").delete().eq("business_id", B).eq("source", "online").gte("created_at", STARTED);
});

const flow = (page: Page) => page.getByTestId("booking-flow");
const cont = (page: Page) => flow(page).getByRole("button", { name: "Continue" });

async function open(page: Page, query = "") {
  await page.goto(`/book/${SLUG}${query}`);
  await waitForHydration(page, "[data-testid=booking-flow] button[aria-pressed]");
}

async function chooseServices(page: Page, names: string[]) {
  // The name is followed by the duration ("45 min", "1 hr").
  for (const name of names) await flow(page).getByRole("button", { name: new RegExp(`^${name.replace(/[()&/]/g, ".")}\\s*\\d`) }).click();
  await cont(page).click();
}

async function chooseStylist(page: Page, name: RegExp | "No preference") {
  await flow(page).getByRole("button", { name: name === "No preference" ? /^No preference/ : name }).click();
  await cont(page).click();
}

// The first day with times (at least `daysAhead` from today), and its
// first time (or the index-th).
async function chooseFirstTime(page: Page, index = 0, daysAhead = 0) {
  const dates = flow(page).getByRole("radiogroup", { name: "Date" });
  await expect(dates.getByRole("radio").first()).toBeVisible();
  if (daysAhead) {
    const labels = await dates.getByRole("radio").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
    const n = labels.findIndex((l, i) => i >= daysAhead && !l.endsWith("no times"));
    await dates.getByRole("radio").nth(n).click();
  }
  const label = await flow(page).getByRole("radio", { checked: true }).first().getAttribute("aria-label");
  const time = flow(page).getByRole("radiogroup", { name: /Morning|Afternoon|Evening/ }).getByRole("radio").nth(index);
  const text = (await time.innerText()).split("\n")[0];
  await time.click();
  await cont(page).click();
  return { day: label!.split(",").slice(0, 2).join(","), time: text };
}

// "Thursday, October 22" -> "2026-10-22" (this year, or next if it's passed).
function isoDate(label: string): string {
  const now = new Date();
  let date = new Date(`${label}, ${now.getFullYear()} 12:00`);
  if (date.getTime() < now.getTime() - 86_400_000 * 2) date = new Date(`${label}, ${now.getFullYear() + 1} 12:00`);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Reads the newest code sent to a number from the dev outbox page.
async function codeFor(page: Page, to: string): Promise<string> {
  const digits = to.replace(/\D/g, "");
  const outbox = await page.context().newPage();
  await outbox.goto(`/dev/outbox?to=${digits}`);
  const message = outbox.getByTestId("outbox-message").filter({ has: outbox.getByTestId("outbox-to").getByText(digits, { exact: true }) }).first();
  const body = await message.getByTestId("outbox-body").innerText();
  await outbox.close();
  const code = /code is (\d{6})/.exec(body)?.[1];
  if (!code) throw new Error(`No code in the newest message to ${digits}: ${body}`);
  return code;
}

async function verify(page: Page, phoneNumber: string) {
  await flow(page).getByLabel("Mobile number").fill(phoneNumber);
  await flow(page).getByRole("button", { name: "Send code" }).click();
  await expect(flow(page).getByLabel("Code", { exact: true })).toBeVisible();
  await flow(page).getByLabel("Code", { exact: true }).fill(await codeFor(page, phoneNumber));
  await flow(page).getByRole("button", { name: "Confirm" }).click();
}

// Agrees to the policy (and, for a new client, to their card being saved:
// the salon asks new clients for one) and books.
async function bookIt(page: Page) {
  await flow(page).getByLabel(/^I agree to the cancellation policy/).check();
  await flow(page).getByRole("button", { name: /^Book appointment$|deposit and book$/ }).click();
}

test("a new client books two services back to back on a phone", async ({ page }) => {
  await open(page);
  // The salon's brand leads; Maestra is small at the foot.
  await expect(page.getByRole("banner")).toContainText("Maple & Ash Hair Studio");
  await expect(page.getByTestId("powered-by")).toHaveText("Powered by Maestra");
  await expect(page.getByText("Bang Trim")).toHaveCount(0); // not online
  // Level-based price ranges.
  await expect(flow(page).getByRole("button", { name: /^Women's Cut & Style/ })).toContainText("$70–$100");

  await chooseServices(page, ["Women's Cut & Style", "Blowout"]);
  await expect(flow(page).getByRole("heading", { name: "Choose your stylist" })).toBeFocused();
  // Each stylist with their level and price for both.
  const shae = flow(page).getByRole("button", { name: /Shae M\./ });
  await expect(shae).toContainText("Artisan stylist");
  await expect(shae).toContainText("$115"); // $70 + $45
  await expect(flow(page).getByRole("button", { name: /Bridget C\./ })).toContainText("Master stylist");
  await chooseStylist(page, /Shae M\./);

  // Big tap targets.
  expect((await cont(page).boundingBox())!.height).toBeGreaterThanOrEqual(48);
  const { day, time } = await chooseFirstTime(page);

  const number = newPhone();
  await verify(page, number);
  await flow(page).getByLabel("First name").fill(`Ob${RUN}New`);
  await flow(page).getByLabel("Last name").fill("Client");
  await flow(page).getByLabel("Email").fill(`ob-${RUN}@example.com`);
  await flow(page).getByLabel("Anything we should know?").fill(`Fine hair ${RUN}`);
  await cont(page).click();

  await expect(flow(page)).toContainText("with Shae");
  await expect(flow(page)).toContainText("$115");
  await expect(flow(page)).toContainText("Cancellation policy");
  await expect(flow(page).getByRole("button", { name: "Book appointment" })).toBeDisabled();

  // The front desk has that day open on the calendar while the client books.
  const desk = await page.context().browser()!.newContext({ storageState: AUTH.frontDesk, viewport: { width: 1440, height: 1000 } });
  const calendar = await desk.newPage();
  await calendar.clock.install();
  await calendar.goto(`/calendar?date=${isoDate(day)}`);
  await waitForHydration(calendar, "section[data-staff-id]");
  const shaeColumn = calendar.getByRole("region", { name: "Shae Morgan", exact: true });
  await expect(shaeColumn.getByRole("button", { name: new RegExp(`Ob${RUN}New`) })).toHaveCount(0);

  // Booking creates their account, so next time there's no code.
  await flow(page).getByLabel(/^Keep me signed in on this device/).check();
  await bookIt(page);

  await expect(page).toHaveURL(/\/book\/maple-and-ash\/manage\/[A-Za-z0-9_-]{43}\?booked=1$/);
  await expect(page.getByRole("heading", { name: `You’re booked, Ob${RUN}New` })).toBeVisible();
  await expect(page.getByTestId("manage-booking")).toContainText(time);

  // Saved as an online booking for a new client, back to back, and logged.
  const { data: client } = await admin.from("clients").select("id, phone, email").eq("business_id", B).eq("first_name", `Ob${RUN}New`).single();
  created.push(client!.id);
  expect(client).toMatchObject({ phone: number, email: `ob-${RUN}@example.com` });
  const { data: visit } = await admin
    .from("appointments")
    .select("id, source, created_by, notes, appointment_items(starts_at, ends_at, staff_id, service:services(name))")
    .eq("client_id", client!.id)
    .single();
  expect(visit).toMatchObject({ source: "online", created_by: null });
  expect(visit!.notes).toContain(`Fine hair ${RUN}`);
  const items = [...visit!.appointment_items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  expect(items.map((i) => i.service.name)).toEqual(["Women's Cut & Style", "Blowout"]);
  expect(new Date(items[1].starts_at).getTime()).toBe(new Date(items[0].ends_at).getTime());
  expect(items.every((i) => i.staff_id === SEED.staff.shae)).toBe(true);
  const { data: log } = await admin.from("online_booking_log").select("action, ip_hash").eq("appointment_id", visit!.id);
  expect(log).toEqual([{ action: "booked", ip_hash: expect.stringMatching(/^[0-9a-f]{32}$/) }]);
  const { data: account } = await admin.from("client_accounts").select("verified_channel").eq("client_id", client!.id).single();
  expect(account).toEqual({ verified_channel: "sms" });

  // The open calendar picks it up by itself, marked as booked online.
  await calendar.clock.fastForward(21_000);
  const booked = shaeColumn.getByRole("button", { name: new RegExp(`Ob${RUN}New`) }).first();
  await expect(booked).toBeVisible();
  await expect(booked).toHaveAccessibleName(/booked online/);
  // In its details, not on the block.
  await expect(booked.getByTestId("online-badge")).toHaveCount(0);
  await booked.click();
  // How it was booked is in its history.
  await visitTab(calendar.getByRole("tabpanel", { name: "Booking details" }), "History");
  await expect(calendar.getByRole("tabpanel", { name: "Booking details" }).getByTestId("online-badge")).toBeVisible();
  await desk.close();
});

test("a returning client confirms with a code and is matched to their profile (and where they came from is kept)", async ({ page }) => {
  // A seeded client (their ids start e0000000-) with a phone number.
  const { data: client } = await admin.from("clients").select("id, first_name, phone").eq("business_id", B).not("phone", "is", null).gte("id", "e0000000-0000-4000-8000-000000000000").lte("id", "e0000000-ffff-4fff-bfff-ffffffffffff").order("id").limit(1).single();
  // From the salon's Google listing.
  await open(page, "?src=google");
  await chooseServices(page, ["Men's Cut"]);
  await chooseStylist(page, "No preference");
  await chooseFirstTime(page);
  await verify(page, client!.phone!);
  await expect(flow(page).getByTestId("welcome-back")).toContainText(`Welcome back, ${client!.first_name}`);
  // No name or contact fields: the profile is already on file.
  await expect(flow(page).getByLabel("First name")).toHaveCount(0);
  await cont(page).click();
  await bookIt(page);
  await expect(page.getByRole("heading", { name: /You’re booked/ })).toBeVisible();

  const { data: visits } = await admin.from("appointments").select("id, online_source").eq("client_id", client!.id).eq("source", "online").gte("created_at", new Date(Date.now() - 60_000).toISOString());
  expect(visits).toEqual([{ id: expect.any(String), online_source: "google" }]);
});

test("two people can't book the same time: the second is told and picks again", async ({ browser }) => {
  const visitor = async (b: Browser) => {
    const context = await b.newContext({ ...phone, storageState: { cookies: [], origins: [] } });
    return context.newPage();
  };
  const [first, second] = await Promise.all([visitor(browser), visitor(browser)]);
  const numbers = [newPhone(), newPhone()];
  const picked: { day: string; time: string }[] = [];
  for (const [i, p] of [first, second].entries()) {
    await open(p);
    await chooseServices(p, ["Men's Cut"]);
    await chooseStylist(p, /Nola B\./);
    picked.push(await chooseFirstTime(p));
    await verify(p, numbers[i]);
    await flow(p).getByLabel("First name").fill(`Ob${RUN}Race${i}`);
    await flow(p).getByLabel("Email").fill(`ob-race${i}-${RUN}@example.com`);
    await cont(p).click();
    await flow(p).getByLabel(/^I agree to the cancellation policy/).check();
  }
  expect(picked[0]).toEqual(picked[1]);

  await first.getByRole("button", { name: /^Book appointment$/ }).click();
  await expect(first.getByRole("heading", { name: /You’re booked/ })).toBeVisible();
  await second.getByRole("button", { name: /^Book appointment$/ }).click();
  await expect(flow(second).getByRole("alert")).toHaveText("Sorry, that time was just taken. Please pick another.");
  await expect(flow(second).getByRole("heading", { name: "Pick a date and time" })).toBeVisible();
  // The time is no longer offered.
  await expect(flow(second).getByRole("radiogroup", { name: /Morning|Afternoon|Evening/ }).first()).toBeVisible();
  await expect(flow(second).getByRole("radiogroup", { name: /Morning|Afternoon|Evening/ }).getByRole("radio", { name: new RegExp(`^${picked[0].time}(,|$)`) })).toHaveCount(0);

  const { data: clients } = await admin.from("clients").select("id").eq("business_id", B).like("first_name", `Ob${RUN}Race%`);
  created.push(...clients!.map((c) => c.id));
  const { data: visits } = await admin.from("appointments").select("id").in("client_id", clients!.map((c) => c.id));
  expect(visits).toHaveLength(1);
  await Promise.all([first.context().close(), second.context().close()]);
});

test("the connection drops as they book: it says so, and tapping Book again shows the booking, made once", async ({ page, pageErrors }) => {
  await open(page);
  await chooseServices(page, ["Blowout"]);
  await chooseStylist(page, /Shae M\./);
  // The first time she has (the soonest day may have only one or two left).
  await chooseFirstTime(page);
  await verify(page, newPhone());
  await flow(page).getByLabel("First name").fill(`Ob${RUN}Retry`);
  await flow(page).getByLabel("Last name").fill("Client");
  await flow(page).getByLabel("Email").fill(`ob-retry-${RUN}@example.com`);
  await cont(page).click();

  // The salon books it, but the answer never gets back.
  let dropped = false;
  await page.route(`**/book/${SLUG}**`, async (route) => {
    if (route.request().method() !== "POST" || dropped || !(route.request().postData() ?? "").includes('"attempt"')) return route.continue();
    dropped = true;
    await route.fetch();
    await route.abort("internetdisconnected");
  });
  await bookIt(page);
  await expect(flow(page).getByRole("alert")).toContainText("We couldn't reach the salon. Check your connection and tap Book again: you won't be booked twice.");
  await flow(page).getByRole("button", { name: /^Book appointment$|deposit and book$/ }).click();
  await expect(page).toHaveURL(/\/book\/maple-and-ash\/manage\/[A-Za-z0-9_-]{43}\?booked=1$/);
  await expect(page.getByRole("heading", { name: `You’re booked, Ob${RUN}Retry` })).toBeVisible();

  const { data: client } = await admin.from("clients").select("id").eq("business_id", B).eq("first_name", `Ob${RUN}Retry`).single();
  created.push(client!.id);
  const { data: visits } = await admin.from("appointments").select("id").eq("client_id", client!.id);
  expect(visits).toHaveLength(1);
  const { data: log } = await admin.from("online_booking_log").select("action").eq("client_id", client!.id);
  expect(log).toEqual([{ action: "booked" }]);
  // The dropped request is the browser's one complaint.
  allowOfflineLogs(pageErrors);
});

test("a client reschedules, then cancels, with their private link", async ({ page }) => {
  await open(page);
  await chooseServices(page, ["Kids' Cut (12 & under)"]);
  await chooseStylist(page, /Nola B\./);
  // Far enough ahead to change online (the salon's cutoff is 24 hours).
  await chooseFirstTime(page, 0, 3);
  const number = newPhone();
  await verify(page, number);
  await flow(page).getByLabel("First name").fill(`Ob${RUN}Mover`);
  await flow(page).getByLabel("Email").fill(`ob-mover-${RUN}@example.com`);
  await cont(page).click();
  await bookIt(page);
  await expect(page.getByRole("heading", { name: /You’re booked/ })).toBeVisible();
  const { data: client } = await admin.from("clients").select("id").eq("business_id", B).eq("first_name", `Ob${RUN}Mover`).single();
  created.push(client!.id);
  const before = (await admin.from("appointments").select("starts_at").eq("client_id", client!.id).single()).data!.starts_at;

  // The confirmation went to the client with the link.
  const outbox = await page.context().newPage();
  await outbox.goto("/dev/outbox");
  await expect(outbox.getByTestId("outbox-message").first()).toContainText("you're booked for");
  await outbox.close();

  await page.getByRole("button", { name: "Reschedule" }).click();
  const move = page.getByRole("region", { name: "Reschedule" });
  // A later day, still outside the 24-hour cutoff so it can be canceled online.
  const days = move.getByRole("radiogroup", { name: "Date" }).getByRole("radio");
  await expect(days.first()).toBeVisible();
  const labels = await days.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  await days.nth(labels.findIndex((l, i) => i >= 5 && Number(/(\d+) times?$/.exec(l)?.[1] ?? 0) >= 3)).click();
  await move.getByRole("radiogroup", { name: /Morning|Afternoon|Evening/ }).getByRole("radio").nth(2).click();
  await move.getByRole("button", { name: "Move my booking" }).click();
  await expect(page.getByRole("status")).toContainText("Moved to");
  const after = (await admin.from("appointments").select("starts_at, status").eq("client_id", client!.id).single()).data!;
  expect(after.starts_at).not.toBe(before);

  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByRole("heading", { name: "Booking canceled" })).toBeVisible();
  const done = (await admin.from("appointments").select("id, status, cancel_reason").eq("client_id", client!.id).single()).data!;
  expect(done).toMatchObject({ status: "canceled", cancel_reason: "Canceled online by the client" });
  const { data: log } = await admin.from("online_booking_log").select("action").eq("appointment_id", done.id).order("created_at");
  expect(log!.map((l) => l.action)).toEqual(["booked", "rescheduled", "canceled"]);
});

test("color needs a patch test on file: a new client is told how to get one", async ({ page }) => {
  await open(page);
  await expect(flow(page).getByRole("button", { name: /^Root Touch-Up/ })).toContainText("Needs a patch test on file");
  await chooseServices(page, ["Root Touch-Up"]);
  await chooseStylist(page, "No preference");
  await chooseFirstTime(page);
  await verify(page, newPhone());
  await flow(page).getByLabel("First name").fill(`Ob${RUN}Color`);
  await flow(page).getByLabel("Email").fill(`ob-color-${RUN}@example.com`);
  await cont(page).click();
  await bookIt(page);
  await expect(flow(page).getByRole("alert")).toContainText("need a patch test at least 48 hours before your visit");
  await expect(flow(page).getByRole("alert")).toContainText("(555) 010-0100");
  await expect(flow(page).getByRole("heading", { name: "Choose your services" })).toBeVisible();
  const { data } = await admin.from("clients").select("id").eq("business_id", B).eq("first_name", `Ob${RUN}Color`);
  created.push(...data!.map((c) => c.id));
  expect((await admin.from("appointments").select("id").in("client_id", data!.map((c) => c.id))).data).toEqual([]);
});

test("services that need a consultation offer one instead, with deposits shown", async ({ page }) => {
  await open(page);
  const correction = flow(page).getByRole("listitem").filter({ hasText: "Color Correction" });
  await expect(correction.getByRole("button", { name: /^Color Correction/ })).toHaveCount(0);
  await correction.getByRole("button", { name: "Request a consultation" }).click();
  await expect(flow(page).getByRole("button", { name: /^Color Consultation/ })).toHaveAttribute("aria-pressed", "true");
  await expect(flow(page).getByRole("button", { name: /^Balayage/ })).toContainText("25% deposit");
});

test("a new client reads the policy, agrees, saves a card and pays the deposit before it's booked", async ({ page }) => {
  await open(page);
  await chooseServices(page, ["Bridal Trial"]);
  await chooseStylist(page, "No preference");
  await chooseFirstTime(page, 0, 3);
  await verify(page, newPhone());
  await flow(page).getByLabel("First name").fill(`Ob${RUN}Bride`);
  await flow(page).getByLabel("Email").fill(`ob-bride-${RUN}@example.com`);
  await cont(page).click();

  // The policy in plain language, with this visit's amounts.
  const policy = flow(page).getByTestId("policy");
  await expect(policy).toContainText("at least 2 days' notice");
  await expect(policy).toContainText("Canceling with less notice costs $40.");
  await expect(policy).toContainText(/Not showing up costs 50% of the visit \(\$\d+\)\./);
  await expect(flow(page).getByTestId("deposit")).toContainText("$50");
  await expect(flow(page).getByRole("heading", { name: "Card to hold your booking" })).toBeVisible();
  const book = flow(page).getByRole("button", { name: "Pay $50 deposit and book" });
  await expect(book).toBeDisabled();

  // A declined card: nothing booked, nothing charged.
  await flow(page).getByLabel(/^Card \(test mode/).selectOption("test_visa_0002");
  await flow(page).getByLabel("I agree to the cancellation policy and to my card being saved for it").check();
  await book.click();
  await expect(flow(page).getByRole("alert")).toContainText("The card was declined. You haven't been charged; try another card.");
  const { data: client } = await admin.from("clients").select("id").eq("business_id", B).eq("first_name", `Ob${RUN}Bride`).single();
  created.push(client!.id);
  expect((await admin.from("appointments").select("id").eq("client_id", client!.id)).data).toEqual([]);

  await flow(page).getByLabel(/^Card \(test mode/).selectOption("test_visa_4242");
  await flow(page).getByRole("button", { name: "Pay $50 deposit and book" }).click();
  await expect(page.getByRole("heading", { name: /You’re booked/ })).toBeVisible();

  // The card, what they agreed to and the deposit are all recorded.
  const visit = (await admin.from("appointments").select("deposit_paid_cents, deposit_reference").eq("client_id", client!.id).single()).data!;
  expect(visit.deposit_paid_cents).toBe(5000);
  expect(visit.deposit_reference).toBeTruthy();
  const card = (await admin.from("client_cards").select("label, consent:policy_consents(policy_text, channel)").eq("client_id", client!.id).single()).data!;
  expect(card.label).toBe("Visa …4242");
  expect(card.consent).toMatchObject({ channel: "online" });
  expect(card.consent.policy_text).toContain("Canceling with less notice costs $40.");
  // The confirmation includes the policy.
  const outbox = await page.context().newPage();
  await outbox.goto("/dev/outbox");
  await expect(outbox.getByTestId("outbox-message").filter({ hasText: "you're booked for" }).first()).toContainText("Canceling with less notice costs $40.");
  await outbox.close();
});

test("a bad manage link or salon shows nothing", async ({ page, pageErrors }) => {
  await page.goto(`/book/${SLUG}/manage/${"x".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  await expect(page.getByTestId("manage-booking")).toHaveCount(0);
  // A client is pointed back to the salon's booking page, never the Dashboard.
  await expect(page.getByRole("link", { name: "Go to the Dashboard" })).toHaveCount(0);
  await page.getByRole("link", { name: "Go to the booking page" }).click();
  await expect(page).toHaveURL(new RegExp(`/book/${SLUG}$`));
  await page.goto("/book/no-such-salon");
  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  await expect(page.getByRole("link")).toHaveCount(0);
  allowNotFoundLogs(pageErrors);
});
