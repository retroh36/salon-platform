import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, signIn, test, ui, waitForHydration } from "./fixtures";

// Permission groups: the owner makes one, puts Jordan (front desk) in it,
// and Jordan gets Reports. (Jordan, so it never races the tests that change
// Sam's switches.)

test.beforeAll(async () => {
  await admin.from("staff_permissions").delete().eq("staff_id", SEED.staff.jordan);
  await admin.from("permission_groups").delete().eq("business_id", SEED.business);
});

test.afterAll(async () => {
  await admin.from("staff_permissions").delete().eq("staff_id", SEED.staff.jordan);
  await admin.from("permission_groups").delete().eq("business_id", SEED.business);
});

test("the owner makes a group, copies it, and gives it to the front desk", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.owner });
  try {
    await page.goto("/team");
    const main = ui(page);
    await main.getByRole("navigation", { name: "Team pages" }).getByRole("link", { name: "Permissions" }).click();
    await expect(page).toHaveURL("/team/permissions");
    await waitForHydration(page, "main button");
    await main.getByRole("button", { name: "New group" }).click();
    const form = main.getByRole("form", { name: "New group" });
    await form.getByLabel("Name").fill("Senior front desk");
    await form.getByLabel("Reports and past sales").selectOption("on");
    await form.getByRole("button", { name: "Add group" }).click();
    const card = main.getByRole("region", { name: "Senior front desk" });
    await expect(card.getByTestId("group-summary")).toHaveText("Turns on Reports and past sales");
    await card.getByRole("button", { name: "Copy" }).click();
    await expect(main.getByRole("region", { name: "Senior front desk (copy)" })).toBeVisible();

    await page.goto(`/team/${SEED.staff.jordan}`);
    await waitForHydration(page, "select");
    await main.getByLabel("Permission group").selectOption({ label: "Senior front desk" });
    await expect(main.getByRole("region", { name: "What they can do" }).getByRole("status")).toContainText("Saved");
    await page.reload();
    await expect(main.getByTestId("permissions")).toContainText("(from Senior front desk)");
  } finally {
    await page.close();
  }

  const desk = await browser.newPage();
  try {
    await signIn(desk, "jordan@mapleandash.test", "/calendar");
    await desk.goto("/dashboard");
    await expect(desk.locator("aside").first().getByRole("link", { name: "Reports" })).toBeVisible();
  } finally {
    await desk.close();
  }
});

test("only owners see Permissions", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.manager });
  try {
    await page.goto("/team");
    await expect(ui(page).getByRole("navigation", { name: "Team pages" }).getByRole("link", { name: "Permissions" })).toHaveCount(0);
    await page.goto("/team/permissions");
    await expect(page).toHaveURL(/\/team$/);
  } finally {
    await page.close();
  }
});
