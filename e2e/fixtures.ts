import { test as base, expect, type Locator, type Page } from "@playwright/test";

export const PASSWORD = "password123";

// Saved sign-ins, created by auth.setup.ts.
export const AUTH = {
  owner: "e2e/.auth/owner.json",
  frontDesk: "e2e/.auth/front-desk.json",
  stylist: "e2e/.auth/stylist.json",
};

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
