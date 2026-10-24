import { createHash, randomBytes } from "node:crypto";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Marketing automations: owners turn them on (or approve Denise's
// suggestion), edit the message with a live preview, and set the timing;
// clients opt out from the link in any message.

const B = SEED.business;

async function reset() {
  await admin.from("marketing_automations").delete().eq("business_id", B);
  await admin.from("ai_actions").delete().eq("business_id", B).eq("feature", "automation");
}

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });
  test.beforeEach(reset);
  test.afterAll(reset);

  test("approves Denise's suggestion to turn one on, and can undo it", async ({ page }) => {
    await page.goto("/settings/automations");
    const suggestions = ui(page).getByTestId("automation-suggestions");
    const rebook = suggestions.getByTestId("automation-suggestion").filter({ hasText: "Turn on rebook reminders" });
    await expect(rebook).toContainText(/^Turn on rebook reminders\d+ regulars are past their usual return with nothing booked\./);
    await waitForHydration(page, "[data-testid=automation-suggestions] button");
    await rebook.getByRole("button", { name: "Turn on" }).click();
    await expect(suggestions.getByRole("status")).toHaveText("Turned on.");
    await expect(ui(page).locator("[data-testid=automation][data-kind=rebook]")).toContainText("On");
    await rebook.getByRole("button", { name: "Undo" }).click();
    await expect(suggestions.getByRole("status")).toHaveText("Turned back off.");
    expect((await admin.from("marketing_automations").select("enabled").eq("business_id", B).eq("kind", "rebook").single()).data!.enabled).toBe(false);
    // Not now: she doesn't suggest it again.
    await suggestions.getByTestId("automation-suggestion").filter({ hasText: "review requests" }).getByRole("button", { name: "Not now" }).click();
    await page.reload();
    await expect(ui(page).getByTestId("automation-suggestion").filter({ hasText: "review requests" })).toHaveCount(0);
  });

  test("edits a message with a live preview, sets the timing, and turns it on", async ({ page }) => {
    await page.goto("/settings/automations");
    const card = ui(page).locator("[data-testid=automation][data-kind=birthday]");
    await waitForHydration(page, "[data-kind=birthday] textarea");
    const message = card.getByLabel("Message");
    const preview = card.getByTestId("automation-preview");
    await expect(preview).toContainText("Happy birthday, Ava! Everyone at Maple & Ash Hair Studio wishes you a wonderful day.");
    // A field it can't use stops it going on.
    await message.fill("Happy birthday, {first_name}! {discount}");
    await expect(card.getByTestId("automation-problems")).toHaveText("These aren't fields this message can use: {discount}.");
    await expect(card.getByRole("button", { name: "Turn on" })).toBeDisabled();
    await message.fill("Happy birthday, {first_name}! {offer} Book: {booking_link}");
    await card.getByLabel(/^Offer/).fill("Enjoy 15% off any service this month.");
    await card.getByLabel("Days before the birthday").fill("3");
    await expect(preview).toContainText(/^Happy birthday, Ava! Enjoy 15% off any service this month\. Book: .+\/book\/maple-and-ash\?src=birthday/);
    await expect(preview).toContainText("Reply STOP");
    await card.getByRole("radio", { name: "Email" }).click();
    await expect(preview).toContainText("Happy birthday from Maple & Ash Hair Studio");
    await expect(preview).toContainText("Don't want these emails? Unsubscribe:");
    await card.getByRole("button", { name: "Turn on" }).click();
    await expect(card.getByRole("status")).toHaveText("Saved. It's on.");
    const { data } = await admin.from("marketing_automations").select("enabled, body, settings").eq("business_id", B).eq("kind", "birthday").single();
    expect(data).toMatchObject({ enabled: true, body: "Happy birthday, {first_name}! {offer} Book: {booking_link}", settings: { daysBefore: 3, offer: "Enjoy 15% off any service this month." } });
    // Sending now (or the hours it waits for).
    await ui(page).getByRole("button", { name: "Send due messages now" }).click();
    await expect(ui(page).getByRole("region", { name: "Sending" }).getByRole("status")).toHaveText(/^Sent \d+|^Nothing is due right now\.$|outside sending hours/);
    await expect(card.getByTestId("automation-results")).toContainText("Sent (90 days)");
  });
});

test.describe("a client", () => {
  test("opts out from the link in a message", async ({ browser }) => {
    const { data: c } = await admin.from("clients").select("id, sms_opt_in").eq("business_id", B).eq("sms_opt_in", true).limit(1).single();
    const token = randomBytes(24).toString("base64url");
    const { data: m } = await admin
      .from("marketing_messages")
      .insert({ business_id: B, kind: "rebook", client_id: c!.id, cycle_key: `test:${token}`, channel: "sms", to_address: "(312) 555-0100", body: "Hi", opt_out_token_hash: createHash("sha256").update(token).digest("hex") })
      .select("id")
      .single();
    // Signed out, as a client would be.
    const page = await (await browser.newContext()).newPage();
    try {
      await page.goto(`/unsubscribe/${token}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stop texts?");
      await expect(page.getByText(/Maple & Ash Hair Studio/).first()).toBeVisible();
      await page.getByRole("button", { name: "Stop texts" }).click();
      await expect(page.getByTestId("opted-out")).toHaveText("Done. Maple & Ash Hair Studio won't send you texts like this again.");
      expect((await admin.from("clients").select("sms_opt_in").eq("id", c!.id).single()).data!.sms_opt_in).toBe(false);
      await page.goto("/unsubscribe/not-a-real-token-at-all-xx");
      await expect(page.getByText("404")).toBeVisible();
    } finally {
      await admin.from("clients").update({ sms_opt_in: true }).eq("id", c!.id);
      await admin.from("marketing_messages").delete().eq("id", m!.id);
      await page.context().close();
    }
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("records a client's birthday", async ({ page }) => {
    const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: "Birthdayna", last_name: "Test" }).select("id").single();
    try {
      await page.goto(`/clients/${c!.id}`);
      await waitForHydration(page, "select[name=birth_month]");
      await ui(page).getByLabel("Birthday month").selectOption({ label: "February" });
      await ui(page).getByLabel("Birthday day").selectOption("30");
      await ui(page).getByRole("button", { name: "Save changes" }).click();
      await expect(ui(page).getByText("Choose a month and a day that exists.")).toBeVisible();
      await ui(page).getByLabel("Birthday day").selectOption("29");
      await ui(page).getByRole("button", { name: "Save changes" }).click();
      await expect.poll(async () => (await admin.from("clients").select("birth_month, birth_day").eq("id", c!.id).single()).data).toEqual({ birth_month: 2, birth_day: 29 });
    } finally {
      await admin.from("clients").delete().eq("id", c!.id);
    }
  });
});
