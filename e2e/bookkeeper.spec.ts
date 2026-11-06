import { admin, SEED } from "../tests/db/helpers";
import { expect, signIn, test, ui } from "./fixtures";

// The bookkeeper (Priya): lands on Reports, sees only the money pages,
// reads sales without client names or the desk's buttons, and can't open
// the calendar or clients.

test.afterAll(async () => {
  await admin.from("staff_permissions").delete().eq("staff_id", SEED.staff.bookkeeper);
});

test("a bookkeeper sees the money and nothing of the calendar or clients", async ({ page }) => {
  await signIn(page, "books@mapleandash.test", "/reports");
  const nav = page.locator("aside").first();
  for (const name of ["Sales", "Reports", "Policy", "Audit trail"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  for (const name of ["Calendar", "Clients", "Dashboard", "Team", "Payroll", "Inventory", "Settings"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
  await expect(page.getByTestId("denise-sidebar-launcher")).toHaveCount(0);

  const main = ui(page);
  // Reports: the money; the visits' sections and the close-out form aren't theirs.
  await expect(main.getByRole("heading", { name: "What you owe in services" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Rebooked at checkout" })).toHaveCount(0);
  await expect(main.getByRole("form", { name: "Close out the day" })).toHaveCount(0);

  // Anything else goes back to Reports.
  for (const path of ["/calendar", "/clients", "/dashboard", "/team", "/checkout/new", "/sales/drawer"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/reports$/);
  }

  // Sales: read only, with no client names.
  await page.goto("/sales");
  await expect(main.getByRole("link", { name: "New sale" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Cash drawer" })).toHaveCount(0);
  const { data: sale } = await admin.from("sales").select("id, number, client:clients(first_name, last_name)").eq("business_id", SEED.business).not("client_id", "is", null).order("created_at", { ascending: false }).limit(1).single();
  await page.goto(`/sales/${sale!.id}`);
  await expect(main.getByRole("heading", { name: `Sale #${sale!.number}` })).toBeVisible();
  await expect(main.getByText(`${sale!.client!.first_name} ${sale!.client!.last_name}`)).toHaveCount(0);
  await expect(main.getByRole("heading", { name: "Refund" })).toHaveCount(0);
  await expect(main.getByRole("heading", { name: "Receipt", exact: true })).toHaveCount(1);
});

test("an owner can give the bookkeeper payroll", async ({ browser }) => {
  await admin.from("staff_permissions").upsert({ staff_id: SEED.staff.bookkeeper, business_id: SEED.business, permission: "payroll", allowed: true });
  const page = await browser.newPage();
  try {
    await signIn(page, "books@mapleandash.test", "/reports");
    await page.locator("aside").first().getByRole("link", { name: "Payroll", exact: true }).click();
    await expect(page).toHaveURL(/\/payroll/);
    await expect(ui(page).getByRole("heading", { name: "Payroll" })).toBeVisible();
  } finally {
    await page.close();
  }
});
