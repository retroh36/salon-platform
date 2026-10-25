import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, signIn, test, waitForHydration } from "./fixtures";

// Commission plans on Settings → Commission, and a stylist's live
// earnings on My day, which add up to what Payroll pays.

const B = SEED.business;
const RUN = Date.now().toString(36);

test.afterAll(async () => {
  await admin.from("commission_plans").delete().eq("business_id", B).like("name", `Tiers ${RUN}%`);
});

test.describe("as the owner", () => {
  test.use({ storageState: AUTH.owner });

  test("adds a retroactive tiered plan with a back-bar fee, and removes it", async ({ page }) => {
    await page.goto("/settings/commission");
    await waitForHydration(page, "form[aria-label='New plan'] button[type=submit]");
    await expect(page.getByTestId("commission-plan").filter({ hasText: "Senior tiers" })).toContainText(
      "Services 40% to $4,000, 45% to $8,000, then 50%; retail 15%, $3 back-bar fee per service; each dollar at its tier's rate, starting again each month",
    );
    const form = page.getByRole("form", { name: "New plan" });
    await form.getByLabel("Plan name").fill(`Tiers ${RUN}`);
    await form.getByLabel("Services %").fill("38");
    await form.getByRole("button", { name: "Add a services tier" }).click();
    await form.getByLabel("Tier 2 from ($)").fill("5000");
    await form.getByLabel("Tier 2 %").first().fill("44");
    await form.getByLabel("Back-bar fee").selectOption("percent");
    await form.getByLabel("Percent (%)").fill("4");
    await form.getByLabel("Tiers start again").selectOption("month");
    // The preview follows the style: marginal, then retroactive.
    await expect(form.getByTestId("tier-example")).toHaveText("For example, $6,300 in services in a month pays $2,472 before back-bar fees.");
    await form.getByLabel("How tiers pay").selectOption("retroactive");
    await expect(form.getByTestId("tier-example")).toHaveText("For example, $6,300 in services in a month pays $2,772 before back-bar fees.");
    // No booth rent any more.
    await expect(form.getByLabel("How they’re paid").locator("option")).toHaveText(["Commission", "Hourly"]);
    await form.getByRole("button", { name: "Add plan" }).click();
    await expect(form.getByRole("status")).toHaveText("Plan added.");
    const plan = page.getByTestId("commission-plan").filter({ hasText: `Tiers ${RUN}` });
    await expect(plan).toContainText("Services 38% to $5,000, then 44%; retail 10%, 4% back-bar fee per service; reaching a tier pays all of the month's sales at its rate, starting again each month");

    // Gil is on Senior tiers; everyone else on their own rates.
    await expect(page.getByLabel("Gil Navarro's plan")).toHaveValue("e1000000-0000-4000-8000-000000000001");
    await expect(page.getByLabel("Bridget Callahan's plan").locator("option:checked")).toHaveText(/^Own rates: 50% services, 15% retail$/);

    page.once("dialog", (d) => d.accept());
    await plan.getByRole("button", { name: `Remove Tiers ${RUN}` }).click();
    await expect(plan).toHaveCount(0);
  });
});

test.describe("as a stylist on a plan", () => {
  test("sees running totals that match what Payroll pays", async ({ page }) => {
    await signIn(page, "gil@mapleandash.test");
    await page.goto("/my-day");
    const live = page.getByTestId("live-earnings");
    await expect(live.getByRole("heading", { name: "Today’s earnings" })).toBeVisible();
    await expect(live).toContainText("On Senior tiers.");
    await expect(live.getByLabel("Running totals")).toContainText("This pay period");
    const period = await live.getByTestId("earned-this-pay-period").innerText();

    // My earnings, worked out by Payroll's own code, says the same (Gil has no hours).
    await expect(page.getByTestId("my-pay-total")).toHaveText(period);
  });
});
