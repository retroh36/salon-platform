import type { Page } from "@playwright/test";
import { admin } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Unique per run; afterAll deletes these services.
const PREFIX = `E2E ${crypto.randomUUID().slice(0, 8)}`;

test.afterAll(async () => {
  await admin.from("services").delete().like("name", `${PREFIX}%`);
});

// A service's row in the list, matched on its exact name.
function serviceRow(page: Page, name: string) {
  return ui(page).getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
}

async function menuCount(page: Page) {
  const text = await ui(page).getByText(/\d+ on the menu/).textContent();
  return Number(text!.match(/(\d+) on the menu/)![1]);
}

async function archivedCount(page: Page) {
  const summary = ui(page).getByText(/^Archived \(\d+\)$/);
  return (await summary.count()) === 0 ? 0 : Number((await summary.textContent())!.match(/\d+/)![0]);
}

async function openNewServiceForm(page: Page) {
  await page.goto("/services/new");
  await waitForHydration(page, "input[name=staff]");
}

async function fillService(
  page: Page,
  fields: { name: string; category: string; active: string; processing: string; finishing: string; price: string },
) {
  await ui(page).getByLabel("Name", { exact: true }).fill(fields.name);
  await ui(page).getByLabel("Category").fill(fields.category);
  await ui(page).getByLabel("Service time (min)").fill(fields.active);
  await ui(page).getByLabel("Processing gap (min)").fill(fields.processing);
  await ui(page).getByLabel("Finishing time (min)").fill(fields.finishing);
  await ui(page).getByLabel("Default price ($)").fill(fields.price);
}

