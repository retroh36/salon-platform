import { nextMonth } from "@/lib/coverage";
import { formatDay } from "@/lib/schedule-format";
import { startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const today = todayIn("America/Chicago");
const { from, to, name } = nextMonth(today);
const started = new Date().toISOString();

test.use({ storageState: AUTH.manager });

test("flags a time-off request on a day with clients booked", async ({ page }) => {
  const { data } = await admin.from("staff_time_off").select("starts_on").eq("staff_id", SEED.staff.hannah).eq("status", "requested").order("starts_on").limit(1).single();
  await page.goto(`/scheduling?week=${startOfWeek(data!.starts_on)}`);
  const card = ui(page).getByTestId("denise-schedule");
  await expect(card.locator("[data-flag='request_busy_day']").filter({ hasText: `Hannah asked for time off on ${formatDay(data!.starts_on)}` })).toBeVisible();
});

test("drafts next month into the draft, and undoes it", async ({ page }) => {
  const before = (await admin.from("schedule_drafts").select("business_id, location_id, staff_id, on_date, shifts, updated_by").eq("location_id", SEED.location).gte("on_date", from).lte("on_date", to)).data!;
  // Somebody's approved time off next month, so there's something to draft.
  const off = await admin
    .from("staff_time_off")
    .insert({ business_id: SEED.business, staff_id: SEED.staff.gil, starts_on: from, ends_on: to, reason: "vacation", status: "approved", requested_by: SEED.staff.gil, decided_by: SEED.staff.manager, decided_at: started })
    .select("id")
    .single();
  try {
    await page.goto("/scheduling");
    await waitForHydration(page, "[data-testid='denise-schedule'] button");
    const card = ui(page).getByTestId("denise-schedule");
    await card.getByRole("button", { name: `Draft ${name}` }).click();
    const draft = card.getByTestId("month-draft");
    await expect(draft).toContainText(`A draft for ${name}:`);
    await draft.getByRole("button", { name: "Add to the draft" }).click();
    await expect(card.getByText("Added to the draft. Each week changes for the team only when you publish it.")).toBeVisible();
    const gil = async () => (await admin.from("schedule_drafts").select("on_date").eq("staff_id", SEED.staff.gil).gte("on_date", from).lte("on_date", to)).data!.length;
    expect(await gil()).toBeGreaterThan(0);
    // Nothing is published.
    expect((await admin.from("staff_days_off").select("id").eq("staff_id", SEED.staff.gil).gte("on_date", from).lte("on_date", to).gte("created_at", started)).data).toEqual([]);
    await card.getByRole("button", { name: "Undo" }).click();
    await expect(card.getByText("Taken back out of the draft.")).toBeVisible();
    expect(await gil()).toBe(0);
  } finally {
    await admin.from("staff_time_off").delete().eq("id", off.data!.id);
    await admin.from("ai_actions").delete().eq("business_id", SEED.business).eq("feature", "schedule_draft").gte("created_at", started);
    await admin.from("schedule_drafts").delete().eq("location_id", SEED.location).gte("on_date", from).lte("on_date", to);
    if (before.length) await admin.from("schedule_drafts").insert(before as never);
  }
});

test.describe("the front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("sees the published week without Denise's checks", async ({ page }) => {
    await page.goto("/scheduling");
    await expect(ui(page).getByRole("heading", { name: "Scheduling" })).toBeVisible();
    await expect(ui(page).getByTestId("denise-schedule")).toHaveCount(0);
  });
});
