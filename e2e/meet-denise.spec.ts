// Meet Denise (Settings → Denise): every role can open it, from Settings
// and from "What can Denise do?" in her header, and its sample questions
// open her chat with the question typed in, not sent.
import { busyDay } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

test.describe("an owner", () => {
  test.use({ storageState: AUTH.owner });

  test("finds it under Settings, with each section and an example", async ({ page }) => {
    await page.goto("/settings");
    await ui(page).getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Denise" }).click();
    await expect(page).toHaveURL(/\/settings\/denise$/);
    await expect(page.getByRole("heading", { name: "Denise is your salon’s brain." })).toBeVisible();
    // Nine sections after the intro (the fixes … the guardrails), then Try it.
    await expect(page.getByTestId("meet-denise-section")).toHaveCount(8);
    await expect(page.getByTestId("denise-example")).toHaveCount(7);
    await expect(page.getByTestId("coming-soon")).toContainText("live card payments");
    // The example buttons are drawings, not buttons.
    await expect(page.getByTestId("denise-example").getByRole("button")).toHaveCount(0);
  });

  test("a sample question opens her with it typed in, not sent", async ({ page }) => {
    await page.goto("/settings/denise");
    await waitForHydration(page, "[data-testid=meet-denise-try]");
    await page.getByTestId("try-denise").filter({ hasText: "How do I sell a gift card?" }).click();
    const box = page.getByRole("textbox", { name: "Message Denise" });
    await expect(box).toHaveValue("How do I sell a gift card?");
    await expect(box).toBeFocused();
    await expect(page.getByRole("region", { name: "Conversation with Denise" })).toHaveCount(0);
    // Her header has no link to the page she's already on.
    await expect(page.getByTestId("about-denise")).toHaveCount(0);
  });

  test("her card on the calendar links to it", async ({ page }) => {
    // A day with stylists on: today may be a day the salon is closed.
    await page.goto(`/calendar?date=${(await busyDay()).date}`);
    await waitForHydration(page, "section[data-staff-id]");
    await page.getByTestId("denise-launcher").click();
    await page.getByTestId("denise-card").getByTestId("about-denise").click();
    await expect(page).toHaveURL(/\/settings\/denise$/);
  });
});

test.describe("a stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("opens it from her bubble, with questions about their own book", async ({ page }) => {
    await page.goto("/my-day");
    await waitForHydration(page, "[data-testid=denise-bubble-launcher]");
    await page.getByTestId("denise-bubble-launcher").click();
    await page.getByTestId("denise-bubble").getByTestId("about-denise").click();
    await expect(page).toHaveURL(/\/settings\/denise$/);
    // Settings shows only this page to them.
    await expect(ui(page).getByRole("navigation", { name: "Settings" }).getByRole("link")).toHaveText(["Denise"]);
    await expect(page.getByTestId("try-denise")).toHaveText(["Which of my regulars are due back?", "How long do I usually take for a balayage?", "How much PTO do I have?"]);
  });
});
