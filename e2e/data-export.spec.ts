import { unzip } from "@/lib/zip";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui } from "./fixtures";

// "Your data is yours": owners download everything as CSVs in one zip, and
// every download is logged.

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("downloads all the salon's data as CSV files in one zip, logged", async ({ page }) => {
    await page.goto("/settings/data");
    await expect(ui(page).getByRole("heading", { name: "Your data is yours" })).toBeVisible();
    const before = (await admin.from("data_exports").select("id", { count: "exact", head: true }).eq("business_id", SEED.business)).count!;

    const download = page.waitForEvent("download");
    await ui(page).getByRole("button", { name: "Download all data" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^maple-ash-hair-studio-data-\d{4}-\d{2}-\d{2}\.zip$/);
    const chunks = await (await file.createReadStream()).toArray();
    const files = unzip(Buffer.concat(chunks));
    expect(Object.keys(files)).toEqual([
      "README.txt",
      "clients.csv",
      "visits.csv",
      "formulas.csv",
      "sales.csv",
      "sale_lines.csv",
      "payments.csv",
      "tips.csv",
      "products.csv",
      "gift_cards.csv",
      "gift_card_history.csv",
      "packages.csv",
      "services.csv",
      "team.csv",
    ]);
    expect(files["clients.csv"].split("\r\n")[0]).toBe("﻿Client ID,First name,Last name,Email,Phone,Preferred stylist,Preferences,Notes,Allergies,Consent form signed,Texts OK,Marketing emails OK,Photo marketing consent,Added");
    expect(files["README.txt"]).toContain("Your data is yours");

    // Logged, and listed on the page.
    await expect.poll(async () => (await admin.from("data_exports").select("id", { count: "exact", head: true }).eq("business_id", SEED.business)).count).toBe(before + 1);
    await page.reload();
    await expect(ui(page).getByTestId("data-export").first()).toContainText(/by Olivia.*\d+ clients/);
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("can't export the salon's data", async ({ page }) => {
    await page.goto("/settings/data");
    await expect(page).toHaveURL(/\/dashboard$/);
    expect((await page.request.post("/settings/data/export")).status()).toBe(403);
  });
});
