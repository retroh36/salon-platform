import { addDays, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const TZ = "America/Chicago";
const started = new Date().toISOString();

// Maple & Ash tracks PTO in the demo seed (80 hours a year). Each test puts
// back what it changed.
test.afterAll(async () => {
  await admin.from("staff_time_off").delete().eq("business_id", B).gte("created_at", started);
  await admin.from("pto_adjustments").delete().eq("business_id", B).gte("created_at", started);
});

test.describe("a stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("sees their PTO and asks for vacation, which shows on Requests with the hours it uses", async ({ page, browser }) => {
    await page.goto("/time-off");
    await expect(ui(page).getByTestId("my-pto")).toContainText("Left to ask for");
    await waitForHydration(page, "form[aria-label='Request time off'] button[type=submit]");
    const form = ui(page).getByRole("form", { name: "Request time off" });
    await expect(form.getByLabel(/^Type/)).toContainText("Vacation (uses PTO)");
    // A Tuesday a few weeks out, when Bridget works.
    let day = addDays(todayIn(TZ), 21);
    while (new Date(`${day}T12:00:00Z`).getUTCDay() !== 2) day = addDays(day, 1);
    await form.getByLabel("First day").fill(day);
    await form.getByLabel(/^Type/).selectOption({ label: "Vacation (uses PTO)" });
    await form.getByRole("button", { name: "Request time off" }).click();
    await expect(form.getByText("Request sent.")).toBeVisible();
    await expect(ui(page).getByText(/^Vacation · /).first()).toBeVisible();

    const manager = await browser.newContext({ storageState: AUTH.manager });
    try {
      const m = await manager.newPage();
      await m.goto("/scheduling/requests");
      const { data: asked } = await admin.from("staff_time_off").select("id").eq("staff_id", SEED.staff.bridget).eq("starts_on", day).single();
      await expect(m.locator(`[data-request="${asked!.id}"]`).getByTestId("request-pto")).toHaveText(/^Uses \d+(\.\d+)? hr · leaves \d+(\.\d+)? hr$/);
    } finally {
      await manager.close();
    }
  });
});

test.describe("an owner", () => {
  test.use({ storageState: AUTH.owner });

  test("sees balances, adjusts one with a reason, and finds it in the statement and the Audit trail", async ({ page }) => {
    await page.goto("/scheduling/balances");
    const table = ui(page).getByTestId("pto-balances");
    await expect(ui(page).getByTestId("pto-policy")).toContainText("80 hr a year");
    await expect(table.locator(`[data-staff="${SEED.staff.shae}"]`)).toBeVisible();
    await expect(ui(page).getByTestId("time-off-taken")).toContainText("Vacation (PTO)");

    await table.getByRole("link", { name: "Gil Navarro" }).click();
    await expect(page).toHaveURL(`/scheduling/balances?staff=${SEED.staff.gil}`);
    await waitForHydration(page, "form[aria-label=\"Adjust Gil's balance\"] button[type=submit]");
    const form = ui(page).getByRole("form", { name: "Adjust Gil's balance" });
    await form.getByLabel("Hours").fill("4");
    await form.getByLabel("Reason").fill("Covered the holiday party");
    await form.getByRole("button", { name: "Save adjustment" }).click();
    await expect(form.getByRole("status")).toHaveText("Added 4 hr.");
    await expect(ui(page).getByTestId("pto-statement")).toContainText("Covered the holiday party");

    const today = todayIn(TZ);
    await page.goto(`/audit?type=pto&from=${today}&to=${today}`);
    await expect(ui(page).getByTestId("audit-table")).toContainText("PTO added for Gil Navarro: 4 hr");
  });

  test("adds a type of time off that doesn't use PTO", async ({ page }) => {
    const { data: before } = await admin.from("time_off_types").select("id, name, reason, uses_pto, position").eq("business_id", B).is("archived_at", null).order("position");
    try {
      await page.goto("/settings/time-off");
      await waitForHydration(page, "[data-testid=time-off-types] button");
      const types = ui(page).getByTestId("time-off-types");
      await types.getByRole("button", { name: "Add a type" }).click();
      const n = before!.length + 1;
      await types.getByLabel(`Type ${n} name`).fill("Jury duty");
      await types.getByRole("button", { name: "Save types" }).click();
      await expect(types.getByRole("status")).toHaveText("Types saved.");
      const { data } = await admin.from("time_off_types").select("uses_pto, reason").eq("business_id", B).eq("name", "Jury duty").is("archived_at", null).single();
      expect(data).toEqual({ uses_pto: false, reason: "other" });
    } finally {
      await admin.from("time_off_types").delete().eq("business_id", B).eq("name", "Jury duty");
    }
  });
});
