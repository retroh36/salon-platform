import type { Locator, Page } from "@playwright/test";
import { AUTH, expect, test } from "./fixtures";

// The sidebar: Maestra's logo, the salon's card, navigation in groups
// (Daily, Sales, Salon, then Settings), only what a role can use, and a
// footer (who's signed in, sign out) that never overlaps at any window size.

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
    // The current page: marked, with the accent bar; New sale is in page
    // headers, not here.
    const current = sidebar(page).getByRole("link", { name: "Dashboard" });
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(current.getByTestId("nav-accent")).toBeVisible();
    await expect(sidebar(page).getByTestId("nav-accent")).toHaveCount(1);
    await expect(sidebar(page).getByRole("link", { name: "New sale" })).toHaveCount(0);
  });

  test("is navy with readable text, the logo is the biggest brand element, and focus rings are for the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const aside = sidebar(page);
    // The real colors on screen (a stale dev build once drew white text on
    // a light background: docs/operations.md).
    expect(await aside.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(23, 39, 59)");
    const contrast = (el: Locator) =>
      el.evaluate((node) => {
        const rgb = (c: string) => c.match(/\d+/g)!.slice(0, 3).map(Number);
        const lum = (c: number[]) => {
          const [r, g, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        // The nearest background that isn't transparent.
        let bg = "";
        for (let n: Element | null = node; n && !bg; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (!/rgba\(.*, 0\)$/.test(c) && c !== "transparent") bg = c;
        }
        const [a, b] = [lum(rgb(getComputedStyle(node).color)), lum(rgb(bg))];
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
    const card = aside.getByTestId("salon-switcher");
    const salonName = card.locator(".font-semibold").first();
    for (const [what, el] of [
      ["salon name", salonName],
      ["current page", aside.getByRole("link", { name: "Dashboard" })],
      ["another link", aside.getByRole("link", { name: "Clients" })],
      ["signed in", page.getByTestId("sidebar-user")],
    ] as const) {
      expect(await contrast(el), what).toBeGreaterThanOrEqual(4.5);
    }

    // The logo's drawn letters (61% of the image's height) are about 30px,
    // well above the salon card's name.
    const logo = aside.getByTestId("sidebar-logo");
    const drawn = ((await logo.boundingBox())!.height * 253) / 414;
    expect(drawn).toBeGreaterThanOrEqual(29);
    expect(drawn).toBeLessThanOrEqual(33);
    expect(drawn).toBeGreaterThan(2 * Number.parseFloat(await salonName.evaluate((el) => getComputedStyle(el).fontSize)));

    // No ring after loading or a click; one from the keyboard.
    const outline = () => card.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(await outline()).toBe("none");
    await card.click();
    await expect(card).toBeFocused();
    expect(await outline()).toBe("none");
    await page.keyboard.press("Escape");
    // From the top of a fresh page, Tab reaches the card in a few steps.
    await page.reload();
    await expect(card).toBeVisible();
    for (let i = 0; i < 10 && !(await card.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(card).toBeFocused();
    expect(await outline()).toBe("solid");
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
      const logo = sidebar(page).getByTestId("sidebar-logo");
      const salon = sidebar(page).getByTestId("salon-switcher");
      for (const el of [user, signOut, logo, salon]) await expect(el).toBeInViewport({ ratio: 1 });
      expect(await overlap(user, signOut)).toBe(false);
      expect(await overlap(logo, salon)).toBe(false);
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
