import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const NAME = "E2E Apprentice";

// Maple & Ash's four levels as seeded, whatever a failed run left.
async function putBack() {
  await admin.from("staff_levels").delete().eq("business_id", SEED.business).like("name", "E2E%");
  const seeded = ["master", "senior", "artisan", "junior"];
  for (const [i, key] of seeded.entries()) await admin.from("staff_levels").update({ position: 100 + i }).eq("business_id", SEED.business).eq("key", key);
  for (const [i, key] of seeded.entries()) await admin.from("staff_levels").update({ position: i }).eq("business_id", SEED.business).eq("key", key);
}

const rows = (page: import("@playwright/test").Page) => ui(page).getByRole("list", { name: "Levels, most senior first" }).getByRole("listitem");

test.describe("owners", () => {
  test.use({ storageState: AUTH.owner });
  test.beforeAll(putBack);
  test.afterAll(putBack);

  test("add a level with its own color and badge, put it in order, then remove it", async ({ page }) => {
    await page.goto("/settings/levels");
    await waitForHydration(page, "main button");
    await expect(rows(page)).toHaveText([/Master.*3 stylists/, /Senior.*2 stylists/, /Artisan.*1 stylist/, /Junior stylist.*1 stylist/]);
    await expect(rows(page).filter({ hasText: "Junior stylist" }).locator("[data-level-badge=junior]")).toHaveAttribute("data-color", "blue");

    // A level someone is on can't be removed.
    await rows(page).filter({ hasText: "Junior stylist" }).getByRole("button", { name: "Edit" }).click();
    const junior = ui(page).getByRole("region", { name: "Edit Junior stylist" });
    await expect(junior.getByRole("button", { name: "Remove level" })).toBeDisabled();
    await expect(junior).toContainText("1 stylist is on this level.");
    await rows(page).filter({ hasText: "Junior stylist" }).getByRole("button", { name: "Done" }).click();

    // A new one, in violet with a diamond, above Junior stylist.
    await ui(page).getByRole("button", { name: "Add a level" }).click();
    await ui(page).getByRole("region", { name: "Edit new level" }).getByLabel("Name").fill(NAME);
    // The panel takes the level's name as it's typed.
    const editor = ui(page).getByRole("region", { name: `Edit ${NAME}` });
    await editor.getByRole("radio", { name: "Violet" }).click();
    await editor.getByRole("radio", { name: "Diamond" }).click();
    await ui(page).getByRole("button", { name: `Move ${NAME} up` }).click();
    await ui(page).getByRole("button", { name: "Save levels" }).click();
    await expect(ui(page).getByText("Saved.")).toBeVisible();

    await page.reload();
    await waitForHydration(page, "main button");
    await expect(rows(page)).toHaveText([/Master/, /Senior/, /Artisan/, new RegExp(`${NAME}.*No one yet`), /Junior stylist/]);
    const { data } = await admin.from("staff_levels").select("key, color, symbol, position").eq("business_id", SEED.business).eq("name", NAME).single();
    expect(data).toEqual({ key: "e2e_apprentice", color: "violet", symbol: "diamond", position: 3 });

    // It's in the calendar's Key, in its place.
    await page.goto("/calendar");
    await ui(page).getByRole("button", { name: "Key" }).click();
    const legend = ui(page).getByTestId("level-legend");
    await expect(legend).toHaveText(new RegExp(`Master.*Senior.*Artisan.*${NAME}.*Junior stylist`));
    await expect(legend.locator("[data-level-badge=e2e_apprentice]")).toHaveAttribute("data-color", "violet");

    // Nobody's on it, so it can go.
    await page.goto("/settings/levels");
    await waitForHydration(page, "main button");
    await rows(page).filter({ hasText: NAME }).getByRole("button", { name: "Edit" }).click();
    await ui(page).getByRole("region", { name: `Edit ${NAME}` }).getByRole("button", { name: "Remove level" }).click();
    await ui(page).getByRole("button", { name: "Save levels" }).click();
    await expect(ui(page).getByText("Saved.")).toBeVisible();
    await expect(rows(page)).toHaveCount(4);
  });
});

test.describe("the front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("can't open Levels", async ({ page }) => {
    await page.goto("/settings/levels");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
