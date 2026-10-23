import { todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const L = SEED.location;

test.afterAll(async () => {
  await admin.from("cash_closeouts").delete().eq("location_id", L);
});

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("sees what's owed, gift card activity, and closes out the day", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator("aside").first().getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL("/reports");
    const main = ui(page);
    await expect(main.getByTestId("gift-card-liability")).toHaveText(/^\$[\d,.]+$/);
    await expect(main.getByTestId("package-liability")).toHaveText(/^\$[\d,.]+$/);
    await expect(main.getByTestId("liabilities")).toContainText("no cash value");
    await main.getByRole("link", { name: "Last 30 days" }).click();
    await expect(page).toHaveURL("/reports?period=last_30_days");
    await expect(main.getByTestId("gift-cards-sold")).toHaveText(/^\$[\d,.]+$/);

    // Count the drawer: $5 more than expected.
    const expected = (await main.getByTestId("expected-cash").textContent())!;
    const cents = Math.round(Number(expected.replace(/[$,]/g, "")) * 100);
    await waitForHydration(page, "form[aria-label='Close out the day'] input");
    const form = main.getByRole("form", { name: "Close out the day" });
    await form.getByLabel("Cash counted ($)").fill(((cents + 500) / 100).toFixed(2));
    await form.getByRole("button", { name: "Save count" }).click();
    await expect(form.getByRole("status")).toHaveText("Saved. The drawer is $5 over.");
    const { data } = await admin.from("cash_closeouts").select("expected_cents, counted_cents").eq("location_id", L).eq("day", todayIn("America/Chicago")).single();
    expect(data).toEqual({ expected_cents: cents, counted_cents: cents + 500 });
  });
});

for (const [who, auth] of [
  ["front desk", AUTH.frontDesk],
  ["stylist", AUTH.stylist],
] as const) {
  test.describe(who, () => {
    test.use({ storageState: auth });

    test("doesn't see reports", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(page.locator("aside").first().getByRole("link", { name: "Reports" })).toHaveCount(0);
      await page.goto("/reports");
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  });
}
