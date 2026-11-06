import { addDays, todayIn } from "@/lib/scheduling/time";
import { AUTH, expect, test, ui } from "./fixtures";

// Reconcile: the owner sees each day's money and downloads the CSVs; the
// front desk can't.

const today = todayIn("America/Chicago");
const from = addDays(today, -6);

test("the owner reconciles a week and exports it", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.owner });
  try {
    await page.goto("/reports");
    await ui(page).getByRole("navigation", { name: "Day" }).getByRole("link", { name: "Reconcile" }).click();
    await expect(page).toHaveURL(/\/reports\/reconcile\?from=/);
    await page.goto(`/reports/reconcile?from=${from}&to=${today}`);
    const main = ui(page);
    await expect(main.getByTestId("reconcile-days").locator("tbody tr")).toHaveCount(7);
    await expect(main.getByTestId("reconcile-summary")).toContainText("To the bank");

    const day = await page.request.get(`/reports/reconcile/export?from=${from}&to=${today}`);
    expect(day.status()).toBe(200);
    expect(day.headers()["content-type"]).toContain("text/csv");
    const rows = (await day.text()).trim().split("\r\n");
    expect(rows[0]).toContain("To the bank");
    expect(rows).toHaveLength(8);
    const each = await page.request.get(`/reports/reconcile/export?from=${from}&to=${today}&detail=payments`);
    expect((await each.text()).split("\r\n")[0]).toBe("Date,Time,Sale,Payment,Amount,Reference");
  } finally {
    await page.close();
  }
});

test("the front desk can't reconcile", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.frontDesk });
  try {
    await page.goto("/reports/reconcile");
    await expect(page).toHaveURL(/\/dashboard$/);
    expect((await page.request.get("/reports/reconcile/export")).status()).toBe(403);
  } finally {
    await page.close();
  }
});
