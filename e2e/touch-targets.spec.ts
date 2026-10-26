import type { Page } from "@playwright/test";
import { addDays, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// On the front desk's iPad every button is at least 44px each way, so a
// finger never misses (calendar blocks excepted: their height is the
// visit's length, and the whole block is the tap).

test.use({ storageState: AUTH.frontDesk, viewport: { width: 1180, height: 820 }, hasTouch: true });

const MIN = 44;
// Next week's Tuesday: open, and full of the demo's visits whatever today is.
const TUESDAY = addDays(startOfWeek(todayIn("America/Chicago")), 8);

// Every visible button on the page smaller than a finger, as
// "label (width×height)".
async function smallButtons(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, [role=button], summary, input[type=button], input[type=submit]")) {
      if (el.closest("[data-block], [data-time-block], [data-resize-handle], nextjs-portal")) continue;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!r.width || !r.height || style.visibility === "hidden" || el.closest("[inert], [aria-hidden=true]")) continue;
      // Half a pixel for rounding.
      if (r.width < min - 0.5 || r.height < min - 0.5) out.push(`${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40) || el.outerHTML.slice(0, 60)} (${Math.round(r.width)}×${Math.round(r.height)})`);
    }
    return out;
  }, MIN);
}

for (const [name, path, ready] of [
  ["the Dashboard", "/dashboard", "main"],
  ["Clients", "/clients", "main"],
  ["Sales", "/sales", "main"],
  ["Gift cards", "/gift-cards", "main"],
  ["Inventory", "/inventory", "main"],
  ["Events", "/events", "main"],
  ["a new sale at checkout", "/sales/new", "main"],
] as const) {
  test(`every button on ${name} is big enough to tap`, async ({ page }) => {
    await page.goto(path);
    await waitForHydration(page, ready);
    await expect(ui(page)).toBeVisible();
    expect(await smallButtons(page)).toEqual([]);
  });
}

test("every button on the calendar, and in a visit's details, is big enough to tap", async ({ page }) => {
  await page.goto(`/calendar?date=${TUESDAY}`);
  await waitForHydration(page, "section[data-staff-id]");
  expect(await smallButtons(page)).toEqual([]);
  await ui(page).locator("[data-block]").first().click();
  await expect(page.getByTestId("visit-status")).toBeVisible();
  expect(await smallButtons(page)).toEqual([]);
});
