import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { daysBetween, todayIn } from "@/lib/scheduling/time";
import { busyDay, SEED } from "../tests/db/helpers";
import { shiftBusiness } from "../e2e-week/time-machine";

export const PASSWORD = "password123";

// Saved sign-ins, created by auth.setup.ts.
export const AUTH = {
  owner: "e2e/.auth/owner.json",
  manager: "e2e/.auth/manager.json",
  frontDesk: "e2e/.auth/front-desk.json",
  stylist: "e2e/.auth/stylist.json",
  // Harbor & Vine, the large demo salon.
  largeOwner: "e2e/.auth/large-owner.json",
  largeFrontDesk: "e2e/.auth/large-front-desk.json",
};

// A test that takes the browser offline on purpose: Chrome logs each request
// it couldn't send ("Failed to load resource: net::ERR_INTERNET_DISCONNECTED"),
// which no page can stop. Only that line is let through; anything our code
// throws (an uncaught "Failed to fetch") still fails the test.
export function allowOfflineLogs(pageErrors: string[]) {
  pageErrors.splice(0, pageErrors.length, ...pageErrors.filter((e) => e !== "Failed to load resource: net::ERR_INTERNET_DISCONNECTED"));
}

// Fails the test if the page logs a console error or throws. In dev this
// includes Next.js errors shown in the dev overlay, such as prerendering
// problems.
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors, "browser console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// Waits until React has hydrated the visible element matching selector.
// Before that, clicks change the DOM without updating React state, which
// tests (unlike people) are fast enough to hit. Hidden copies of earlier pages
// are skipped.
export async function waitForHydration(page: Page, selector: string) {
  await page.waitForFunction(
    (sel) =>
      [...document.querySelectorAll(sel)].some(
        (el) => el.checkVisibility() && Object.keys(el).some((key) => key.startsWith("__reactProps")),
      ),
    selector,
  );
}

// The visible page's main content. Next.js keeps pages you navigated away
// from mounted but hidden (so back/forward keep their state), and text and
// label queries would otherwise also match those hidden copies.
export function ui(page: Page) {
  return page.locator("main").filter({ visible: true });
}

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await waitForHydration(page, "input[name=email]");
  await ui(page).getByLabel("Email").fill(email);
  await ui(page).getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");
}

// The calendar's scale: px per minute, from the person's zoom.
export async function pxPerMinute(page: Page): Promise<number> {
  return Number(await ui(page).getByTestId("calendar-grid").getAttribute("data-px-per-minute"));
}

// The y of a time in a stylist's column, after scrolling the calendar so
// it's in view (and the column's box then).
export async function slotAt(page: Page, column: Locator, minute: number) {
  const start = Number(await ui(page).locator("[data-range-start]").getAttribute("data-range-start"));
  const ppm = await pxPerMinute(page);
  await ui(page)
    .getByTestId("calendar-grid")
    .evaluate((el, top) => (el.scrollTop = top), Math.max(0, (minute - start) * ppm - 200));
  const box = (await column.boundingBox())!;
  return { box, y: box.y + (minute - start) * ppm + 3, ppm };
}

// "Check in" in booking details, through its one warning listing anything
// the visit still needs (a new client's consultation form, say).
export async function checkIn(panel: Locator) {
  await panel.getByRole("button", { name: "Check in", exact: true }).click();
  const anyway = panel.getByRole("button", { name: "Check in anyway" });
  await expect(anyway.or(panel.getByTestId("visit-status").filter({ hasText: /^Checked in/ }))).toBeVisible();
  if (await anyway.isVisible()) await anyway.click();
  await expect(panel.getByTestId("visit-status")).toHaveText(/^Checked in/);
}

// Booking details' other actions (Running late, Edit booking, Undo
// check-in, Mark no-show, Cancel booking) are in the "⋯" menu in its footer.
export async function moreAction(panel: Locator, name: string) {
  const more = panel.getByRole("button", { name: "More actions" });
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  await panel.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name, exact: true }).click();
}

// Check out: the main button once the client's checked in.
export async function checkOut(panel: Locator) {
  const primary = panel.getByTestId("primary-action");
  await expect(primary).toHaveText("Check out");
  await primary.click();
}

// One of booking details' tabs: Notes, Formula or History.
export async function visitTab(panel: Locator, name: "Notes" | "Formula" | "Photos" | "History") {
  await panel.getByRole("tab", { name, exact: true }).click();
}

// "Before this visit (2)", opened to its checklist.
export async function openChecklist(panel: Locator) {
  const region = panel.getByRole("region", { name: "Before this visit" });
  const toggle = region.getByRole("button", { name: /^Before this visit/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return region;
}

// For tests about a busy today, whatever day they run: when today has no
// visits on the demo calendar (the salon is closed Sundays and Mondays),
// Maple & Ash's whole world moves back so the next day that has them is
// today, with its weekly hours turned to match (the week test's time
// machine), and the same day last week too. Returns the move back, for
// afterAll. Nothing moves when today already has visits.
export async function busyToday(): Promise<() => void> {
  const TZ = "America/Chicago";
  const days = daysBetween(todayIn(TZ), (await busyDay(TZ)).date);
  if (days > 0) shiftBusiness(SEED.business, TZ, -days);
  return () => {
    if (days > 0) shiftBusiness(SEED.business, TZ, days);
  };
}
