import type { Page } from "@playwright/test";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, makeRoom, SEED } from "../tests/db/helpers";
import { expect, test, waitForHydration } from "./fixtures";

// A client's own account on the booking site, on a phone: sign in with a
// code or a link (no password), see their visits and balances, change a
// visit (the policy first), book again without a code, and sign out.

const SLUG = "maple-and-ash";
const B = SEED.business;
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
test.use({ ...phone, storageState: { cookies: [], origins: [] } });
// One client's email, and its sign-in limit, shared by every test here.
test.describe.configure({ mode: "serial" });

let client: { id: string; first_name: string; email: string };

// Its own client: an email, a past visit that can be booked again straight
// online (no consultation first), so "Book again" skips the services, and a
// visit coming up.
const PREFIX = `Ca${Date.now().toString(36).replace(/\d/g, (d) => "abcdefghij"[Number(d)])}`;
const TZ = "America/Chicago";
const undo: (() => Promise<void>)[] = [];

test.beforeAll(async () => {
  const check = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
    if (r.error) throw r.error;
    return r.data as NonNullable<T>;
  };
  const email = `${PREFIX.toLowerCase()}@example.test`;
  client = check(await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Lou`, last_name: "Test", email }).select("id, first_name, email").single()) as typeof client;
  const service = check(await admin.from("services").select("id, active_minutes, price_cents").eq("business_id", B).eq("name", "Blowout").eq("online_booking", "bookable").single());
  const monday = startOfWeek(todayIn(TZ));
  // Twenty weeks back (before the demo history) and nine weeks ahead, both Tuesdays at 10am.
  for (const [date, status] of [[addDays(monday, -7 * 20 + 1), "completed"], [addDays(monday, 7 * 9 + 1), "booked"]] as const) {
    const start = fromLocal(date, 10 * 60, TZ)!;
    const end = new Date(start.getTime() + service.active_minutes * 60_000);
    undo.push(await makeRoom(SEED.staff.bridget, start, end));
    const visit = check(await admin.from("appointments").insert({ business_id: B, location_id: SEED.location, client_id: client.id, starts_at: start.toISOString(), ends_at: end.toISOString(), status }).select("id").single());
    check(await admin.from("appointment_items").insert({ business_id: B, location_id: SEED.location, appointment_id: visit.id, service_id: service.id, staff_id: SEED.staff.bridget, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: service.active_minutes, price_cents: service.price_cents }));
  }
});

test.beforeEach(async () => {
  await admin.from("rate_limits").delete().neq("key", "");
});

test.afterAll(async () => {
  await admin.from("client_accounts").delete().eq("client_id", client.id);
  await admin.from("appointments").delete().eq("client_id", client.id);
  for (const putBack of undo) await putBack();
  await admin.from("clients").delete().eq("id", client.id);
});

async function newestTo(page: Page, to: string): Promise<string> {
  const outbox = await page.context().newPage();
  await outbox.goto(`/dev/outbox?to=${encodeURIComponent(to)}`);
  const body = await outbox
    .getByTestId("outbox-message")
    .filter({ has: outbox.getByTestId("outbox-to").getByText(to, { exact: true }) })
    .first()
    .getByTestId("outbox-body")
    .innerText();
  await outbox.close();
  return body;
}

async function askForCode(page: Page) {
  await page.goto(`/book/${SLUG}/account`);
  await waitForHydration(page, "form[aria-label='Sign in'] button[type=submit]");
  await page.getByLabel("Email").fill(client.email);
  await page.getByRole("button", { name: "Send my code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  return newestTo(page, client.email.toLowerCase());
}

test("signs in with a code, sees their visits, changes one with the policy first, and signs out", async ({ page }) => {
  const message = await askForCode(page);
  expect(message).toMatch(/your sign-in code is \d{6}, or tap http/);
  await page.getByLabel("6-digit code").fill(/code is (\d{6})/.exec(message)![1]);
  await page.getByRole("button", { name: "Sign in" }).click();

  const account = page.getByTestId("client-account");
  await expect(account.getByRole("heading", { name: `Hi, ${client.first_name}` })).toBeVisible();
  await expect(account.getByTestId("upcoming-visit").first()).toBeVisible();
  await expect(account.getByRole("link", { name: /^Book (again|a visit)/ })).toBeVisible();
  // Their rewards: points from their visits, and a link to share.
  const points = (await admin.from("reward_points").select("delta").eq("client_id", client.id)).data!.reduce((n, r) => n + r.delta, 0);
  await expect(account.getByTestId("account-rewards")).toContainText(`${points.toLocaleString("en-US")} points`);
  await expect(account.getByTestId("account-rewards").getByRole("button", { name: "Copy my referral link" })).toBeVisible();

  // The booking site knows them now.
  await page.goto(`/book/${SLUG}`);
  await expect(page.getByRole("link", { name: `${client.first_name}'s account` })).toBeVisible();

  // Change or cancel: their visit's own page, with the policy before anything changes.
  await page.goto(`/book/${SLUG}/account`);
  await waitForHydration(page, "[data-testid=upcoming-visit] button");
  await account.getByTestId("upcoming-visit").first().getByRole("button", { name: "Change or cancel" }).click();
  await expect(page).toHaveURL(new RegExp(`/book/${SLUG}/manage/[A-Za-z0-9_-]{43}$`));
  await expect(page.getByText(/cancel/i).first()).toBeVisible();

  await page.goto(`/book/${SLUG}/account`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("form", { name: "Sign in" })).toBeVisible();
});

test("signs in with the link, which works once", async ({ page, browser }) => {
  const message = await askForCode(page);
  const link = /tap (http\S+) to sign in/.exec(message)![1];
  await page.goto(link);
  await expect(page.getByTestId("client-account").getByRole("heading", { name: `Hi, ${client.first_name}` })).toBeVisible();

  // Someone else with the same link gets nowhere.
  const stranger = await browser.newPage({ ...phone, storageState: { cookies: [], origins: [] } });
  await stranger.goto(link);
  await expect(stranger).toHaveURL(new RegExp(`/book/${SLUG}/account\\?link=expired$`));
  await expect(stranger.getByRole("main").getByRole("alert")).toContainText("expired or was already used");
  await stranger.close();
});

test("books again without a code, starting from their last visit", async ({ page }) => {
  const message = await askForCode(page);
  await page.getByLabel("6-digit code").fill(/code is (\d{6})/.exec(message)![1]);
  await page.getByRole("button", { name: "Sign in" }).click();
  const again = page.getByTestId("client-account").getByRole("link", { name: /^Book again: / });
  await again.click();
  const flow = page.getByTestId("booking-flow");
  // Straight past the services (and the stylist, when it was one).
  await expect(flow.getByRole("heading", { name: /Pick a date and time|Choose your stylist/ })).toBeVisible();
  await expect(flow.getByRole("button", { name: "Send code" })).toHaveCount(0);
});

test("asks for a new code after too many sign-in tries", async ({ page }) => {
  await page.goto(`/book/${SLUG}/account`);
  await waitForHydration(page, "form[aria-label='Sign in'] button[type=submit]");
  // Five codes an hour to one email; the next is refused.
  const refused = page.getByRole("main").getByRole("alert");
  for (let i = 0; i < 7 && !(await refused.isVisible()); i++) {
    await page.getByLabel("Email").fill(client.email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await expect(page.getByLabel("6-digit code").or(refused)).toBeVisible();
    if (await page.getByLabel("6-digit code").isVisible()) await page.getByRole("button", { name: "Use a different email or number" }).click();
  }
  await expect(refused).toHaveText("Too many sign-in tries. Please wait a while, or call the salon.");
});
