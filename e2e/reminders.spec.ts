// Appointment reminders on Settings → Messages: on or off, how long before,
// and the message as a client reads it. Sending is tested in
// tests/db/appointment-reminders.test.ts, with a fixed clock.
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
let before: { reminders_on: boolean; reminder_hours: number };

test.beforeAll(async () => {
  before = (await admin.from("businesses").select("reminders_on, reminder_hours").eq("id", B).single()).data!;
  await admin.from("businesses").update({ reminders_on: true, reminder_hours: 24 }).eq("id", B);
});

test.afterAll(async () => {
  await admin.from("businesses").update(before).eq("id", B);
});

const saved = async () => (await admin.from("businesses").select("reminders_on, reminder_hours").eq("id", B).single()).data!;

test.use({ storageState: AUTH.manager });

test("a manager chooses when reminders go, sees the message, and turns them off", async ({ page }) => {
  await page.goto("/settings/messages");
  await waitForHydration(page, "section[aria-labelledby=reminders-heading] select");
  const card = ui(page).getByRole("region", { name: "Appointment reminders" });
  await expect(card.getByTestId("reminder-sample")).toHaveText(/^Maple & Ash Hair Studio: Hi Ava, a reminder of your visit tomorrow, Tue, Nov 10 at 2:15pm with Bridget\. View, change or cancel: \(a link to their visit\)$/);

  await card.getByLabel("When").selectOption({ label: "4 hours before" });
  await expect(card.getByRole("alert").or(card.getByRole("status"))).toContainText("Saved.");
  await expect.poll(saved).toEqual({ reminders_on: true, reminder_hours: 4 });
  await expect(card.getByTestId("reminder-sample")).toContainText("your visit today at 2:15pm");

  await card.getByLabel("Send clients a reminder before each visit").uncheck();
  await expect.poll(saved).toEqual({ reminders_on: false, reminder_hours: 4 });
  await expect(card.getByLabel("When")).toBeDisabled();
  await expect(card.getByTestId("reminder-sample")).toHaveCount(0);
});

test.describe("the front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("can't open Messages settings", async ({ page }) => {
    await page.goto("/settings/messages");
    await expect(page).not.toHaveURL(/\/settings\/messages/);
  });
});
