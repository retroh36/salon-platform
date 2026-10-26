import type { Page } from "@playwright/test";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { admin, countFor, SEED } from "../tests/db/helpers";
import { AUTH, busyToday, expect, test, ui, waitForHydration } from "./fixtures";

// Today is a busy demo day, whatever day this runs.
let putBack: () => void;
test.beforeAll(async () => {
  putBack = await busyToday();
});
test.afterAll(() => putBack());

// The Dashboard for each role, on the demo data. Screenshots of each go to
// e2e/screenshots/ (not committed).
async function shot(page: Page, name: string) {
  // After the entrance animations (not the endless ones, like the live dot).
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished)));
  await page.screenshot({ path: `e2e/screenshots/dashboard-${name}.png`, fullPage: true });
}

// Tall enough that the whole page shows (the main area scrolls inside).
test.use({ viewport: { width: 1440, height: 2600 } });

async function open(page: Page) {
  await page.goto("/dashboard");
  await expect(ui(page).getByTestId("dashboard")).toBeVisible();
}

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("sees the whole salon, money included, and every section links on", async ({ page }) => {
    await open(page);
    const main = ui(page);
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Olivia$/);
    await expect(main.getByRole("form", { name: "Ask Denise" })).toBeVisible();

    // Denise's brief as the hero, in sections.
    const denise = main.getByTestId("dashboard-denise");
    await expect(denise.getByTestId("dashboard-brief-visits")).toContainText(/visits? on the book today/);
    const brief = denise.getByTestId("dashboard-brief");
    await expect(brief.getByRole("heading", { level: 3 })).toHaveText([/^Risks today/, /^Might not show/, /^Due back, nothing booked/, /^Low stock for today/, /^Coming in with credit/, /^Events coming up/]);
    await expect(denise.getByTestId("dashboard-denise-says")).toHaveText(/Nothing to act on right now\.|need(s)? a look:/);

    // Five tiles, each compared with last week.
    for (const id of ["tile-appointments", "tile-fullness", "tile-revenue", "tile-checked-in", "tile-missed"]) {
      await expect(main.getByTestId(id)).toContainText(/vs last|Same as last/);
    }
    await expect(main.getByTestId("tile-revenue")).toContainText("$");
    await expect(main.getByTestId("right-now")).toBeVisible();
    expect(await main.getByTestId("team-card").count()).toBeGreaterThan(3);
    await expect(main.getByTestId("opportunity-overdue").getByRole("listitem")).toHaveCount(3);
    await expect(main.getByTestId("week-chart").getByRole("listitem")).toHaveCount(7);
    await expect(main.getByTestId("week-sales")).toContainText("$");
    await shot(page, "owner");

    // A stylist opens their calendar column, tinted for a moment.
    await waitForHydration(page, "[data-testid=team-card]");
    const card = main.getByTestId("team-card").first();
    const staffId = (await card.getAttribute("href"))!.split("staff=")[1];
    await card.click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(ui(page).locator(`section[data-staff-id="${staffId}"]`)).toHaveClass(/bg-navy-100/);
  });

  test("lists every regular due back from See all", async ({ page }) => {
    await open(page);
    await ui(page).getByTestId("opportunity-overdue").getByRole("link", { name: /See all/ }).click();
    await expect(page).toHaveURL("/clients?due=1");
    await expect(ui(page).getByRole("heading", { name: "Due back" })).toBeVisible();
    expect(await ui(page).getByRole("list", { name: "Due back" }).getByRole("listitem").count()).toBeGreaterThan(3);
  });

  test("fits an iPad", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 2800 });
    await open(page);
    await expect(ui(page).getByTestId("tile-revenue")).toBeVisible();
    // Nothing wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(820);
    await shot(page, "owner-ipad");
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("sees everything except money, and asks Denise from the top", async ({ page }) => {
    await open(page);
    const main = ui(page);
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(/, Sam$/);
    await expect(main.getByTestId("tile-revenue")).toHaveCount(0);
    await expect(main.getByTestId("week-sales")).toHaveCount(0);
    await expect(main.getByTestId("tile-appointments")).toBeVisible();
    await expect(main.getByTestId("opportunity-gaps")).toBeVisible();
    // Reorder drafts without their totals.
    const items = main.getByTestId("denise-item");
    for (const text of await items.allTextContents()) expect(text).not.toMatch(/\$\d/);
    await shot(page, "front-desk");

    // A reorder draft's Review goes to Inventory.
    const reorder = items.filter({ hasText: "Reorder draft" }).first();
    if (await reorder.count()) {
      await reorder.getByRole("link", { name: "Review" }).click();
      await expect(page).toHaveURL("/inventory");
      await open(page);
    }

    // A question opens on the calendar with Denise's answer (no API key in
    // tests, so she says she isn't connected).
    await waitForHydration(page, "#dashboard-ask");
    await main.locator("#dashboard-ask").fill("Who's free for a color at 3?");
    await main.getByRole("button", { name: "Ask" }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    const panel = page.getByRole("tabpanel", { name: /Denise/ });
    await expect(panel).toContainText("Who's free for a color at 3?");
    await expect(panel).toContainText("I'm not connected yet");
  });
});

