import { AUTH, expect, test, ui } from "./fixtures";

// The style guide (/design): owners only, not in the sidebar, every shared
// component drawn, and Denise's lists as real lists.

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("sees every component on the style guide", async ({ page }) => {
    await page.goto("/design");
    await expect(ui(page).getByRole("heading", { level: 1, name: "Style guide" })).toBeVisible();
    for (const section of ["Type", "Color", "Buttons", "Fields", "Tabs and choices", "Tags and statuses", "Stats", "Tables", "Cards and sections", "Alerts, empty and loading", "Toast", "Denise"]) {
      await expect(ui(page).getByRole("heading", { level: 2, name: section, exact: true })).toBeVisible();
    }
    // Denise's answer: a bullet list with bold names, no raw hyphens or asterisks.
    const answer = ui(page).getByRole("list").filter({ hasText: "Ava" });
    await expect(answer.getByRole("listitem")).toHaveCount(3);
    await expect(answer.locator("strong").first()).toHaveText("Ava");
    await expect(ui(page).getByText(/^- |\*\*/)).toHaveCount(0);
    // Hidden: not in the sidebar.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Style guide" })).toHaveCount(0);
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("is sent to the Dashboard", async ({ page }) => {
    await page.goto("/design");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
