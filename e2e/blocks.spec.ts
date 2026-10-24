import type { Locator, Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration, pxPerMinute, slotAt } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, shae: SHAE } = SEED.staff;
// A Tuesday clear of the seeded month and the other tests' days.
const DAY = addDays(startOfWeek(todayIn(TZ)), 57);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;

async function clear() {
  await admin.from("time_blocks").delete().eq("location_id", L).or(`on_date.eq.${DAY},starts_on.eq.${DAY}`);
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
}
test.beforeEach(clear);
test.afterAll(clear);

async function openDay(page: Page) {
  await page.goto(`/calendar?date=${DAY}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
  await waitForHydration(page, "section[data-staff-id]");
}

const column = (page: Page, name: string) => ui(page).getByRole("region", { name, exact: true });

// dy in minutes.
async function dragBy(page: Page, target: Locator, minutes: number, x = 20, y = 6) {
  const dy = minutes * (await pxPerMinute(page));
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x, box.y + y + dy, { steps: 8 });
  await page.mouse.up();
}

test.use({ viewport: { width: 1920, height: 1500 } });

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("blocks a repeating lunch, then moves and stretches one day of it", async ({ page }) => {
    await openDay(page);
    await ui(page).getByRole("button", { name: "Block time" }).click();
    const form = page.getByRole("form", { name: "Block time" });
    await form.getByLabel("Stylist").selectOption({ label: "Bridget Callahan" });
    await form.getByLabel("What for").selectOption("lunch");
    await form.getByLabel("From").fill("12:00");
    await form.getByLabel("To").fill("12:30");
    await form.getByLabel("Repeats every week").check();
    for (const d of ["Mon", "Wed", "Thu", "Fri"]) await form.getByText(d, { exact: true }).click();
    await form.getByRole("button", { name: "Block time" }).click();
    await expect(ui(page).getByRole("status").filter({ hasText: "Lunch blocked, repeating." })).toBeVisible();

    const block = column(page, "Bridget Callahan").getByRole("button", { name: /^Lunch, noon–12:30pm, every weekday/ });
    await expect(block).toBeVisible();
    const { data: series } = await admin.from("time_blocks").select("id, repeat_weekdays, starts_on").eq("staff_id", BRIDGET).eq("starts_on", DAY).single();
    expect(series!.repeat_weekdays).toEqual([1, 2, 3, 4, 5]);

    // Drag it 15 minutes later: this day only.
    await dragBy(page, block, 15);
    await expect(ui(page).getByRole("status").filter({ hasText: "Moved for this day only." })).toBeVisible();
    const moved = column(page, "Bridget Callahan").getByRole("button", { name: /^Lunch, 12:15pm–12:45pm/ });
    await expect(moved).toBeVisible();
    // It's now a one-off block for this day (the series is unchanged).
    await expect.poll(async () => (await admin.from("time_blocks").select("id").eq("staff_id", BRIDGET).eq("on_date", DAY)).data?.length).toBe(1);
    await openDay(page);
    // Stretch it by 15 minutes from its bottom edge.
    const box = (await moved.boundingBox())!;
    await dragBy(page, moved, 15, 40, box.height - 2);
    await expect(column(page, "Bridget Callahan").getByRole("button", { name: /^Lunch, 12:15pm–1pm/ })).toBeVisible();
    await expect
      .poll(async () => (await admin.from("time_blocks").select("start_minute, end_minute").eq("staff_id", BRIDGET).eq("on_date", DAY).single()).data)
      .toEqual({ start_minute: 735, end_minute: 780 });
    const { data: skips } = await admin.from("time_block_skips").select("on_date").eq("block_id", series!.id);
    expect(skips).toEqual([{ on_date: DAY }]);
  });

  test("keeps clients out of blocked time", async ({ page }) => {
    await admin.from("time_blocks").insert({ business_id: B, location_id: L, staff_id: SHAE, kind: "meeting", note: "Team meeting", start_minute: 600, end_minute: 660, on_date: DAY });
    // A client at 9 with Shae, dragged into their meeting.
    const { data: client } = await admin.from("clients").select("id").eq("business_id", B).order("id").limit(1).single();
    const { data: s } = await admin.from("services").select("id, duration_minutes, active_minutes, price_cents").eq("business_id", B).eq("name", "Men's Cut").single();
    const end = new Date(at(9).getTime() + s!.duration_minutes! * 60_000).toISOString();
    const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: client!.id, starts_at: at(9).toISOString(), ends_at: end }).select("id").single();
    await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: s!.id, staff_id: SHAE, starts_at: at(9).toISOString(), ends_at: end, active_minutes: s!.active_minutes, price_cents: s!.price_cents });

    await openDay(page);
    const meeting = column(page, "Shae Morgan").getByRole("button", { name: /^Meeting, 10am–11am, Team meeting/ });
    await expect(meeting).toBeVisible();
    const appointment = column(page, "Shae Morgan").locator("[data-block]");
    await dragBy(page, appointment, 60);
    await expect(ui(page).getByRole("alert")).toContainText("The stylist is in a meeting then.");

    // Clicking the meeting shows it, with ways to change it.
    await meeting.click();
    const panel = page.getByRole("region", { name: "Blocked time" });
    await expect(panel).toContainText("10am–11am");
    await expect(panel).toContainText("Team meeting");
    await panel.getByRole("button", { name: "Remove" }).click();
    await expect(meeting).toHaveCount(0);
  });
});

test.describe("stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("blocks their own time from an empty slot, but can't change others'", async ({ page }) => {
    await admin.from("time_blocks").insert({ business_id: B, location_id: L, staff_id: SHAE, kind: "training", start_minute: 900, end_minute: 960, on_date: DAY });
    await openDay(page);
    const { box, y } = await slotAt(page, column(page, "Bridget Callahan"), 16 * 60);
    await page.mouse.click(box.x + 30, y);
    const form = page.getByRole("form", { name: "Block time" });
    await expect(form.getByLabel("Stylist")).toHaveValue(BRIDGET);
    await expect(form.getByLabel("Stylist").locator("option")).toHaveCount(1);
    await expect(form.getByLabel("From")).toHaveValue("16:00");
    await form.getByLabel("What for").selectOption("personal");
    await form.getByLabel("Note").fill("School pickup");
    await form.getByRole("button", { name: "Block time" }).click();
    await expect(column(page, "Bridget Callahan").getByRole("button", { name: /^Personal, 4pm–4:30pm, School pickup/ })).toBeVisible();

    await column(page, "Shae Morgan").getByRole("button", { name: /^Training/ }).click();
    const panel = page.getByRole("region", { name: "Blocked time" });
    await expect(panel).toContainText("3pm–4pm");
    await expect(panel.getByRole("button", { name: "Change" })).toHaveCount(0);
  });
});
