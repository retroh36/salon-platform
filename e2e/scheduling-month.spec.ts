import type { Page } from "@playwright/test";
import { monthWeeks, shiftMonth } from "@/lib/calendar-month";
import { formatDay } from "@/lib/schedule-format";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, setAsideDay, test, ui, waitForHydration } from "./fixtures";

const L = SEED.location;
const TZ = "America/Chicago";
const today = todayIn(TZ);
// Two months out: past the demo's bookings, so nothing here moves a client.
const month = shiftMonth(today.slice(0, 7), 2);
const weeks = monthWeeks(month);
// The month's first whole week, and its Wednesday (Gil works Wednesdays).
const week = weeks.find((w) => w[0].startsWith(month))![0];
const wednesday = addDays(week, 2);
const from = weeks[0][0];
const to = weeks.at(-1)![6];
const started = new Date().toISOString();
const staffIds = Object.values(SEED.staff);

const month$ = (page: Page) => ui(page).getByTestId("team-month");
const day = (page: Page, staffId: string, date: string) => month$(page).locator(`[data-staff="${staffId}"][data-date="${date}"]`);

async function putBack() {
  await admin.from("schedule_drafts").delete().eq("location_id", L).gte("on_date", from).lte("on_date", addDays(to, 63));
  await admin.from("staff_schedule_overrides").delete().in("staff_id", staffIds).gte("on_date", from).lte("on_date", to).gte("created_at", started);
  await admin.from("staff_days_off").delete().in("staff_id", staffIds).gte("on_date", from).lte("on_date", to).gte("created_at", started);
  await admin.from("schedule_publishes").delete().eq("location_id", L).gte("published_at", started);
  await admin.from("notifications").delete().in("staff_id", staffIds).eq("template", "schedule_changed").gte("created_at", started);
}

let putBackGil = async () => {};
test.beforeAll(async () => {
  putBackGil = await setAsideDay([SEED.staff.gil], wednesday, TZ);
});
test.afterAll(() => putBackGil());

test.describe("owners and managers", () => {
  test.use({ storageState: AUTH.owner });
  test.beforeEach(putBack);
  test.afterAll(putBack);

  test("everyone's month, with Denise's checks, a day changed and the month published", async ({ page }) => {
    await page.goto(`/scheduling/month?month=${month}`);
    await waitForHydration(page, "[data-testid=team-month] button[data-cell]");
    // A column for every day of the month, and Denise looking at the month.
    const last = weeks.flat().filter((d) => d.startsWith(month)).at(-1)!;
    await expect(month$(page).locator("[role=columnheader][data-day]")).toHaveCount(Number(last.slice(8)));
    await expect(ui(page).getByTestId("denise-schedule")).toContainText(/this month/);

    await day(page, SEED.staff.gil, wednesday).click();
    const editor = ui(page).getByRole("dialog", { name: `Gil · ${formatDay(wednesday)}` });
    await editor.getByLabel(/shift 1 starts/).fill("12:00");
    await editor.getByLabel(/shift 1 ends/).fill("18:00");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(day(page, SEED.staff.gil, wednesday)).toHaveAttribute("data-draft", "true");
    await expect(day(page, SEED.staff.gil, wednesday)).toContainText("12–6");
    await expect(month$(page)).toContainText("Draft · 1 change");

    await month$(page).getByRole("button", { name: "Publish month" }).click();
    const sheet = ui(page).getByRole("dialog", { name: "Publish this month" });
    await sheet.getByRole("button", { name: "Publish and tell 1 person" }).click();
    await expect(month$(page)).toContainText("Published. 1 person told about their new hours.");
    await expect(day(page, SEED.staff.gil, wednesday)).not.toHaveAttribute("data-draft");
    const { data: override } = await admin.from("staff_schedule_overrides").select("start_minute, end_minute").eq("staff_id", SEED.staff.gil).eq("on_date", wednesday);
    expect(override).toEqual([{ start_minute: 720, end_minute: 1080 }]);
  });

  test("copy a week forward, then a person's month and days copied from someone else", async ({ page }) => {
    await page.goto(`/scheduling/month?month=${month}`);
    await waitForHydration(page, "[data-testid=team-month] button[data-cell]");
    await day(page, SEED.staff.gil, wednesday).click();
    const editor = ui(page).getByRole("dialog", { name: `Gil · ${formatDay(wednesday)}` });
    await editor.getByLabel(/shift 1 starts/).fill("12:00");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(day(page, SEED.staff.gil, wednesday)).toHaveAttribute("data-draft", "true");

    await month$(page).getByRole("button", { name: "Copy a week forward…" }).click();
    const copy = ui(page).getByRole("dialog", { name: "Copy a week forward" });
    await copy.getByLabel("Copy the week of").selectOption(week);
    await copy.getByLabel("Onto the next").selectOption("2");
    await copy.getByLabel("For").selectOption({ label: "Gil Navarro" });
    await copy.getByRole("button", { name: "Copy into the draft" }).click();
    await expect(month$(page)).toContainText(/Copied to 2 days in the draft/);
    await expect(day(page, SEED.staff.gil, addDays(wednesday, 14))).toHaveAttribute("data-draft", "true");

    // Gil's month, then Nola's days copied onto them.
    await month$(page).getByTestId("month-person").filter({ hasText: "Gil Navarro" }).click();
    await expect(ui(page).getByTestId("person-month")).toContainText("Gil Navarro");
    await expect(ui(page).getByTestId("person-month-totals")).toContainText("Scheduled");
    await month$(page).getByRole("button", { name: "Copy from someone…" }).click();
    const fromSheet = ui(page).getByRole("dialog", { name: "Copy days to Gil" });
    await fromSheet.getByLabel("Copy from").selectOption({ label: "Nola Brennan" });
    await fromSheet.getByLabel("From", { exact: true }).fill(week);
    await fromSheet.getByLabel("To", { exact: true }).fill(addDays(week, 6));
    await fromSheet.getByRole("button", { name: "Copy into the draft" }).click();
    await expect(month$(page)).toContainText(/Copied to \d+ days? in the draft/);
    const { data: drafts } = await admin.from("schedule_drafts").select("on_date").eq("staff_id", SEED.staff.gil).gte("on_date", week).lte("on_date", addDays(week, 6));
    expect(drafts!.length).toBeGreaterThan(0);
  });
});

test.describe("the front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("sees the published month, read-only", async ({ page }) => {
    await page.goto(`/scheduling/month?month=${month}`);
    await expect(month$(page)).toBeVisible();
    await expect(month$(page).locator("button[data-cell]")).toHaveCount(0);
    await expect(month$(page).getByRole("button", { name: "Publish month" })).toHaveCount(0);
    await expect(ui(page).getByTestId("denise-schedule")).toHaveCount(0);
  });
});
