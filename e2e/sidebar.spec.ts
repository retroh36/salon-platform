import type { Locator, Page } from "@playwright/test";
import { AUTH, expect, test } from "./fixtures";

// The sidebar: navigation in groups (Daily, Sales, Salon, then Settings),
// only what a role can use, and a footer (who's signed in, sign out,
// "Powered by Maestra") that never overlaps at any window size.

const sidebar = (page: Page) => page.locator("aside").filter({ has: page.getByTestId("sidebar-footer") });

async function groups(page: Page) {
  const nav = sidebar(page).getByRole("navigation", { name: "Main" });
  // evaluateAll doesn't wait: let the page render first.
  await expect(nav.getByRole("group").first()).toBeVisible();
  return nav.getByRole("group").evaluateAll((els) => els.map((g) => [g.querySelector("h2")!.textContent, [...g.querySelectorAll("a")].map((a) => a.textContent)]));
}

const overlap = async (a: Locator, b: Locator) => {
  const [x, y] = [(await a.boundingBox())!, (await b.boundingBox())!];
  return x.x < y.x + y.width && y.x < x.x + x.width && x.y < y.y + y.height && y.y < x.y + x.height;
};

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("the client search bar is on the Calendar and Clients only", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const bar = page.locator("header").getByRole("search").getByRole("searchbox", { name: "Search clients" });
    for (const path of ["/calendar", "/clients"]) {
      await page.goto(path);
      await expect(bar, path).toBeVisible();
    }
    for (const path of ["/dashboard", "/sales", "/team", "/inventory", "/reports", "/settings"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.locator("header").getByRole("search"), path).toHaveCount(0);
    }
  });

  test("sees every group, with Settings at the bottom", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    expect(await groups(page)).toEqual([
      ["Daily", ["Dashboard", "Calendar", "Clients", "Events"]],
      ["Sales", ["Sales", "Gift cards", "Promotions", "Reports", "Payroll", "Policy"]],
      ["Salon", ["Team", "Services", "Durations", "Inventory", "Forms"]],
    ]);
    await expect(sidebar(page).getByRole("link", { name: "Settings" })).toBeVisible();
  });

  for (const [width, height] of [
    [1024, 600],
    [1180, 820],
    [1440, 900],
    [1920, 1080],
  ]) {
    test(`the footer never overlaps at ${width}×${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/dashboard");
      const footer = page.getByTestId("sidebar-footer");
      const user = footer.getByTestId("sidebar-user");
      const signOut = footer.getByRole("button", { name: "Sign out" });
      const powered = footer.getByTestId("powered-by");
      for (const el of [user, signOut, powered]) await expect(el).toBeInViewport({ ratio: 1 });
      expect(await overlap(user, signOut)).toBe(false);
      expect(await overlap(user, powered)).toBe(false);
      expect(await overlap(signOut, powered)).toBe(false);
      // The nav (scrolling if it must) ends above the footer.
      const nav = (await sidebar(page).getByRole("navigation", { name: "Main" }).boundingBox())!;
      expect(nav.y + nav.height).toBeLessThanOrEqual((await footer.boundingBox())!.y + 1);
      // Only one avatar in the footer.
      await expect(footer.locator("[data-avatar], .rounded-full").filter({ hasText: /^[A-Z]{1,2}$/ })).toHaveCount(1);
    });
  }
});

test.describe("stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("doesn't see the Sales group or Settings", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    expect(await groups(page)).toEqual([
      ["Daily", ["Dashboard", "My day", "Calendar", "Clients"]],
      ["Salon", ["Team", "Services", "Inventory", "Forms"]],
    ]);
    await expect(sidebar(page).getByRole("link", { name: "Settings" })).toHaveCount(0);
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("sees Sales, Gift cards and Promotions, not Reports, Durations or Settings", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    expect(await groups(page)).toEqual([
      ["Daily", ["Dashboard", "Calendar", "Clients", "Events"]],
      ["Sales", ["Sales", "Gift cards", "Promotions"]],
      ["Salon", ["Team", "Services", "Inventory", "Forms"]],
    ]);
    await expect(sidebar(page).getByRole("link", { name: "Settings" })).toHaveCount(0);
  });
});
