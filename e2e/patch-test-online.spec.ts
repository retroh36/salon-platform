import type { Page } from "@playwright/test";
import { admin, SEED } from "../tests/db/helpers";
import { expect, test, waitForHydration } from "./fixtures";

// Color that needs a patch test, on the booking site: the service says so
// before anything is chosen, the client is asked at the service step, and a
// client without one books the patch test first (at the salon's Color
// Consultation), then the color 48+ hours after it. Nobody goes through the
// stylist, time and details only to be stopped at the end.

const B = SEED.business;
const SLUG = "maple-and-ash";
const RUN = Date.now().toString(36);
const newPhone = () => `(4${String(Math.floor(Math.random() * 90) + 10)}) 555-01${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: { cookies: [], origins: [] } });

const flow = (page: Page) => page.getByTestId("booking-flow");
const cont = (page: Page) => flow(page).getByRole("button", { name: "Continue" });

test.beforeEach(async () => {
  await admin.from("rate_limits").delete().neq("key", "");
});

test.afterAll(async () => {
  const { data } = await admin.from("clients").select("id").eq("business_id", B).like("first_name", `Pt${RUN}%`);
  const ids = (data ?? []).map((c) => c.id);
  if (ids.length) {
    await admin.from("appointments").delete().in("client_id", ids);
    await admin.from("clients").delete().in("id", ids);
  }
});

async function confirmPhone(page: Page, number: string) {
  await flow(page).getByLabel("Mobile number").fill(number);
  await flow(page).getByRole("button", { name: "Send code" }).click();
  await expect(flow(page).getByLabel("Code", { exact: true })).toBeVisible();
  const outbox = await page.context().newPage();
  await outbox.goto(`/dev/outbox?to=${number.replace(/\D/g, "")}`);
  const code = /code is (\d{6})/.exec(await outbox.getByTestId("outbox-body").first().innerText())![1];
  await outbox.close();
  await flow(page).getByLabel("Code", { exact: true }).fill(code);
  await flow(page).getByRole("button", { name: "Confirm" }).click();
}

async function firstTime(page: Page) {
  await flow(page).getByRole("radiogroup", { name: "Date" }).getByRole("radio", { name: /\d+ times?$/ }).first().click();
  await flow(page).locator("[role=radiogroup]:not([aria-label=Date]) [role=radio]").first().click();
  await cont(page).click();
}

async function chooseRootTouchUp(page: Page) {
  await page.goto(`/book/${SLUG}`);
  await waitForHydration(page, "[data-testid=booking-flow] button[aria-pressed]");
  const card = flow(page).getByRole("button", { name: /^Root Touch-Up/ });
  await expect(card.getByTestId("patch-note")).toHaveText("New clients need a patch test 48 hours before color.");
  await card.click();
}

test("a client with no patch test books one first, then the color 48 hours after it", async ({ page }) => {
  await chooseRootTouchUp(page);
  const ask = flow(page).getByRole("group", { name: "Patch test" });
  await expect(ask).toContainText("Have you had a patch test with us in the last 6 months?");
  await expect(cont(page)).toBeDisabled();
  await ask.getByRole("button", { name: "No, not yet" }).click();
  await ask.getByRole("button", { name: "Book a patch test first" }).click();
  // The patch test is done at the salon's Color Consultation.
  await expect(flow(page).getByRole("button", { name: /^Color Consultation/ })).toHaveAttribute("aria-pressed", "true");
  await expect(flow(page).getByRole("button", { name: /^Root Touch-Up/ })).toHaveAttribute("aria-pressed", "false");
  await cont(page).click();
  await flow(page).getByRole("button", { name: /^No preference/ }).click();
  await cont(page).click();
  await firstTime(page);
  const number = newPhone();
  await confirmPhone(page, number);
  await flow(page).getByLabel("First name").fill(`Pt${RUN}New`);
  await flow(page).getByLabel("Last name").fill("Client");
  await flow(page).getByLabel("Email").fill(`pt-${RUN}@example.com`);
  await cont(page).click();
  await flow(page).getByLabel(/^I agree to the cancellation policy/).check();
  await flow(page).getByRole("button", { name: /^Book appointment$|deposit and book$/ }).click();
  await expect(page.getByRole("heading", { name: /You’re booked/ })).toBeVisible();

  // The confirmation leads on to the color, 48 hours or more after the patch test.
  const next = page.getByTestId("book-color-next");
  await expect(next).toContainText("Root Touch-Up");
  const { data: patch } = await admin.from("appointments").select("starts_at, client:clients!inner(first_name)").eq("client.first_name", `Pt${RUN}New`).single();
  await next.getByRole("link", { name: /Book your Root Touch-Up/ }).click();
  await waitForHydration(page, "[data-testid=booking-flow] button");
  await flow(page).getByRole("button", { name: /^No preference/ }).click();
  await cont(page).click();
  const firstDay = await flow(page).getByRole("radiogroup", { name: "Date" }).getByRole("radio").first().getAttribute("data-date");
  expect(new Date(`${firstDay}T23:59:59Z`).getTime()).toBeGreaterThanOrEqual(new Date(patch!.starts_at).getTime() + 48 * 3600_000 - 24 * 3600_000);
  await firstTime(page);
  await confirmPhone(page, number);
  await expect(flow(page)).toContainText("Welcome back");
  await cont(page).click();
  await flow(page).getByLabel(/^I agree to the cancellation policy/).check();
  await flow(page).getByRole("button", { name: /^Book appointment$|deposit and book$/ }).click();
  await expect(page.getByRole("heading", { name: /You’re booked/ })).toBeVisible();
  const { data: visits } = await admin.from("appointments").select("id, client:clients!inner(first_name)").eq("client.first_name", `Pt${RUN}New`);
  expect(visits).toHaveLength(2);
});

test("a client who says yes but has none on file is told as soon as they confirm who they are", async ({ page }) => {
  await chooseRootTouchUp(page);
  await flow(page).getByRole("group", { name: "Patch test" }).getByRole("button", { name: "Yes, I have" }).click();
  await cont(page).click();
  await flow(page).getByRole("button", { name: /^No preference/ }).click();
  await cont(page).click();
  await firstTime(page);
  await confirmPhone(page, newPhone());
  const told = flow(page).getByTestId("patch-check");
  await expect(told).toContainText("we don't have one on file for you");
  await expect(told.getByRole("button", { name: "Book a patch test first" })).toBeVisible();
  await expect(cont(page)).toHaveCount(0);
  await told.getByRole("button", { name: "Book a patch test first" }).click();
  await expect(flow(page).getByRole("heading", { name: "Choose your services" })).toBeVisible();
  await expect(flow(page).getByRole("button", { name: /^Color Consultation/ })).toHaveAttribute("aria-pressed", "true");
});
