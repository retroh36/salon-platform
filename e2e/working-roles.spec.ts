import { formatDay } from "@/lib/schedule-format";
import { addDays, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Settings → Working roles, and the card on a team member's page that says
// which roles they work. Each run makes its own role and removes it after.
const NAME = "E2E Wash House";

// Five weeks out, a Thursday: Jordan's on the front desk, with no clients.
const week = addDays(startOfWeek(todayIn("America/Chicago")), 35);
const thursday = addDays(week, 3);

async function putBack() {
  await admin.from("schedule_drafts").delete().eq("staff_id", SEED.staff.jordan).gte("on_date", week).lte("on_date", addDays(week, 6));
  await admin.from("working_roles").delete().eq("business_id", SEED.business).like("name", "E2E %");
}

test.describe("owners", () => {
  test.use({ storageState: AUTH.owner });
  test.beforeAll(putBack);
  test.afterAll(putBack);

  test("add a role with its services and pay, then give it to Hannah", async ({ page }) => {
    await page.goto("/settings/roles");
    await waitForHydration(page, "main button");
    await ui(page).getByRole("button", { name: "Add a role" }).click();
    const form = ui(page).getByRole("region", { name: "New role" });
    await form.getByLabel("Name").fill(NAME);
    await form.getByLabel("Clients can book this time online").uncheck();
    await form.getByLabel("Only these").check();
    await form.getByLabel("Blowout", { exact: true }).check();
    await form.getByLabel("How this time is paid").selectOption("hourly");
    await form.getByLabel("Hourly rate ($)").fill("18");
    await form.getByRole("button", { name: "Save role" }).click();

    const list = ui(page).getByRole("list", { name: "Working roles" });
    const row = list.getByRole("listitem").filter({ hasText: NAME });
    await expect(row).toContainText("Not online");
    await expect(row).toContainText("Blowout · Hourly · $18 · 0 people");

    // Hannah's page: tick it.
    await page.goto(`/team/${SEED.staff.hannah}`);
    const card = ui(page).getByRole("region", { name: "Working roles" });
    await card.getByLabel(NAME).check();
    await expect(card).toContainText("Saved. Their shifts can be given these roles.");
    await page.goto("/settings/roles");
    await expect(ui(page).getByRole("list", { name: "Working roles" }).getByRole("listitem").filter({ hasText: NAME })).toContainText("1 person");

    // Removing it takes it off the list.
    await ui(page).getByRole("button", { name: `Edit ${NAME}` }).click();
    await ui(page).getByRole("button", { name: "Remove role" }).click();
    await expect(ui(page).getByText("Removed.")).toBeVisible();
    await expect(ui(page).getByRole("button", { name: `Edit ${NAME}` })).toHaveCount(0);
  });
});

test.describe("Scheduling", () => {
  test.use({ storageState: AUTH.manager });
  test.beforeAll(putBack);
  test.afterAll(putBack);

  test("give a shift its working role, shown on the week", async ({ page }) => {
    const { data: role } = await admin.from("working_roles").insert({ business_id: SEED.business, name: "E2E Front of house" }).select("id").single();
    await admin.from("staff_working_roles").insert({ business_id: SEED.business, staff_id: SEED.staff.jordan, role_id: role!.id });

    await page.goto(`/scheduling?week=${week}`);
    await waitForHydration(page, "[data-testid=team-schedule] button[data-shift]");
    const grid = ui(page).getByTestId("team-schedule");
    await grid.getByRole("button", { name: new RegExp(`^Edit Jordan's hours on ${formatDay(thursday)}`) }).click({ position: { x: 4, y: 4 } });
    const editor = ui(page).getByRole("dialog", { name: `Jordan · ${formatDay(thursday)}` });
    await editor.getByLabel(/shift 1 role/).selectOption({ label: "E2E Front of house" });
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toHaveCount(0);

    const cell = grid.locator(`[data-staff="${SEED.staff.jordan}"][data-date="${thursday}"]`);
    await expect(cell).toHaveAttribute("data-draft", "true");
    await expect(cell).toContainText("E2E Front of house");
    // Saved to the draft (the week shows it at once, before the save is back).
    await expect
      .poll(async () => {
        const { data } = await admin.from("schedule_drafts").select("shifts").eq("staff_id", SEED.staff.jordan).eq("on_date", thursday).maybeSingle();
        return (data?.shifts as { role?: string }[] | undefined)?.[0]?.role;
      })
      .toBe(role!.id);
  });
});

test.describe("Payroll", () => {
  test.use({ storageState: AUTH.owner });

  test("pays the demo's roles their own way, by working role", async ({ page }) => {
    // The demo: Lois on Wash House (hourly) Friday mornings and Beauty Bar (commission) after.
    await page.goto("/payroll");
    const table = ui(page).getByRole("table", { name: "Pay by working role" });
    const wash = table.getByRole("row").filter({ hasText: "Lois" }).filter({ hasText: "Wash House" });
    await expect(wash).toContainText("Hourly");
    await expect(wash).toContainText(/\$\d/);
    await expect(table.getByRole("row").filter({ hasText: "Lois" }).filter({ hasText: "Beauty Bar" })).toContainText("Commission");
  });
});

test.describe("the front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("can't open Working roles", async ({ page }) => {
    await page.goto("/settings/roles");
    await expect(page).not.toHaveURL(/\/settings\/roles/);
  });
});
