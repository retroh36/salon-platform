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

test("signing in shows the location's staff, and signing out ends the session", async ({ page }) => {
  await signIn(page, "owner@mapleandash.test");
  await expect(ui(page).getByRole("heading", { name: "Maple & Ash Downtown" })).toBeVisible();
  await expect(ui(page).getByRole("heading", { name: "Staff (9)" })).toBeVisible();
  await expect(ui(page).getByText("Olivia Bennett(you)")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/login");
});