test.describe("links into the calendar", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("open Denise's panel or a booking, then tidy the address", async ({ page }) => {
    await page.goto("/calendar?denise=1");
    await expect(page.getByRole("tabpanel", { name: /Denise/ })).toBeVisible();
    await expect(page).toHaveURL(/\/calendar$/);

    const today = todayIn("America/Chicago");
    const { data: visit } = await admin
      .from("appointments")
      .select("id")
      .eq("location_id", SEED.location)
      .neq("status", "canceled")
      .gte("starts_at", startOfLocalDay(today, "America/Chicago").toISOString())
      .lt("starts_at", startOfLocalDay(addDays(today, 1), "America/Chicago").toISOString())
      .limit(1)
      .single();
    await page.goto(`/calendar?open=${visit!.id}`);
    await expect(page.getByRole("tabpanel", { name: "Booking details" })).toBeVisible();
  });
});

test.describe("stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("gets their own day, with no salon money and no salon-wide Denise", async ({ page }) => {
    await open(page);
    const main = ui(page);
    await expect(main.getByTestId("dashboard")).toHaveAttribute("data-role", "stylist");
    await expect(main.getByTestId("my-denise-notes")).toBeVisible();
    await expect(main.getByTestId("my-next-client")).toBeVisible();
    await expect(main.getByTestId("my-stats")).toBeVisible();
    await expect(main.getByTestId("my-visits")).toBeVisible();
    await expect(main.getByTestId("dashboard-denise")).toHaveCount(0);
    await expect(main.getByTestId("tile-revenue")).toHaveCount(0);
    await expect(main.getByTestId("week-sales")).toHaveCount(0);
    await expect(main.getByTestId("opportunity-gaps")).toHaveCount(0);
    // Only their own card, so no team row.
    await expect(main.getByTestId("team-card")).toHaveCount(0);
    // No money but their own goals.
    await expect(main.getByTestId("dashboard-goals")).toContainText("of $9,000");
    const elsewhere = await main.evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelector("[data-testid=dashboard-goals]")?.remove();
      return copy.textContent ?? "";
    });
    expect(elsewhere).not.toMatch(/\$\d/);
    await shot(page, "stylist");
  });
});

test.describe("reduced motion", () => {
  test.use({ storageState: AUTH.owner, reducedMotion: "reduce" });

  test("the week's bars don't animate", async ({ page }) => {
    await open(page);
    const bar = ui(page).getByTestId("week-chart").locator(".animate-grow-up").first();
    expect(await bar.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))).toBeLessThan(0.01);
  });
});

test.describe("Team", () => {
  test.use({ storageState: AUTH.stylist });

  test("has the directory and the schedule as tabs", async ({ page }) => {
    await page.goto("/team");
    const tabs = ui(page).getByRole("navigation", { name: "Team pages" });
    await expect(tabs.getByRole("link", { name: "Directory" })).toHaveAttribute("aria-current", "page");
    // Team goals are for owners and managers.
    await expect(tabs.getByRole("link", { name: "Goals" })).toHaveCount(0);
    await expect(ui(page).getByRole("heading", { name: `Staff (${await countFor("staff", SEED.business, SEED.location)})` })).toBeVisible();
    await expect(ui(page).getByText("Bridget Callahan(you)")).toBeVisible();
    await tabs.getByRole("link", { name: "Schedule" }).click();
    await expect(page).toHaveURL("/schedule");
    await expect(ui(page).getByRole("navigation", { name: "Team pages" }).getByRole("link", { name: "Schedule" })).toHaveAttribute("aria-current", "page");
  });
});
