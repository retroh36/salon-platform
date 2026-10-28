import type { Page } from "@playwright/test";
import { formatDay } from "@/lib/schedule-format";
import { addDays, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const L = SEED.location;
const today = todayIn("America/Chicago");
// Three weeks out: past the demo's bookings, so nothing here moves a client.
const week = addDays(startOfWeek(today), 21);
const wednesday = addDays(week, 2); // Gil works 10–7 on Wednesdays
const started = new Date().toISOString();

const grid = (page: Page) => ui(page).getByTestId("team-schedule");
const cellButton = (page: Page, firstName: string, date: string) => grid(page).getByRole("button", { name: new RegExp(`^Edit ${firstName}'s hours on ${formatDay(date)}`) });
// The day's button is under its shifts: click the corner they leave clear.
const openDay = (page: Page, firstName: string, date: string) => cellButton(page, firstName, date).click({ position: { x: 4, y: 4 } });

async function putBack() {
  await admin.from("schedule_drafts").delete().eq("location_id", L).gte("on_date", week).lte("on_date", addDays(week, 6));
  await admin.from("staff_schedule_overrides").delete().eq("staff_id", SEED.staff.gil).gte("on_date", week).lte("on_date", addDays(week, 6));
  await admin.from("staff_days_off").delete().eq("staff_id", SEED.staff.gil).gte("on_date", week).lte("on_date", addDays(week, 6));
  await admin.from("schedule_publishes").delete().eq("location_id", L).gte("published_at", started);
  await admin.from("notifications").delete().eq("staff_id", SEED.staff.gil).in("template", ["schedule_changed"]).gte("created_at", started);
}

test.describe("owners and managers", () => {
  test.use({ storageState: AUTH.owner });
  test.beforeEach(putBack);
  test.afterAll(putBack);

  test("change a day as a draft, publish the week, and the stylist is told", async ({ page, browser }) => {
    await page.goto(`/scheduling?week=${week}`);
    await waitForHydration(page, "[data-testid=team-schedule] button[data-shift]");
    await expect(grid(page)).toContainText("Follows everyone");

    await openDay(page, "Gil", wednesday);
    const sheet = ui(page).getByRole("dialog", { name: `Gil · ${formatDay(wednesday)}` });
    await sheet.getByLabel(/shift 1 starts/).fill("13:00");
    await sheet.getByLabel(/shift 1 ends/).fill("20:00");
    // A split shift that overlaps is refused before saving.
    await sheet.getByRole("button", { name: "+ Add a split shift" }).click();
    await sheet.getByLabel(/shift 2 starts/).fill("19:00");
    await expect(sheet.getByRole("alert")).toContainText("overlap");
    await sheet.getByRole("button", { name: "Remove shift 2" }).click();
    await sheet.getByRole("button", { name: "Save to draft" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(grid(page)).toContainText("Draft · 1 change");
    await expect(grid(page).locator(`[data-staff="${SEED.staff.gil}"][data-date="${wednesday}"]`)).toHaveAttribute("data-draft", "true");

    // Nobody else sees the draft yet: the front desk sees the published week.
    const desk = await browser.newContext({ storageState: AUTH.frontDesk });
    const deskPage = await desk.newPage();
    await deskPage.goto(`/scheduling?week=${week}`);
    await expect(deskPage.getByTestId("team-schedule").locator(`[data-staff="${SEED.staff.gil}"][data-date="${wednesday}"]`)).toContainText("10–7");
    await expect(deskPage.getByRole("button", { name: "Publish week" })).toHaveCount(0);

    await ui(page).getByRole("button", { name: "Publish week" }).click();
    const publish = ui(page).getByRole("dialog", { name: "Publish this week" });
    await expect(publish).toContainText("Gil Navarro");
    await expect(publish).toContainText("10am–7pm → 1pm–8pm");
    await publish.getByRole("button", { name: "Publish and tell 1 person" }).click();
    await expect(ui(page).getByText("Published. 1 person told about their new hours.")).toBeVisible();

    await deskPage.reload();
    await expect(deskPage.getByTestId("team-schedule").locator(`[data-staff="${SEED.staff.gil}"][data-date="${wednesday}"]`)).toContainText("1–8");
    await desk.close();

    const { data: notice } = await admin.from("notifications").select("body").eq("staff_id", SEED.staff.gil).eq("template", "schedule_changed").gte("created_at", started).single();
    expect(notice!.body).toContain("1pm–8pm (was 10am–7pm)");
  });

  test("drag a shift later, then copy and clear the week as drafts", async ({ page }) => {
    await page.goto(`/scheduling?week=${week}`);
    await waitForHydration(page, "[data-testid=team-schedule] button[data-shift]");
    const bar = grid(page).locator(`[data-staff="${SEED.staff.gil}"][data-date="${wednesday}"] [data-shift]`).first();
    const box = (await bar.boundingBox())!;
    const track = (await grid(page).locator(`[data-staff="${SEED.staff.gil}"][data-date="${wednesday}"]`).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // About an hour along the track.
    await page.mouse.move(box.x + box.width / 2 + track.width / 14, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(grid(page)).toContainText("Draft · 1 change");
    // Later by whole quarter hours, the same length.
    await expect
      .poll(async () => {
        const shifts = (await admin.from("schedule_drafts").select("shifts").eq("staff_id", SEED.staff.gil).eq("on_date", wednesday).maybeSingle()).data?.shifts as { start: number; end: number }[] | undefined;
        return shifts && shifts.length === 1 && shifts[0].start > 10 * 60 && shifts[0].start % 15 === 0 && shifts[0].end - shifts[0].start === 9 * 60;
      })
      .toBe(true);

    await ui(page).getByRole("button", { name: "Discard changes" }).click();
    await expect(grid(page)).toContainText("Follows everyone");

    await ui(page).getByRole("button", { name: "Clear week" }).click();
    await expect(grid(page)).toContainText(/Draft · \d+ changes/);
    await expect(grid(page).locator("[data-shift]")).toHaveCount(0);
    await ui(page).getByRole("button", { name: "Discard changes" }).click();
    await expect(grid(page).locator("[data-shift]").first()).toBeVisible();
  });

  test("warns before new hours leave a booked client outside them, with the Mark out panel", async ({ page }) => {
    // A stylist's visit later this week or next.
    const { data: item } = await admin
      .from("appointment_items")
      .select("staff_id, starts_at, appointment:appointments!inner(status)")
      .eq("location_id", L)
      .in("appointment.status", ["booked", "confirmed"])
      .gte("starts_at", new Date(Date.now() + 86_400_000).toISOString())
      .order("starts_at")
      .limit(1)
      .single();
    const date = new Date(item!.starts_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const { data: who } = await admin.from("staff").select("first_name").eq("id", item!.staff_id).single();

    await page.goto(`/scheduling?week=${startOfWeek(date)}`);
    await waitForHydration(page, "[data-testid=team-schedule] button[data-shift]");
    await openDay(page, who!.first_name, date);
    const sheet = ui(page).getByRole("dialog", { name: `${who!.first_name} · ${formatDay(date)}` });
    await sheet.getByRole("button", { name: "Day off" }).click();
    await expect(sheet).toContainText("booked outside these hours");
    await expect(sheet.getByRole("link", { name: `Mark ${who!.first_name} out` })).toHaveAttribute("href", `/calendar?date=${date}&out=${item!.staff_id}`);
    await sheet.getByRole("button", { name: "Cancel" }).click();
  });
});

test.describe("patterns", () => {
  test.use({ storageState: AUTH.manager });

  test("show someone's two-week pattern: every other Saturday off", async ({ page }) => {
    await page.goto("/scheduling");
    await waitForHydration(page, "[data-testid=team-schedule] button[data-shift]");
    await expect(grid(page).locator(`[data-person="${SEED.staff.lois}"]`).getByTestId("pattern-weeks")).toHaveText("2 wk");
    await grid(page).getByRole("button", { name: "Lois's repeating pattern, repeats every 2 weeks" }).click();
    const sheet = ui(page).getByRole("dialog", { name: "Lois's repeating pattern" });
    await expect(sheet.getByLabel("Repeats")).toHaveValue("2");
    await expect(sheet.getByRole("region", { name: "Week 1" }).getByLabel("Week 1 Saturday: shift 1 starts")).toBeVisible();
    await expect(sheet.getByRole("region", { name: "Week 2" }).getByLabel("Week 2 Saturday: shift 1 starts")).toHaveCount(0);
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveCount(0);
  });
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("have their own schedule instead, with their published week on My day", async ({ page }) => {
    await page.goto("/scheduling");
    await expect(page).toHaveURL(/\/schedule$/);
    await page.goto("/my-day");
    const myWeek = ui(page).getByTestId("my-week");
    await expect(myWeek).toContainText("Today");
    await expect(myWeek.getByRole("listitem")).toHaveCount(7);
  });
});
