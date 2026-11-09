import { canSendAt } from "../lib/automations";
import { encodeReport, EMPTY_REPORT } from "../lib/client-reports";
import { toLocal } from "../lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// A manager writes a campaign for a list from a client report.
const TAG = `Cmp${Date.now().toString(36)}`;
let clientId: string;

test.use({ storageState: AUTH.manager });

test.beforeAll(async () => {
  const { data } = await admin.from("clients").insert({ business_id: SEED.business, first_name: TAG, last_name: "Test", email: `${TAG.toLowerCase()}@example.com`, email_opt_in: true }).select("id").single();
  clientId = data!.id;
});

test.afterAll(async () => {
  const { data: sent } = await admin.from("campaigns").select("id").eq("name", TAG);
  const ids = (sent ?? []).map((c) => c.id);
  const { data: messages } = await admin.from("marketing_messages").select("outbox_message_id").in("campaign_id", ids);
  await admin.from("client_messages").delete().in("campaign_id", ids);
  await admin.from("marketing_messages").delete().in("campaign_id", ids);
  await admin.from("outbox_messages").delete().in("id", (messages ?? []).map((m) => m.outbox_message_id!));
  await admin.from("campaigns").delete().in("id", ids);
  await admin.from("clients").delete().eq("id", clientId);
});

test("writes one with a preview, and sends it once after asking", async ({ page }) => {
  // Everyone on file with at most no visits: this client among them.
  await page.goto(`/campaigns/new?r=${encodeReport({ ...EMPTY_REPORT, maxVisits: 0 })}`);
  await expect(ui(page).getByTestId("campaign-audience")).toContainText("will get this.");
  await waitForHydration(page, "textarea");
  await page.getByLabel("Name (only your team sees this)").fill(TAG);
  await page.getByLabel("Message", { exact: false }).last().fill("Hello {first_name}, a note from {salon}.");
  await expect(page.getByTestId("campaign-preview")).toContainText("a note from Maple & Ash");
  const send = page.getByRole("button", { name: /^Send to \d+ client/ });
  if (!canSendAt(toLocal(new Date(), "America/Chicago").minute)) {
    await expect(send).toBeDisabled();
    await expect(page.getByText("Campaigns go out between 9am and 8pm at the salon.")).toBeVisible();
    return;
  }
  await send.click();
  await page.getByRole("button", { name: "Yes, send it" }).click();
  await expect(page).toHaveURL(/\/campaigns\?sent=\d+/);
  await expect(ui(page).getByTestId("campaign-row").filter({ hasText: TAG })).toBeVisible();
  await expect
    .poll(async () => (await admin.from("marketing_messages").select("id").eq("client_id", clientId).eq("kind", "campaign")).data?.length)
    .toBe(1);
});
