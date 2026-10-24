import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Payroll: owners and managers see everyone's pay for a period with every
// ticket behind it and a CSV; stylists see only their own, on My day.

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("sees pay by person for the last pay period, drills into the tickets, and exports a CSV", async ({ page }) => {
    await page.goto("/payroll");
    const table = ui(page).getByRole("table", { name: "Pay by staff member" });
    const bridget = table.getByTestId("pay-line").filter({ hasText: "Bridget" });
    await expect(bridget).toBeVisible();
    // A busy two weeks of demo sales: commission and tips for Bridget.
    await expect(bridget.getByTestId("pay-total")).toHaveText(/^\$[\d,]+(\.\d{2})?$/);
    expect(await bridget.getByTestId("pay-total").innerText()).not.toBe("$0");
    // The front desk is paid by the hour.
    await expect(table.getByTestId("pay-line").filter({ hasText: "Sam" })).toContainText("at $18/h");

    // Every ticket behind Bridget's pay.
    await bridget.getByRole("link", { name: /Bridget/ }).click();
    const tickets = ui(page).getByRole("table", { name: /^Tickets for Bridget/ });
    await expect(tickets.getByTestId("pay-ticket").first()).toBeVisible();
    await expect(tickets.getByTestId("pay-ticket").first().getByRole("link", { name: /^#\d+$/ })).toHaveAttribute("href", /^\/sales\//);

    // Earlier and later periods, and custom dates.
    await ui(page).getByRole("link", { name: "← Previous" }).click();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=/);
    const form = ui(page).getByRole("form", { name: "Custom dates" });
    await form.getByLabel("From").fill("2026-10-01");
    await form.getByLabel("To").fill("2026-10-03");
    await form.getByRole("button", { name: "Show" }).click();
    await expect(ui(page).getByRole("heading", { level: 1, name: "Payroll" }).locator("..")).toContainText("Thursday, October 1 to Saturday, October 3, 2026");

    const download = page.waitForEvent("download");
    await ui(page).getByRole("link", { name: "Export CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("payroll-2026-10-01-to-2026-10-03.csv");
    const csv = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
    const [header, ...rows] = csv.trimEnd().split("\r\n");
    expect(header).toContain("Service commission,Retail sales");
    expect(rows.some((r) => r.includes(",Bridget "))).toBe(true);
  });

  test("sets the pay period in settings", async ({ page }) => {
    try {
      await page.goto("/settings/payroll");
      await waitForHydration(page, "form[aria-label='Payroll settings'] select");
      const form = ui(page).getByRole("form", { name: "Payroll settings" });
      await form.getByRole("combobox", { name: /^Pay period/ }).selectOption("semi_monthly");
      await expect(form.getByLabel("First day of any pay period")).toHaveCount(0);
      await form.getByRole("button", { name: "Save" }).click();
      await expect(form.getByText("Saved.")).toBeVisible();
      await page.goto("/payroll");
      // The last half-month that's over: ends on the 15th or the month's end.
      await expect(ui(page).getByRole("heading", { level: 1, name: "Payroll" }).locator("..")).toContainText(/(1|16) to .*(15|28|29|30|31), \d{4}/);
    } finally {
      await admin.from("businesses").update({ pay_period: "biweekly", pay_period_anchor: "2026-01-05" }).eq("id", SEED.business);
    }
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("doesn't see payroll", async ({ page }) => {
    await page.goto("/payroll");
    await expect(page).toHaveURL(/\/dashboard$/);
    expect((await page.request.get("/payroll/export")).status()).toBe(403);
  });
});

test.describe("stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("sees only their own earnings on My day", async ({ page }) => {
    await page.goto("/my-day?pay=last");
    const earnings = ui(page).getByTestId("my-earnings");
    await expect(earnings).toContainText("My earnings");
    await expect(earnings.getByTestId("my-pay-total")).toHaveText(/^\$[\d,]+/);
    await earnings.getByText(/^Tickets behind it/).click();
    const tickets = earnings.getByRole("table", { name: "My tickets" });
    await expect(tickets.getByTestId("pay-ticket").first()).toBeVisible();
    // No links into sales, and no payroll page.
    await expect(tickets.getByRole("link")).toHaveCount(0);
    await page.goto("/payroll");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
