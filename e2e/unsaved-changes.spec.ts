import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { AUTH, expect, test, ui, waitForHydration, slotAt } from "./fixtures";

// A half-filled booking isn't lost by a stray tap: closing the panel,
// tapping the calendar, changing day or following a link asks first.

// A Wednesday clear of the seeded month (nothing is saved here).
const DAY = addDays(startOfWeek(todayIn("America/Chicago")), 44);

test.use({ storageState: AUTH.frontDesk, viewport: { width: 1920, height: 1500 } });

async function startBooking(page: Page) {
  await page.goto(`/calendar?date=${DAY}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
  await waitForHydration(page, "section[data-staff-id]");
  const { box, y } = await slotAt(page, ui(page).getByRole("region", { name: "Bridget Callahan", exact: true }), 11 * 60);
  await page.mouse.click(box.x + box.width - 15, y);
  const form = page.getByRole("tabpanel", { name: "Booking details" });
  await expect(form.getByLabel("Service")).toBeVisible();
  return form;
}

const asking = (page: Page) => page.getByRole("dialog", { name: "Leave without saving?" });

test("an untouched booking closes without asking", async ({ page }) => {
  const form = await startBooking(page);
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(asking(page)).toHaveCount(0);
  await expect(form).toBeHidden();
});

test("closing a half-filled booking asks first: keep editing keeps it, discard clears it", async ({ page }) => {
  const form = await startBooking(page);
  await form.getByLabel("Service").selectOption({ label: "Blowout" });

  await page.keyboard.press("Escape");
  await expect(asking(page)).toContainText("hasn't been saved");
  await asking(page).getByRole("button", { name: "Keep editing" }).click();
  await expect(asking(page)).toHaveCount(0);
  await expect(form.getByLabel("Service").locator("option:checked")).toHaveText("Blowout");

  await page.getByRole("button", { name: "Close panel" }).click();
  await asking(page).getByRole("button", { name: "Discard changes" }).click();
  await expect(form).toBeHidden();

  // A new booking starts empty again.
  const again = await startBooking(page);
  await expect(again.getByLabel("Service").locator("option:checked")).not.toHaveText("Blowout");
});

test("a link elsewhere waits for an answer", async ({ page }) => {
  const form = await startBooking(page);
  await form.getByLabel("Service").selectOption({ label: "Blowout" });
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Clients" }).click();
  await expect(asking(page)).toBeVisible();
  await asking(page).getByRole("button", { name: "Keep editing" }).click();
  expect(new URL(page.url()).pathname).toBe("/calendar");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Clients" }).click();
  await asking(page).getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/clients$/);
});
