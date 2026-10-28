// A published week reaches everyone at once: the manager changes Nola's
// Wednesday to 11–7 as a draft (nothing changes for anyone else), then
// publishes it, and the front desk's calendar shows 11–7 without a reload,
// Nola's My day tells her, and online booking stops offering her at 9am.
import type { Browser, Page } from "@playwright/test";
import { formatDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, signIn, test, ui, waitForHydration } from "./fixtures";

const L = SEED.location;
const NOLA = SEED.staff.nola;
const TZ = "America/Chicago";
const today = todayIn(TZ);
// Two weeks out: clear of the demo's bookings (and of scheduling.spec's
// week, three out). Nola works 9–5 on Wednesdays.
const week = addDays(startOfWeek(today), 14);
const wednesday = addDays(week, 2);
const started = new Date().toISOString();
// "Wednesday, November 11", as the booking site's date strip names it.
const longDate = new Date(`${wednesday}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
// "Live" means within a few seconds, without a reload.
const LIVE = { timeout: 5_000 };

async function putBack() {
  await admin.from("schedule_drafts").delete().eq("location_id", L).gte("on_date", week).lte("on_date", addDays(week, 6));
  await admin.from("staff_schedule_overrides").delete().eq("staff_id", NOLA).eq("on_date", wednesday);
  await admin.from("staff_days_off").delete().eq("staff_id", NOLA).eq("on_date", wednesday);
  await admin.from("schedule_publishes").delete().eq("location_id", L).gte("published_at", started);
  await admin.from("notifications").delete().eq("staff_id", NOLA).eq("template", "schedule_changed").gte("created_at", started);
}

// What the booking site offers with Nola for a Men's Cut that Wednesday.
async function onlineTimes(browser: Browser, serviceId: string): Promise<string[]> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/book/maple-and-ash?services=${serviceId}&staff=${NOLA}`);
  const day = page.getByRole("radiogroup", { name: "Date" }).getByRole("radio", { name: new RegExp(`^${longDate}`) });
  while (!(await day.isVisible())) await page.getByRole("button", { name: "Later dates" }).click();
  await day.click();
  const morning = page.getByRole("radiogroup", { name: "Morning" });
  await expect(page.getByRole("radiogroup", { name: "Afternoon" })).toBeVisible();
  const times = (await morning.count()) ? await morning.getByRole("radio").allInnerTexts() : [];
  await context.close();
  return times.map((t) => t.split("\n")[0].trim());
}

const columnHours = (page: Page) => ui(page).locator("[data-column-header]").filter({ hasText: "Nola" }).getByTestId("column-hours");

test.beforeAll(async () => {
  await putBack();
  const { count } = await admin
    .from("appointment_items")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", NOLA)
    .eq("holds_time", true)
    .gte("starts_at", fromLocal(wednesday, 0, TZ)!.toISOString())
    .lt("starts_at", fromLocal(addDays(wednesday, 1), 0, TZ)!.toISOString());
  expect(count, "Nola needs a clear Wednesday two weeks out").toBe(0);
});
test.afterAll(putBack);

test("a published week reaches the front desk's calendar, the stylist's My day and online booking, and a draft reaches nobody", async ({ browser }) => {
  const { data: cut } = await admin.from("services").select("id").eq("business_id", SEED.business).eq("name", "Men's Cut").single();
  expect(await onlineTimes(browser, cut!.id)).toContain("9am");

  // The front desk on the calendar, and Nola on My day (her phone).
  const desk = await browser.newContext({ storageState: AUTH.frontDesk });
  const deskPage = await desk.newPage();
  await deskPage.goto(`/calendar?date=${wednesday}`);
  await waitForHydration(deskPage, "[data-column-header]");
  await expect(columnHours(deskPage)).toHaveText(/^9–5\b/);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const nolaPage = await phone.newPage();
  await signIn(nolaPage, "nola@mapleandash.test", "/my-day");
  const notice = "11am–7pm (was 9am–5pm)";
  await expect(ui(nolaPage)).not.toContainText(notice);

  // The manager changes the day as a draft.
  const office = await browser.newContext({ storageState: AUTH.manager });
  const page = await office.newPage();
  await page.goto(`/scheduling?week=${week}`);
  await waitForHydration(page, "[data-testid=team-schedule] button[data-shift]");
  await ui(page).locator(`[data-staff="${NOLA}"][data-date="${wednesday}"] button[data-shift]`).click();
  const editor = page.getByRole("dialog", { name: `Nola · ${formatDay(wednesday)}` });
  await editor.getByLabel(/shift 1 starts/).fill("11:00");
  await editor.getByLabel(/shift 1 ends/).fill("19:00");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toHaveCount(0);
  await expect(ui(page).locator(`[data-staff="${NOLA}"][data-date="${wednesday}"]`)).toHaveAttribute("data-draft", "true");
  await expect(ui(page).locator(`[data-staff="${NOLA}"][data-date="${wednesday}"]`)).toContainText("11–7");

  // A draft changes nothing outside Scheduling.
  await deskPage.waitForTimeout(3_000);
  await expect(columnHours(deskPage)).toHaveText(/^9–5\b/);
  await expect(ui(nolaPage)).not.toContainText(notice);
  expect(await onlineTimes(browser, cut!.id)).toContain("9am");

  // Published: everyone has it within a few seconds, nobody reloads.
  await ui(page).getByRole("button", { name: "Publish week" }).click();
  const publish = page.getByRole("dialog", { name: "Publish this week" });
  await expect(publish).toContainText("9am–5pm → 11am–7pm");
  await publish.getByRole("button", { name: "Publish and tell 1 person" }).click();
  await expect(ui(page).getByText("Published. 1 person told about their new hours.")).toBeVisible();

  await expect(columnHours(deskPage)).toHaveText(/^11–7\b/, LIVE);
  await expect(ui(nolaPage).getByTestId("notices")).toContainText(notice, LIVE);
  const after = await onlineTimes(browser, cut!.id);
  expect(after).not.toContain("9am");
  expect(after).toContain("11am");

  await Promise.all([desk.close(), phone.close(), office.close()]);
});
