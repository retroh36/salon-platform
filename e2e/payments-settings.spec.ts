import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Settings → Payments: not connected on this test server, and Connect
// can't be used here (nothing real is ever charged). Only owners see the
// controls; the card forms stay on test cards.

test("an owner sees Not connected, and can't connect from a test server", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.owner });
  await page.goto("/settings/payments");
  await waitForHydration(page, "[data-testid=payments-connection]");
  const card = ui(page).getByTestId("payments-connection");
  await expect(card.getByTestId("payments-status")).toHaveText("Not connected");
  await expect(card.getByTestId("stripe-account")).toHaveText("None");
  await expect(card.getByTestId("payments-summary")).toContainText("Only test cards work");
  await expect(card.getByRole("button", { name: "Connect with Stripe" })).toBeDisabled();
  await expect(card).toContainText("Stripe isn't set up on Maestra yet.");
  await expect(ui(page).getByRole("link", { name: "Payments" })).toBeVisible();
  await page.close();
});

test("a manager sees the status without the controls", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.manager });
  await page.goto("/settings/payments");
  const card = ui(page).getByTestId("payments-connection");
  await expect(card.getByTestId("payments-status")).toHaveText("Not connected");
  await expect(card.getByRole("button", { name: "Connect with Stripe" })).toHaveCount(0);
  await expect(card).toContainText("Only owners connect Stripe or go live.");
  await page.close();
});
