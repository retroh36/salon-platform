import type { Page } from "@playwright/test";
import { AUTH, expect, signIn, test, ui, waitForHydration } from "./fixtures";
import { admin, SEED } from "../tests/db/helpers";

// Roles and logins: what each role can open, owners' per-person toggles,
// the assistant's view of their stylist's day, and the shared front-desk
// iPad (switch with a PIN, lock when idle).

const navLinks = (page: Page) =>
  page.getByRole("navigation", { name: "Main" }).getByRole("link").evaluateAll((els) => els.map((a) => a.textContent?.trim()));

test.describe("the front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("has no reports, payroll or settings, and only today's sales", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Calendar" })).toBeVisible();
    const links = await navLinks(page);
    expect(links).toEqual(expect.arrayContaining(["Calendar", "Clients", "Sales", "Gift cards"]));
    for (const hidden of ["Reports", "Payroll", "Policy", "Settings"]) expect(links).not.toContain(hidden);

    for (const path of ["/reports", "/payroll", "/settings", "/settings/devices"]) {
      await page.goto(path);
      await expect(page).toHaveURL("/dashboard");
    }
    await page.goto("/sales?date=2020-01-01");
    await expect(ui(page).getByRole("navigation", { name: "Day" })).toHaveCount(0);
    await expect(ui(page).getByRole("link", { name: "← Previous day" })).toHaveCount(0);
  });
});

test.describe("an owner's toggles", () => {
  test.use({ storageState: AUTH.owner });
  test.afterEach(async () => {
    await admin.from("staff_permissions").delete().eq("staff_id", SEED.staff.frontDesk);
  });

  test("give the front desk reports, and take them back", async ({ page, browser }) => {
    await page.goto(`/team/${SEED.staff.frontDesk}`);
    const card = ui(page).getByRole("region", { name: "What they can do" });
    await waitForHydration(page, "[data-testid=permissions] input");
    const reports = card.getByRole("checkbox", { name: /Reports and past sales/ });
    await expect(reports).not.toBeChecked();
    // Payroll isn't something the front desk can be given.
    await expect(card.getByRole("checkbox", { name: /Payroll/ })).toHaveCount(0);
    await reports.check();
    await expect(card.getByRole("status")).toHaveText(/Saved/);
    await expect(card.getByText("(changed for Sam)")).toBeVisible();

    const desk = await browser.newContext({ storageState: AUTH.frontDesk });
    const deskPage = await desk.newPage();
    await deskPage.goto("/dashboard");
    await expect(deskPage.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Reports" })).toBeVisible();
    await deskPage.goto("/sales");
    await expect(deskPage.locator("main").getByRole("link", { name: "← Previous day" })).toBeVisible();

    await reports.uncheck();
    await expect(card.getByText("(changed for Sam)")).toHaveCount(0);
    // The tick goes at once; the save lands a moment later.
    await expect(async () => {
      await deskPage.goto("/reports");
      await expect(deskPage).toHaveURL("/dashboard", { timeout: 1000 });
    }).toPass();
    await desk.close();
  });
});

test.describe("an assistant", () => {
  test("sees their stylist's day, read-only, with no money or settings", async ({ page }) => {
    await signIn(page, "ari@mapleandash.test");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My day" })).toBeVisible();
    const links = await navLinks(page);
    expect(links).toContain("My day");
    for (const hidden of ["Sales", "Gift cards", "Reports", "Payroll", "Settings"]) expect(links).not.toContain(hidden);
    await page.goto("/my-day");
    await expect(ui(page).getByTestId("assisting")).toHaveText("You're assisting Bridget: here's their day, as it's booked.");
    await expect(ui(page).getByRole("button", { name: "Start service" })).toHaveCount(0);
    await expect(ui(page).getByTestId("my-goals")).toHaveCount(0);
    for (const path of ["/payroll", "/settings", "/sales/new"]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(path);
    }
  });
});

test.describe("the shared iPad", () => {
  test("switches people with a PIN and locks itself when idle", async ({ page }) => {
    // A fresh sign-in, so signing out here doesn't end the saved one.
    await page.clock.install();
    await signIn(page, "owner@mapleandash.test");
    await page.goto("/settings/devices");
    await waitForHydration(page, "form[aria-label='Share this device'] button");
    await ui(page).getByLabel("Name").fill("E2E iPad");
    await ui(page).getByRole("button", { name: "Use this device as a shared device" }).click();
    await expect(ui(page).getByRole("status")).toHaveText(/This device is now E2E iPad/);

    try {
      await page.goto("/dashboard");
      // Prefetches answered after the switch would be sent to the PIN screen (auth.spec.ts).
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Switch user" }).first().click();
      await expect(page).toHaveURL("/switch");
      await expect(page.getByRole("heading", { name: "Who's at the desk?" })).toBeVisible();

      // A wrong PIN, then the right one.
      await waitForHydration(page, "ul[aria-label='Choose who you are'] button");
      await page.getByRole("button", { name: "Sam R." }).click();
      for (const d of "1357") await page.getByRole("button", { name: d, exact: true }).click();
      await page.getByRole("button", { name: "Unlock" }).click();
      await expect(page.getByText("That PIN isn't right.")).toBeVisible();
      for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Delete" }).click();
      for (const d of "4826") await page.getByRole("button", { name: d, exact: true }).click();
      await page.getByRole("button", { name: "Unlock" }).click();
      await expect(page).toHaveURL("/dashboard");
      await expect(page.getByTestId("sidebar-user").first()).toHaveText("Sam");

      // Nobody touches it for the salon's idle time (5 minutes).
      await expect(page.getByTestId("auto-lock")).toHaveAttribute("data-minutes", "5");
      await page.clock.fastForward("05:01");
      await expect(page).toHaveURL("/switch?idle=1");
      await expect(page.getByText("Locked after 5 minutes with nobody using it.")).toBeVisible();

      // Signed out, the app sends the shared iPad to its PIN screen.
      await page.goto("/calendar");
      await expect(page).toHaveURL("/switch");
    } finally {
      await admin.from("shared_devices").delete().eq("name", "E2E iPad");
      await admin.from("staff_pins").update({ failed_attempts: 0, locked_until: null }).eq("business_id", SEED.business);
    }
    // Once removed, it's the ordinary sign-in again.
    await page.goto("/switch");
    await expect(page).toHaveURL("/login");
  });
});
