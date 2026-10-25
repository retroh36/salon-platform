import { AUTH, expect, test } from "./fixtures";

// No blank screens or raw errors: an address that leads nowhere says so,
// and the error page's report is logged with its reference.

test.use({ storageState: AUTH.frontDesk });

test("an address that leads nowhere says so, with a way back", async ({ page, pageErrors }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  await page.getByRole("link", { name: "Go to the Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  // The 404 itself is the browser's one complaint.
  pageErrors.splice(0, pageErrors.length, ...pageErrors.filter((e) => !/404|Failed to load resource/.test(e)));
});

test("the error page's report is accepted only with a reference", async ({ request }) => {
  expect((await request.post("/api/client-error", { data: { ref: "E-ABC123", path: "/calendar", name: "TypeError", message: "x" } })).status()).toBe(204);
  expect((await request.post("/api/client-error", { data: { ref: "nope" } })).status()).toBe(400);
});
