import { addDays, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const today = todayIn("America/Chicago");
const started = new Date().toISOString();

// The demo's waiting requests, put back to waiting afterwards.
async function waiting(staffId: string) {
  const { data } = await admin.from("staff_time_off").select("id").eq("staff_id", staffId).eq("status", "requested").order("starts_on").limit(1).single();
  return data!.id;
}
const reopen = (id: string) => admin.from("staff_time_off").update({ status: "requested", decided_by: null, decided_at: null, decline_reason: null }).eq("id", id);

test.describe("owners and managers", () => {
  test.use({ storageState: AUTH.manager });

  test("approve one, decline one with a reason, and see each person told", async ({ page }) => {
    const shae = await waiting(SEED.staff.shae);
    const lois = await waiting(SEED.staff.lois);
    try {
      await page.goto("/scheduling/requests");
      await waitForHydration(page, "[data-request] button");
      await expect(ui(page).getByRole("link", { name: /^Requests \(\d+\)$/ })).toBeVisible();
      const shaeCard = ui(page).locator(`[data-request="${shae}"]`);
      await expect(shaeCard).toContainText("Sister's graduation");
      await expect(shaeCard).toContainText("Short notice");
      const loisCard = ui(page).locator(`[data-request="${lois}"]`);
      await expect(loisCard).toContainText("Blackout: Holiday week");
      await expect(loisCard.getByTestId("request-others")).toBeVisible();

      await shaeCard.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(ui(page).getByRole("region", { name: "Decided in the last 30 days" }).locator(`[data-request="${shae}"]`)).toContainText("Approved");

      await loisCard.getByRole("button", { name: "Decline…" }).click();
      const sheet = ui(page).getByRole("dialog", { name: "Decline Lois's request" });
      await sheet.getByRole("button", { name: "Decline request" }).click();
      await expect(sheet).toBeVisible();
      await sheet.getByLabel(/Why/).fill("We need everyone that week.");
      await sheet.getByRole("button", { name: "Decline request" }).click();
      await expect(sheet).toHaveCount(0);
      const decided = ui(page).getByRole("region", { name: "Decided in the last 30 days" }).locator(`[data-request="${lois}"]`);
      await expect(decided).toContainText("Declined");
      await expect(decided).toContainText("We need everyone that week.");

      const { data: told } = await admin.from("notifications").select("staff_id, body").eq("template", "time_off_decided").gte("created_at", started);
      expect(told!.find((n) => n.staff_id === SEED.staff.lois)?.body).toMatch(/declined: We need everyone that week\.$/);
      expect(told!.find((n) => n.staff_id === SEED.staff.shae)?.body).toMatch(/was approved\.$/);
    } finally {
      await Promise.all([reopen(shae), reopen(lois), admin.from("notifications").delete().eq("template", "time_off_decided").gte("created_at", started)]);
    }
  });

  test("approve and plan clients opens the Mark out panel on the day", async ({ page }) => {
    const hannah = await waiting(SEED.staff.hannah);
    const { data: row } = await admin.from("staff_time_off").select("starts_on").eq("id", hannah).single();
    try {
      await page.goto("/scheduling/requests");
      await waitForHydration(page, "[data-request] button");
      const card = ui(page).locator(`[data-request="${hannah}"]`);
      await expect(card.getByTestId("request-clients")).toContainText(/\d+ clients?/);
      await card.getByRole("button", { name: "Approve and plan clients" }).click();
      await expect(page).toHaveURL(new RegExp(`/calendar\\?date=${row!.starts_on}&out=${SEED.staff.hannah}`));
      await expect(ui(page).getByRole("heading", { name: "Hannah is out" })).toBeVisible();
      expect((await admin.from("staff_time_off").select("status").eq("id", hannah).single()).data?.status).toBe("approved");
    } finally {
      await reopen(hannah);
    }
  });

  test("set the notice period and a blackout", async ({ page }) => {
    const { data: before } = await admin.from("businesses").select("time_off_notice_days").eq("id", B).single();
    try {
      await page.goto("/settings/time-off");
      await waitForHydration(page, "form[aria-label='Add blackout dates'] button");
      await ui(page).getByLabel("Days ahead").fill("21");
      await ui(page).getByRole("button", { name: "Save" }).click();
      await expect(ui(page).getByText("Saved.")).toBeVisible();
      const form = ui(page).getByRole("form", { name: "Add blackout dates" });
      await form.getByLabel("First day").fill(addDays(today, 120));
      await form.getByLabel("Last day").fill(addDays(today, 122));
      await form.getByLabel("Name (optional)").fill("E2E prom season");
      await form.getByRole("button", { name: "Add blackout" }).click();
      await expect(ui(page).getByRole("list", { name: "Blackout dates" })).toContainText("E2E prom season");
      expect((await admin.from("businesses").select("time_off_notice_days").eq("id", B).single()).data?.time_off_notice_days).toBe(21);
    } finally {
      await admin.from("businesses").update({ time_off_notice_days: before!.time_off_notice_days }).eq("id", B);
      await admin.from("time_off_blackouts").delete().eq("business_id", B).eq("label", "E2E prom season");
    }
  });
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("ask from My day on a phone, see the rules, and withdraw it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      await page.goto("/my-day");
      await ui(page).getByTestId("my-week").getByRole("link", { name: "Ask for time off" }).click();
      await expect(page).toHaveURL(/\/time-off$/);
      await waitForHydration(page, "form[aria-label='Request time off'] select");
      await expect(ui(page).getByTestId("time-off-rules")).toContainText("Holiday week");
      const form = ui(page).getByRole("form", { name: "Request time off" });
      await form.getByLabel("First day").fill(addDays(today, 3));
      await form.getByLabel("Note (optional)").fill("E2E dentist");
      await form.getByRole("button", { name: "Request time off" }).click();
      await expect(form.getByRole("status")).toHaveText("Request sent.");
      const entry = ui(page).getByRole("region", { name: "My time off" }).getByRole("listitem").filter({ hasText: "Vacation" }).filter({ hasText: "Pending" });
      await expect(entry).toHaveCount(1);
      const { data } = await admin.from("staff_time_off").select("short_notice").eq("staff_id", SEED.staff.bridget).eq("note", "E2E dentist").single();
      expect(data?.short_notice).toBe(true);
      // Nothing on the page is wider than the phone.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await entry.getByRole("button", { name: "Withdraw" }).click();
      await expect(entry).toHaveCount(0);
    } finally {
      await admin.from("staff_time_off").delete().eq("staff_id", SEED.staff.bridget).eq("note", "E2E dentist");
      await admin.from("notifications").delete().eq("template", "time_off_requested").gte("created_at", started);
    }
  });

  test("can't open the Requests inbox", async ({ page }) => {
    await page.goto("/scheduling/requests");
    await expect(page).toHaveURL(/\/time-off$/);
  });
});
