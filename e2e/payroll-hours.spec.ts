import { addDays, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Which hours pay people paid by the hour: the owner chooses on Settings →
// Payroll (logged in the Audit trail), and Payroll shows scheduled and
// clocked hours side by side. Puts the setting back after.
const B = SEED.business;
const started = new Date().toISOString();

test.afterAll(async () => {
  await admin.from("businesses").update({ payroll_hours: "scheduled" }).eq("id", B);
  await admin.from("payroll_hours_changes").delete().eq("business_id", B).gte("created_at", started);
});

test.describe("an owner", () => {
  test.use({ storageState: AUTH.owner });

  test("pays clocked hours, sees both on Payroll, and finds the change in the Audit trail", async ({ page }) => {
    await page.goto("/settings/payroll");
    await waitForHydration(page, "form[aria-label='Hours for hourly pay'] input[type=radio]");
    const form = ui(page).getByRole("form", { name: "Hours for hourly pay" });
    await expect(form.getByLabel(/^Scheduled hours/)).toBeChecked();
    await form.getByLabel(/^Clocked hours/).check();
    await form.getByRole("button", { name: "Save hours" }).click();
    await expect(form.getByText("Clocked hours pay from now on, for every period you open.")).toBeVisible();
    await page.reload();
    await expect(ui(page).getByRole("list", { name: "Changes to hours for hourly pay" })).toContainText("Clocked hours from");

    // The last two weeks, which the demo's punches cover.
    const today = todayIn("America/Chicago");
    await page.goto(`/payroll?from=${addDays(today, -13)}&to=${addDays(today, -1)}`);
    const sam = ui(page).getByTestId("hours-line").and(page.locator(`[data-staff-id="${SEED.staff.frontDesk}"]`));
    await expect(sam.getByTestId("hours-scheduled")).toHaveText(/^\d+(\.\d+)? hr$/);
    await expect(sam.getByTestId("hours-clocked")).toHaveText(/^\d+(\.\d+)? hr$/);
    await expect(sam.getByTestId("hours-difference")).toHaveText(/hr$/);
    await expect(sam.getByTestId("hours-paid")).toContainText("clocked");

    await page.goto(`/audit?type=pay&from=${today}&to=${today}`);
    await expect(ui(page).getByTestId("audit-table")).toContainText("Hourly pay changed from scheduled hours to clocked hours");
  });
});

test.describe("a manager", () => {
  test.use({ storageState: AUTH.manager });

  test("sees which hours pay but can't change it", async ({ page }) => {
    await page.goto("/settings/payroll");
    const form = ui(page).getByRole("form", { name: "Hours for hourly pay" });
    await expect(form.getByText("Only owners change this.")).toBeVisible();
    await expect(form.getByRole("button", { name: "Save hours" })).toHaveCount(0);
  });
});
