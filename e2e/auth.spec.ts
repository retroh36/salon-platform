import { countFor, SEED } from "../tests/db/helpers";
import { expect, signIn, test, ui, waitForHydration } from "./fixtures";

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/login");
  await page.goto("/services");
  await expect(page).toHaveURL("/login");
});

test("a wrong password shows an error and keeps the email", async ({ page }) => {
  await page.goto("/login");
  await waitForHydration(page, "input[name=email]");
  await ui(page).getByLabel("Email").fill("owner@mapleandash.test");
  await ui(page).getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(ui(page).getByRole("alert")).toHaveText("That email and password don't match.");
  await expect(ui(page).getByLabel("Email")).toHaveValue("owner@mapleandash.test");
  await expect(page).toHaveURL("/login");
});

test("signing in greets you on the Dashboard, the team is under Team, and signing out ends the session", async ({ page }) => {
  await signIn(page, "owner@mapleandash.test");
  await expect(ui(page).getByRole("heading", { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Olivia$/);
  await page.locator("aside").first().getByRole("link", { name: "Team" }).click();
  await expect(page).toHaveURL("/team");
  await expect(ui(page).getByRole("heading", { name: `Staff (${await countFor("staff", SEED.business, SEED.location)})` })).toBeVisible();
  await expect(ui(page).getByText("Olivia Bennett(you)")).toBeVisible();

  // Signing out while the page's links are still prefetching would answer
  // them signed out: sent on to sign-in, which has no such page (a 404 in
  // the console). A person never signs out that fast.
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/login");
});
