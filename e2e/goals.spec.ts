import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Goals with pacing: Bridget's own on My day and her Dashboard, with
// Denise's alert (from the demo: a monthly service revenue goal the owner
// set, and her own 70% rebooking goal), and the owners' team view.

const { bridget: BRIDGET, hannah: HANNAH } = SEED.staff;

test.afterEach(async () => {
  await admin.from("staff").update({ goal_alerts: "daily", goal_alert_seen_on: null }).eq("id", BRIDGET);
  await admin.from("staff_goals").delete().in("staff_id", [BRIDGET, HANNAH]).in("metric", ["new_clients", "average_ticket"]);
  await admin.from("goal_celebrations").delete().eq("staff_id", BRIDGET);
});

test.describe("stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("sees her goals paced on My day, with Denise's alert, sets one and chooses weekly check-ins", async ({ page }) => {
    await page.goto("/my-day");
    await waitForHydration(page, "[data-testid=my-goals] select");
    const goals = ui(page).getByTestId("my-goals");
    const alert = goals.getByTestId("goal-alert");
    await expect(alert).toBeVisible();
    // Her line on the revenue goal, from our numbers.
    await expect(alert).toContainText(/(You're (on pace|ahead|a little behind)|Goal hit) — \$[\d,]+ of \$9,000/);
    await expect(alert).toContainText(/rebooked against your 70% goal|No checkouts yet/);

    const revenue = goals.getByTestId("goal").filter({ hasText: "Service revenue" });
    await expect(revenue.getByTestId("goal-status")).toHaveText(/^(Ahead|On pace|Behind|Goal hit)$/);
    await expect(revenue.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /of \$9,000$/);
    // The owner set it: hers to see, not to remove.
    await expect(revenue).toContainText("Set by the owner.");
    await expect(revenue.getByRole("button", { name: /Remove/ })).toHaveCount(0);
    await expect(goals.getByTestId("goal").filter({ hasText: "Rebooking" }).getByRole("button", { name: /Remove/ })).toBeVisible();

    // Got it: away until tomorrow.
    await alert.getByRole("button", { name: "Got it" }).click();
    await expect(goals.getByTestId("goal-alert")).toHaveCount(0);
    await page.reload();
    await expect(ui(page).getByTestId("my-goals").getByTestId("goal")).not.toHaveCount(0);
    await expect(ui(page).getByTestId("goal-alert")).toHaveCount(0);

    // A goal of her own.
    await goals.getByRole("button", { name: "Set a goal" }).click();
    const form = goals.getByRole("form", { name: "Set a goal" });
    await form.getByLabel("Goal").selectOption("new_clients");
    await form.getByLabel("Each").selectOption("week");
    await form.getByLabel("Target").fill("0");
    await form.getByRole("button", { name: "Save goal" }).click();
    await expect(form.getByRole("alert")).toHaveText("Enter a number from 1 up.");
    await form.getByLabel("Target").fill("3");
    await form.getByRole("button", { name: "Save goal" }).click();
    const fresh = goals.getByTestId("goal").filter({ hasText: "New clients" });
    await expect(fresh.getByTestId("goal-progress")).toHaveText(/^\d+ of 3$/);
    await expect(fresh.getByTestId("goal-line")).toContainText("new clients");

    await goals.getByLabel("Denise’s goal check-ins").selectOption("weekly");
    await expect.poll(async () => (await admin.from("staff").select("goal_alerts").eq("id", BRIDGET).single()).data!.goal_alerts).toBe("weekly");
  });

  test("sees her goals and Denise's alert on her Dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    const section = ui(page).getByTestId("dashboard-goals");
    await expect(section.getByTestId("goal-alert")).toBeVisible();
    await expect(section.getByRole("listitem").filter({ hasText: "Service revenue" })).toContainText("of $9,000");
    await expect(section.getByRole("link", { name: "See all on My day" })).toHaveAttribute("href", "/my-day#goals-heading");
  });
});

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("sees the team's goals and sets and removes one for a stylist", async ({ page }) => {
    await page.goto("/team/goals");
    await waitForHydration(page, "form, [data-testid=team-goal-row] button, button");
    const bridget = ui(page).getByTestId("team-goal-row").filter({ hasText: "Bridget" });
    const revenue = bridget.getByTestId("team-goal").filter({ hasText: "Service revenue" });
    await expect(revenue).toContainText("of $9,000");
    await expect(revenue).toContainText(/Bridget('s (on pace|ahead|a little behind)| hit the goal)/);

    await ui(page).getByRole("button", { name: "Set a goal" }).click();
    const form = ui(page).getByRole("form", { name: "Set a goal" });
    await form.getByLabel("For").selectOption({ label: "Hannah Novak" });
    await form.getByLabel("Goal").selectOption("average_ticket");
    await form.getByLabel("Target ($)").fill("140");
    await form.getByRole("button", { name: "Save goal" }).click();
    const hannah = ui(page).getByTestId("team-goal-row").filter({ hasText: "Hannah" });
    const ticket = hannah.getByTestId("team-goal").filter({ hasText: "Average ticket" });
    await expect(ticket).toContainText("of $140");
    await ticket.getByRole("button", { name: "Remove Hannah's average ticket goal" }).click();
    await expect(hannah.getByTestId("team-goal").filter({ hasText: "Average ticket" })).toHaveCount(0);
  });
});

test.describe("manager", () => {
  test.use({ storageState: AUTH.manager });

  test("sees the team's goals but doesn't set them", async ({ page }) => {
    await page.goto("/team/goals");
    await expect(ui(page).getByTestId("team-goal-row").filter({ hasText: "Bridget" }).getByTestId("team-goal").first()).toBeVisible();
    await expect(ui(page).getByRole("button", { name: "Set a goal" })).toHaveCount(0);
    await expect(ui(page).getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  });
});
