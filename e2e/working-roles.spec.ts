import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Settings → Working roles, and the card on a team member's page that says
// which roles they work. Each run makes its own role and removes it after.
const NAME = "E2E Wash House";

async function putBack() {
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

test.describe("the front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("can't open Working roles", async ({ page }) => {
    await page.goto("/settings/roles");
    await expect(page).not.toHaveURL(/\/settings\/roles/);
  });
});
