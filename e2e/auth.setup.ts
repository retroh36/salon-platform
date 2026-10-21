import { test as setup } from "@playwright/test";
import { AUTH, signIn } from "./fixtures";

setup("sign in as owner", async ({ page }) => {
  await signIn(page, "owner@mapleandash.test");
  await page.context().storageState({ path: AUTH.owner });
});

setup("sign in as front desk", async ({ page }) => {
  await signIn(page, "frontdesk@mapleandash.test");
  await page.context().storageState({ path: AUTH.frontDesk });
});

setup("sign in as stylist", async ({ page }) => {
  await signIn(page, "priya@mapleandash.test");
  await page.context().storageState({ path: AUTH.stylist });
});
