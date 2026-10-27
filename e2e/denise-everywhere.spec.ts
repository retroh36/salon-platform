// Denise on every staff page: her bubble in the corner, the same
// conversation from page to page (and after a reload), ⌘K / Ctrl+K from
// anywhere with the cursor in her box, never over the checkout's Complete
// sale at iPad width, and never on the client's booking site.
import { busyDay } from "../tests/db/helpers";
import { openCheckout } from "./checkout-helpers";
import { AUTH, expect, putBackSales, test, waitForHydration } from "./fixtures";

// Stock and sales this file uses are put back afterwards.
putBackSales();

test.use({ storageState: AUTH.frontDesk });

test("the conversation carries over from page to page", async ({ page }) => {
  await page.goto("/clients");
  await waitForHydration(page, "[data-testid=denise-bubble-launcher]");
  await page.getByTestId("denise-bubble-launcher").click();
  const bubble = page.getByRole("complementary", { name: "Denise" });
  await bubble.getByRole("textbox", { name: "Message Denise" }).fill("How do I sell a gift card?");
  await bubble.getByRole("button", { name: "Send" }).click();
  const conversation = bubble.getByRole("region", { name: "Conversation with Denise" });
  await expect(conversation).toContainText("How do I sell a gift card?");
  await expect(page.getByTestId("denise-thinking")).toHaveCount(0);

  // Another page, through the sidebar: still open, the same conversation.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sales" }).first().click();
  await expect(page).toHaveURL(/\/sales/);
  await expect(conversation).toContainText("How do I sell a gift card?");

  // A reload keeps it too; the calendar's Denise tab shows the same.
  await page.reload();
  await waitForHydration(page, "[data-testid=denise-bubble-launcher], [data-testid=denise-bubble]");
  await page.goto(`/calendar?date=${(await busyDay("America/Chicago")).date}`);
  await waitForHydration(page, "section[data-staff-id]");
  await page.getByTestId("denise-launcher").click();
  await expect(page.getByRole("region", { name: "Conversation with Denise" })).toContainText("How do I sell a gift card?");
});

test("⌘K or Ctrl+K opens her with the cursor in her box, from any page", async ({ page }) => {
  for (const path of ["/dashboard", "/reports", "/settings"]) {
    await page.goto(path);
    await waitForHydration(page, "[data-testid=denise-bubble-launcher]");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("textbox", { name: "Message Denise" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("complementary", { name: "Denise" })).toHaveCount(0);
  }
  // On the calendar, her tab.
  await page.goto(`/calendar?date=${(await busyDay("America/Chicago")).date}`);
  await waitForHydration(page, "section[data-staff-id]");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator("#denise-follow-up")).toBeFocused();
});

test.describe("on an iPad", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test("she never covers Complete sale at checkout", async ({ page }) => {
    const co = await openCheckout(page, { from: "/sales" });
    await page.getByTestId("denise-bubble-launcher").click();
    const bubble = page.getByRole("complementary", { name: "Denise" });
    await expect(bubble).toBeVisible();
    const complete = co.payment.getByRole("button", { name: /^Complete sale/ });
    await complete.scrollIntoViewIfNeeded();
    const a = (await complete.boundingBox())!;
    const b = (await bubble.boundingBox())!;
    // Side by side, not on top.
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x).toBe(true);
    expect(a.x + a.width).toBeLessThanOrEqual(1024);
    // Nothing scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  });

  test("on a page, she sits beside it, and the page doesn't scroll sideways", async ({ page }) => {
    await page.goto("/clients");
    await waitForHydration(page, "[data-testid=denise-bubble-launcher]");
    await page.getByTestId("denise-bubble-launcher").click();
    const box = (await page.getByRole("complementary", { name: "Denise" }).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1024);
    expect(box.width).toBeLessThan(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  });
});

test("isn't on the client's booking site", async ({ page }) => {
  await page.goto("/book/maple-and-ash");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByTestId("denise-bubble-launcher")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("complementary", { name: "Denise" })).toHaveCount(0);
});
