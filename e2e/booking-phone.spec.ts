import type { Page } from "@playwright/test";
import { expect, test, waitForHydration } from "./fixtures";

// On a phone, the sticky Continue bar never covers the step's last card:
// each step leaves room under its content for the bar, and anything brought
// into view (a tap, the keyboard) stops above it.

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: { cookies: [], origins: [] } });

const flow = (page: Page) => page.getByTestId("booking-flow");
const bar = (page: Page) => page.getByTestId("continue-bar");

// The bar's top and the bottom of what's under it, with the page scrolled
// so `target` is as low as it goes.
async function clear(page: Page, target: ReturnType<Page["locator"]>) {
  await target.evaluate((el) => el.scrollIntoView({ block: "end" }));
  const [box, barBox] = await Promise.all([target.boundingBox(), bar(page).boundingBox()]);
  return { bottom: box!.y + box!.height, barTop: barBox!.y };
}

test("the Continue bar never covers the last card, on any step", async ({ page }) => {
  await page.goto("/book/maple-and-ash");
  await waitForHydration(page, "[data-testid=booking-flow] button[aria-pressed]");

  // Services: the very last card on the menu.
  const cards = flow(page).locator("section[aria-labelledby=step-title] button[aria-pressed]");
  let r = await clear(page, cards.last());
  expect(r.bottom).toBeLessThanOrEqual(r.barTop + 1);
  // The bar has room of its own below the content, its height at least.
  const room = await flow(page).evaluate((el) => getComputedStyle(el).getPropertyValue("--continue-bar"));
  expect(parseFloat(room)).toBeGreaterThan(40);

  await flow(page).getByRole("button", { name: /^Women's Cut/ }).click();
  await flow(page).getByRole("button", { name: "Continue" }).click();

  // Stylists: the last one.
  await expect(flow(page).getByRole("heading", { name: /stylist/i })).toBeVisible();
  r = await clear(page, flow(page).locator("section[aria-labelledby=step-title] button").last());
  expect(r.bottom).toBeLessThanOrEqual(r.barTop + 1);
  // Focus from the keyboard scrolls a card into view above the bar too.
  await page.evaluate(() => window.scrollTo(0, 0));
  await flow(page).locator("section[aria-labelledby=step-title] button").last().focus();
  const focused = await flow(page).locator("section[aria-labelledby=step-title] button").last().boundingBox();
  const barBox = await bar(page).boundingBox();
  expect(focused!.y + focused!.height).toBeLessThanOrEqual(barBox!.y + 1);

  // Time: the last time of the first day with any.
  await flow(page).getByRole("button", { name: /^No preference/ }).click();
  await flow(page).getByRole("button", { name: "Continue" }).click();
  await flow(page).getByRole("radiogroup", { name: "Date" }).getByRole("radio", { name: /\d+ times?$/ }).first().click();
  const times = flow(page).locator("[role=radiogroup]:not([aria-label=Date]) [role=radio]");
  await expect(times.first()).toBeVisible();
  r = await clear(page, times.last());
  expect(r.bottom).toBeLessThanOrEqual(r.barTop + 1);
  await times.last().click();
  await flow(page).getByRole("button", { name: "Continue" }).click();

  // Details: the last thing in the step.
  await expect(flow(page).getByLabel("Mobile number")).toBeVisible();
  r = await clear(page, flow(page).locator("section[aria-labelledby=step-title] :is(input, button)").last());
  expect(r.bottom).toBeLessThanOrEqual(r.barTop + 1);
});
