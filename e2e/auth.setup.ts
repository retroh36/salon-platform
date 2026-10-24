import { test as setup } from "@playwright/test";
import { requireDemoData } from "../tests/db/helpers";
import { AUTH, signIn } from "./fixtures";

// The tests expect the busy demo month on top of the default seed.
setup("demo data is loaded", requireDemoData);

setup("sign in as owner", async ({ page }) => {
  await signIn(page, "owner@mapleandash.test");
  await page.context().storageState({ path: AUTH.owner });
});

setup("sign in as manager", async ({ page }) => {
  await signIn(page, "manager@mapleandash.test");
  await page.context().storageState({ path: AUTH.manager });
});

setup("sign in as front desk", async ({ page }) => {
  await signIn(page, "frontdesk@mapleandash.test");
  await page.context().storageState({ path: AUTH.frontDesk });
});

setup("sign in at the large salon", async ({ page }) => {
  await signIn(page, "owner@harborvine.test");
  await page.context().storageState({ path: AUTH.largeOwner });
  await page.context().clearCookies();
  await signIn(page, "frontdesk@harborvine.test");
  await page.context().storageState({ path: AUTH.largeFrontDesk });
});

setup("sign in as stylist", async ({ page }) => {
  await signIn(page, "bridget@mapleandash.test");
  await page.context().storageState({ path: AUTH.stylist });
});
