import type { Locator, Page } from "@playwright/test";
import { AUTH, expect, openDisplayMenu, test, ui, waitForHydration } from "./fixtures";

// Every popup and menu stays on screen (`useKeepOnScreen`), and at iPad
// width the calendar's toolbar is one row. Harbor & Vine, where about ten
// are off any day, so the "off today" chip is always there.

test.use({ storageState: AUTH.largeOwner });

async function openCalendar(page: Page) {
  await page.goto("/calendar");
  await expect(ui(page).getByTestId("calendar-date")).toBeVisible();
  await waitForHydration(page, "[data-testid=off-chip]");
}

// The popup's drawn box, once its pop-in has finished, inside the window
// with a little room to spare.
async function expectOnScreen(page: Page, popup: Locator, what: string) {
  await expect(popup, what).toBeVisible();
  const width = page.viewportSize()!.width;
  await expect
    .poll(async () => {
      const box = (await popup.boundingBox())!;
      return box.x >= 0 && box.x + box.width <= width && box.width > 0;
    }, { message: `${what} at ${width}px` })
    .toBe(true);
}

for (const [width, height] of [
  [1024, 768],
  [1180, 820],
  [1366, 1024],
]) {
  test(`every popup and menu stays on screen at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openCalendar(page);
    const main = ui(page);

    await main.getByTestId("off-chip").click();
    await expectOnScreen(page, main.getByRole("dialog", { name: /off today/i }), "Off today");
    await page.keyboard.press("Escape");

    await expectOnScreen(page, await openDisplayMenu(page), "Calendar display");
    await page.keyboard.press("Escape");

    await main.getByRole("button", { name: "Department or view" }).click();
    await expectOnScreen(page, main.getByRole("listbox"), "Department or view");
    await page.keyboard.press("Escape");

    await main.getByRole("button", { name: /^Go to date:/ }).click();
    await expectOnScreen(page, main.getByRole("dialog", { name: "Go to date" }), "Date picker");
    await page.keyboard.press("Escape");

    const more = main.getByRole("button", { name: "More", exact: true });
    if (await more.isVisible()) {
      await more.click();
      await expectOnScreen(page, main.getByRole("menu", { name: "More" }), "More");
      await page.keyboard.press("Escape");
    }

    await main.getByRole("button", { name: "Key" }).click();
    await expectOnScreen(page, main.getByRole("dialog", { name: "Calendar key" }), "Calendar key");
    await page.keyboard.press("Escape");

    // The salon menu, from the sidebar's card (shown from lg up).
    if (width >= 1024) {
      await page.getByTestId("salon-switcher").click();
      await expectOnScreen(page, page.getByTestId("sidebar").getByRole("menu"), "Salon menu");
      await page.keyboard.press("Escape");
    }
  });
}

test("keeps the toolbar on one row at iPad width, with the department picker's arrow pointing down", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openCalendar(page);
  const main = ui(page);
  // The longest name in the picker.
  const picker = main.getByRole("button", { name: "Department or view" });
  await picker.click();
  await main.getByRole("option", { name: "Nails & skin" }).click();
  await expect(picker).toContainText("Nails & skin");

  const middle = async (el: Locator) => {
    const box = (await el.boundingBox())!;
    return box.y + box.height / 2;
  };
  const row = [
    main.getByRole("link", { name: "Today", exact: true }),
    main.getByRole("button", { name: /^Go to date:/ }),
    picker,
    main.getByTestId("off-chip"),
    main.getByRole("button", { name: /^(Compact|Comfortable|Detailed)$/ }),
    main.getByRole("radio", { name: "Week" }),
  ];
  const first = await middle(row[0]);
  for (const el of row.slice(1)) expect(Math.abs((await middle(el)) - first)).toBeLessThan(4);

  // The arrow sits at the right of the picker, pointing down (never turned
  // part-way), and the name isn't cut short.
  const arrow = picker.locator("svg").last();
  const [pickerBox, arrowBox] = [(await picker.boundingBox())!, (await arrow.boundingBox())!];
  expect(pickerBox.x + pickerBox.width - (arrowBox.x + arrowBox.width)).toBeLessThan(20);
  expect(await arrow.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  expect(await picker.evaluate((el) => [...el.querySelectorAll("span")].every((s) => s.scrollWidth <= s.clientWidth))).toBe(true);
});
