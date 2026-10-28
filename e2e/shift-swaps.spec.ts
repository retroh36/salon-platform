import { formatDay } from "@/lib/schedule-format";
import { addDays, todayIn, weekdayOf } from "@/lib/scheduling/time";
import { admin, SEED, signIn } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const { frontDesk: SAM, jordan: JORDAN } = SEED.staff;
const started = new Date().toISOString();
const today = todayIn("America/Chicago");
// A Tuesday four weeks out: Sam works 9–5, Jordan doesn't.
const tuesday = addDays(today, 28 + ((2 - weekdayOf(addDays(today, 28)) + 7) % 7));

async function putBack() {
  await admin.from("shift_swaps").delete().eq("business_id", SEED.business).gte("created_at", started);
  await admin.from("staff_schedule_overrides").delete().in("staff_id", [SAM, JORDAN]).eq("on_date", tuesday);
  await admin.from("staff_days_off").delete().in("staff_id", [SAM, JORDAN]).eq("on_date", tuesday);
  await admin.from("notifications").delete().eq("business_id", SEED.business).like("template", "shift_swap_%").gte("created_at", started);
}

test.describe.configure({ mode: "serial" });
test.afterAll(putBack);

test.describe("the front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("asks a coworker on a phone, and is told before asking for a day the coworker can't take", async ({ page }) => {
    await putBack();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/schedule");
    await ui(page).getByRole("link", { name: "Swap a shift" }).click();
    await expect(page).toHaveURL(/\/shift-swaps$/);
    await waitForHydration(page, "form[aria-label='Ask for a swap'] select");
    const form = ui(page).getByRole("form", { name: "Ask for a swap" });
    await expect(form.getByLabel("Coworker")).toHaveValue(JORDAN);

    // Jordan already working that evening: the form says so and won't ask.
    await admin.from("staff_schedule_overrides").insert({ business_id: SEED.business, staff_id: JORDAN, on_date: tuesday, start_minute: 960, end_minute: 1200 });
    await page.reload();
    await waitForHydration(page, "form[aria-label='Ask for a swap'] select");
    await form.getByLabel("Your day to give").selectOption(tuesday);
    await expect(form.getByText(/^Jordan is already working then on /)).toBeVisible();
    await expect(form.getByRole("button", { name: "Ask Jordan" })).toBeDisabled();
    await admin.from("staff_schedule_overrides").delete().eq("staff_id", JORDAN).eq("on_date", tuesday);

    await page.reload();
    await waitForHydration(page, "form[aria-label='Ask for a swap'] select");
    await form.getByLabel("Your day to give").selectOption(tuesday);
    await form.getByLabel("Note (optional)").fill("E2E dentist");
    await form.getByRole("button", { name: "Ask Jordan" }).click();
    await expect(form.getByText("Asked. They'll see it on Shift swaps.")).toBeVisible();
    const mine = ui(page).getByRole("region", { name: "Your swaps" }).getByRole("listitem").filter({ hasText: "You give Jordan" }).filter({ hasText: formatDay(tuesday) });
    await expect(mine).toContainText("Waiting on coworker");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("a manager", () => {
  test.use({ storageState: AUTH.manager });

  test("approves the swap once Jordan accepts, and their hours change", async ({ page }) => {
    const { data } = await admin.from("shift_swaps").select("id").eq("from_staff_id", SAM).eq("give_date", tuesday).eq("status", "asked").single();
    const jordan = await signIn("jordan@mapleandash.test");
    expect((await jordan.rpc("answer_shift_swap", { p_swap_id: data!.id, p_accept: true })).error).toBeNull();

    await page.goto("/scheduling/requests");
    await waitForHydration(page, `[data-swap="${data!.id}"] button`);
    const card = ui(page).locator(`[data-swap="${data!.id}"]`);
    await expect(card).toContainText("Sam Rivera and Jordan Pike");
    await expect(card).toContainText("E2E dentist");
    await card.getByRole("button", { name: "Approve swap" }).click();
    await expect(ui(page).getByText("Approved. Their schedules are updated.")).toBeVisible();
    await expect(card).toHaveCount(0);
    expect((await admin.from("staff_days_off").select("id").eq("staff_id", SAM).eq("on_date", tuesday)).data).toHaveLength(1);
    expect((await admin.from("staff_schedule_overrides").select("start_minute, end_minute").eq("staff_id", JORDAN).eq("on_date", tuesday)).data).toEqual([{ start_minute: 540, end_minute: 1020 }]);
  });
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("don't swap shifts", async ({ page }) => {
    await page.goto("/shift-swaps");
    await expect(page).toHaveURL(/\/time-off$/);
  });
});
