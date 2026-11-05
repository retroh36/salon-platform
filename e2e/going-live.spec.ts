import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Settings → Messages: texts and email show as not connected on this test
// server, Go live can't be turned on (it never sends from here), and a test
// lands in the outbox. Only owners see the controls.

const ADDRESS = `golive-${Date.now().toString(36)}@example.com`;

test.afterAll(async () => {
  await admin.from("outbox_messages").delete().eq("to_address", ADDRESS);
});

test("an owner sees the status, can't go live here, and a test goes to the outbox", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.owner });
  await page.goto("/settings/messages");
  await waitForHydration(page, "[data-testid=messages-connection]");
  const card = ui(page).getByTestId("messages-connection");
  await expect(card.getByTestId("texts-status")).toHaveText("Not connected");
  await expect(card.getByTestId("email-status")).toHaveText("Not connected");
  await expect(card.getByTestId("messages-live")).toHaveText("Not yet");
  await expect(card.getByRole("button", { name: "Go live" })).toBeDisabled();
  await expect(card).toContainText("This is a test server, so nothing real is ever sent or charged.");

  const test = card.getByRole("form", { name: "Send a test" });
  await test.getByRole("radio", { name: "Email" }).click();
  await test.getByLabel("Your email").fill(ADDRESS);
  await test.getByRole("button", { name: "Send test" }).click();
  await expect(test.getByRole("status")).toHaveText("This copy never sends real messages, so the test went to the outbox.");
  const { data } = await admin.from("outbox_messages").select("status, business_id, body").eq("to_address", ADDRESS).single();
  expect(data).toMatchObject({ status: "held", business_id: SEED.business });
  expect(data?.body).toContain("This is a test from Maestra");
  await page.close();
});

test("a manager sees the status without the controls", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.manager });
  await page.goto("/settings/messages");
  const card = ui(page).getByTestId("messages-connection");
  await expect(card.getByTestId("texts-status")).toHaveText("Not connected");
  await expect(card.getByRole("button", { name: "Go live" })).toHaveCount(0);
  await expect(card.getByRole("form", { name: "Send a test" })).toHaveCount(0);
  await expect(card).toContainText("Only owners go live or send a test.");
  await page.close();
});
