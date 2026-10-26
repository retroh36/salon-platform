import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, waitForHydration } from "./fixtures";

const B = SEED.business;
const NAME = "Maple & Ash Hair Studio";

async function restore() {
  const { data } = await admin.from("businesses").select("logo_path").eq("id", B).single();
  if (data?.logo_path) await admin.storage.from("salon-logos").remove([data.logo_path]);
  await admin.from("businesses").update({ name: NAME, logo_path: null }).eq("id", B);
}

test.describe("signed out", () => {
  test("the login screen is Maestra's", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle("Sign in · Maestra");
    await expect(page.getByRole("img", { name: "Maestra" }).first()).toBeVisible();
  });
});

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });
  test.beforeEach(restore);
  test.afterAll(restore);

  test("the salon's brand sits on top of Maestra's, and owners set it in Settings", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveTitle("Dashboard · Maestra");
    const sidebar = page.locator("aside").first();
    await expect(sidebar.getByTestId("salon-initial")).toHaveText("M");
    await expect(sidebar).toContainText(NAME);
    await expect(sidebar.getByTestId("powered-by")).toHaveText("Powered byMaestra");

    await sidebar.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveTitle("Your salon · Maestra");
    await waitForHydration(page, "form[aria-label='Salon logo']");
    const name = page.getByRole("form", { name: "Salon name" });
    await name.getByLabel("Salon name").fill("Willow & Co");
    await name.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved the salon's name.");
    await expect(sidebar).toContainText("Willow & Co");
    await expect(sidebar.getByTestId("salon-initial")).toHaveText("W");

    const logo = page.getByRole("form", { name: "Salon logo" });
    await logo.getByLabel("Logo").setInputFiles("public/brand/maestra/maestra-mark.png");
    await logo.getByRole("button", { name: "Upload logo" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved the salon's logo.");
    await expect(sidebar.getByTestId("salon-logo")).toBeVisible();
    const src = await sidebar.getByTestId("salon-logo").getAttribute("src");
    expect((await page.request.get(src!)).status()).toBe(200);

    await logo.getByRole("button", { name: "Remove logo" }).click();
    await expect(page.getByRole("status")).toHaveText("Removed the logo. The salon's initial shows instead.");
    await expect(sidebar.getByTestId("salon-initial")).toHaveText("W");
  });

  test("won't take a file that isn't an image", async ({ page }) => {
    await page.goto("/settings");
    await waitForHydration(page, "form[aria-label='Salon logo']");
    const logo = page.getByRole("form", { name: "Salon logo" });
    await logo.getByLabel("Logo").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await logo.getByRole("button", { name: "Upload logo" }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText("Use a PNG, JPEG or WebP image.");
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("doesn't see Settings", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("aside").first().getByRole("link", { name: "Settings" })).toHaveCount(0);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