test.describe("owners", () => {
  test.use({ storageState: AUTH.owner });

  test("see the menu grouped by category with times, prices and stylists", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Services" }).click();
    await expect(page).toHaveURL("/services");

    await expect(ui(page).getByText("40 on the menu")).toBeVisible();
    const categories = ui(page).getByRole("heading", { level: 2 });
    await expect(categories).toHaveText([
      "Cuts (8)",
      "Color (9)",
      "Highlights (6)",
      "Balayage (5)",
      "Blowouts & Styling (6)",
      "Treatments (6)",
    ]);
    await expect(serviceRow(page, "Root Touch-Up")).toContainText("1h 25m · 35m processing");
    // Priya and Sofia charge senior prices for balayage.
    await expect(serviceRow(page, "Balayage")).toContainText("$250–$290");
    await expect(ui(page).getByText("Archived (1)")).toBeVisible();
  });

  test("add a service, keeping typed values through a validation error", async ({ page }) => {
    const name = `${PREFIX} Glow Gloss`;
    await openNewServiceForm(page);

    const priya = ui(page).getByRole("checkbox", { name: /Priya Shah/ });
    const priyaPrice = ui(page).getByLabel("Priya Shah price");
    await expect(priyaPrice).toBeDisabled();
    await priya.check();
    await expect(priyaPrice).toBeEnabled();
    await expect(ui(page).getByRole("heading", { name: "Who offers this (1)" })).toBeVisible();
    await priyaPrice.fill("70");

    // Finishing time without a processing gap, and a bad price.
    await fillService(page, { name, category: "Color", active: "15", processing: "0", finishing: "10", price: "abc" });
    await ui(page).getByRole("button", { name: "Add service" }).click();

    await expect(ui(page).getByRole("alert")).toHaveText("Fix the highlighted fields.");
    await expect(ui(page).getByText("Enter a price like 85 or 85.50.")).toBeVisible();
    await expect(ui(page).getByText("Finishing time only applies after a processing gap.")).toBeVisible();
    // React resets the form after each submit; everything typed must survive.
    await expect(ui(page).getByLabel("Name", { exact: true })).toHaveValue(name);
    await expect(ui(page).getByLabel("Finishing time (min)")).toHaveValue("10");
    await expect(priya).toBeChecked();
    await expect(priyaPrice).toHaveValue("70");

    await ui(page).getByLabel("Processing gap (min)").fill("20");
    await ui(page).getByLabel("Default price ($)").fill("60");
    await ui(page).getByRole("button", { name: "Add service" }).click();

    await expect(page).toHaveURL("/services");
    await expect(serviceRow(page, name)).toContainText("45m · 20m processing");
    await expect(serviceRow(page, name)).toContainText("$60–$70");
    await expect(serviceRow(page, name)).toContainText("Priya");
  });

  test("reject a duplicate name", async ({ page }) => {
    await openNewServiceForm(page);
    await fillService(page, { name: "blowout", category: "Blowouts & Styling", active: "45", processing: "0", finishing: "0", price: "55" });
    await ui(page).getByRole("button", { name: "Add service" }).click();
    await expect(ui(page).getByText("There's already a service with this name.")).toBeVisible();
  });

  test("edit who offers a service and their prices", async ({ page }) => {
    const name = `${PREFIX} Trim`;
    await openNewServiceForm(page);
    await fillService(page, { name, category: "Cuts", active: "30", processing: "0", finishing: "0", price: "40" });
    await ui(page).getByRole("checkbox", { name: /Jamal Carter/ }).check();
    await ui(page).getByRole("checkbox", { name: /Ethan Brooks/ }).check();
    await ui(page).getByLabel("Ethan Brooks price").fill("30");
    await ui(page).getByRole("button", { name: "Add service" }).click();
    await expect(serviceRow(page, name)).toContainText("$30–$40");
    await expect(serviceRow(page, name)).toContainText("Ethan, Jamal");

    await serviceRow(page, name).getByRole("link").click();
    await waitForHydration(page, "input[name=staff]");
    await expect(ui(page).getByLabel("Ethan Brooks price")).toHaveValue("30");
    await ui(page).getByRole("checkbox", { name: /Ethan Brooks/ }).uncheck();
    await ui(page).getByLabel("Jamal Carter price").fill("45");
    await ui(page).getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL("/services");
    await expect(serviceRow(page, name)).toContainText("$40–$45");
    await expect(serviceRow(page, name)).not.toContainText("Ethan");
  });

  test("archive and restore a service", async ({ page }) => {
    const name = `${PREFIX} Seasonal`;
    await openNewServiceForm(page);
    await fillService(page, { name, category: "Treatments", active: "20", processing: "0", finishing: "0", price: "30" });
    await page.getByRole("button", { name: "Add service" }).click();
    await expect(serviceRow(page, name)).toBeVisible();
    // Other tests add services too, so compare with the counts before archiving.
    const onMenu = await menuCount(page);
    const archived = await archivedCount(page);

    await serviceRow(page, name).getByRole("link").click();
    await ui(page).getByRole("button", { name: "Archive service" }).click();
    await expect(page).toHaveURL("/services");
    await expect(ui(page).getByText(`${onMenu - 1} on the menu`)).toBeVisible();
    await expect(serviceRow(page, name)).toBeHidden();
    await ui(page).getByText(`Archived (${archived + 1})`).click();

    // Reopening it must show the archived version, not a cached copy.
    await ui(page).getByRole("link", { name }).click();
    await expect(ui(page).getByText("Archived", { exact: true })).toBeVisible();
    await expect(ui(page).getByLabel("Name", { exact: true })).toBeDisabled();
    await ui(page).getByRole("button", { name: "Restore service" }).click();
    await expect(ui(page).getByRole("button", { name: "Save changes" })).toBeVisible();
    await expect(ui(page).getByLabel("Name", { exact: true })).toBeEnabled();

    await ui(page).getByRole("link", { name: "← Services" }).click();
    await expect(ui(page).getByText(`${onMenu} on the menu`)).toBeVisible();
    await expect(serviceRow(page, name)).toBeVisible();
  });

  test("going back after archiving shows the archived version, not a stale copy", async ({ page }) => {
    const name = `${PREFIX} Back`;
    await openNewServiceForm(page);
    await fillService(page, { name, category: "Treatments", active: "20", processing: "0", finishing: "0", price: "30" });
    await page.getByRole("button", { name: "Add service" }).click();

    await serviceRow(page, name).getByRole("link").click();
    await expect(page).toHaveURL(/\/services\/[0-9a-f-]{36}$/);
    await waitForHydration(page, "input[name=name]");
    const serviceUrl = page.url();
    await ui(page).getByRole("button", { name: "Archive service" }).click();
    await expect(page).toHaveURL("/services");

    // Next.js keeps the previous page mounted for back/forward; the archive
    // action must invalidate it.
    await page.goBack();
    await expect(page).toHaveURL(serviceUrl);
    await expect(ui(page).getByText("Archived", { exact: true })).toBeVisible();
    await expect(ui(page).getByLabel("Name", { exact: true })).toBeDisabled();
  });
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("can view services but not change them", async ({ page }) => {
    await page.goto("/services");
    await expect(ui(page).getByText("view only")).toBeVisible();
    await expect(ui(page).getByRole("link", { name: "Add service" })).toHaveCount(0);

    await serviceRow(page, "Balayage").getByRole("link").click();
    await expect(ui(page).getByText("View only")).toBeVisible();
    await expect(ui(page).getByLabel("Name", { exact: true })).toBeDisabled();
    await expect(ui(page).getByRole("button", { name: /Save|Archive/ })).toHaveCount(0);
  });

  test("are sent back from the add-service page", async ({ page }) => {
    await page.goto("/services/new");
    await expect(page).toHaveURL("/services");
  });
});
