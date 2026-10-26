import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, formatMinute, fromLocal, startOfWeek, toLocal, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, openDisplayMenu, pxPerMinute, test, ui, waitForHydration } from "./fixtures";

// Dragging a visit on the calendar: it moves exactly where it's dropped,
// on the 15-minute lines, at every zoom and however the day is scrolled,
// and every view then shows the saved time.

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const BRIDGET = SEED.staff.bridget;
// A Tuesday clear of the seeded month and the other calendar tests' days.
// Bridget works 9-1 and 2-6.
const DAY = addDays(startOfWeek(todayIn(TZ)), 85);
const at = (minute: number) => fromLocal(DAY, minute, TZ)!;
const PREFIX = `Dr${Date.now().toString(36)}`;
const NAME = `${PREFIX}Ava Test`;

let itemId: string;

test.use({ storageState: AUTH.frontDesk, viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial" });

// A 45-minute Blowout with Bridget at `minute`.
async function newVisit(minute: number) {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23 * 60).toISOString());
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Ava`, last_name: "Test" }).select("id").single();
  const { data: s } = await admin.from("services").select("id, price_cents").eq("business_id", B).eq("name", "Blowout").single();
  const end = new Date(at(minute).getTime() + 45 * 60_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: c!.id, starts_at: at(minute).toISOString(), ends_at: end.toISOString() }).select("id").single();
  const { data: i } = await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: s!.id, staff_id: BRIDGET, starts_at: at(minute).toISOString(), ends_at: end.toISOString(), active_minutes: 45, price_cents: s!.price_cents })
    .select("id")
    .single();
  itemId = i!.id;
}

test.afterAll(async () => {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23 * 60).toISOString());
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
  await admin.from("staff").update({ calendar_zoom: "comfortable" }).eq("id", SEED.staff.frontDesk);
});

async function openDay(page: Page) {
  await page.goto(`/calendar?date=${DAY}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
  await waitForHydration(page, "section[data-staff-id]");
}

const grid = (page: Page) => ui(page).getByTestId("calendar-grid");
const block = (page: Page) => ui(page).locator("[data-block]").filter({ hasText: `${PREFIX}Ava` });
const details = (page: Page) => page.getByRole("tabpanel", { name: "Booking details" });
const savedStart = async () => toLocal(new Date((await admin.from("appointment_items").select("starts_at").eq("id", itemId).single()).data!.starts_at), TZ).minute;
// Until the block stops moving (opening the panel narrows the calendar, and
// its toolbar can wrap onto a second line).
async function settled(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      const box = JSON.stringify(await block(page).boundingBox());
      const same = box === last;
      last = box;
      return same;
    }, { intervals: [150] })
    .toBe(true);
}
const range = (start: number) => `${formatMinute(start)}–${formatMinute(start + 45)}`;

// Scrolls the day so the visit's top is `offset` px below the stylists'
// header row (as far as the day scrolls), then drags it from `grab` px into the block by `minutes`,
// optionally scrolling the grid by `scrollMinutes` mid-drag.
async function drag(page: Page, minutes: number, { offset = 200, grab = 10, scrollMinutes = 0 } = {}) {
  const ppm = await pxPerMinute(page);
  await settled(page);
  await grid(page).evaluate((el, off) => {
    const b = el.querySelector("[data-block][data-dragtest]") as HTMLElement;
    const header = el.querySelector("[data-grid-header]") as HTMLElement;
    el.scrollTop += b.getBoundingClientRect().top - header.getBoundingClientRect().bottom - off;
  }, offset);
  const from = (await block(page).boundingBox())!;
  const x = from.x + 20;
  await page.mouse.move(x, from.y + grab);
  await page.mouse.down();
  await page.mouse.move(x, from.y + grab + minutes * ppm, { steps: 8 });
  if (scrollMinutes) {
    await grid(page).evaluate((el, px) => (el.scrollTop += px), scrollMinutes * ppm);
    // The ghost follows the scroll, before the pointer moves again.
    await page.mouse.move(x, from.y + grab + minutes * ppm + 1);
  }
  await page.mouse.up();
}

test("a dragged visit shows its new time everywhere, and after a reload", async ({ page }) => {
  await newVisit(9 * 60 + 30);
  await openDay(page);
  await block(page).evaluate((el) => el.setAttribute("data-dragtest", ""));
  await drag(page, 30);
  await expect.poll(savedStart).toBe(10 * 60);
  // The visit itself moved too (its profile, My day and the Dashboard read it).
  const { data: visit } = await admin.from("appointment_items").select("appointment:appointments(starts_at)").eq("id", itemId).single();
  expect(toLocal(new Date(visit!.appointment!.starts_at), TZ).minute).toBe(10 * 60);
  // The block, then booking details, at 10:00.
  await expect(block(page)).toContainText(range(10 * 60));
  await block(page).click();
  await expect(details(page).getByTestId("client-name")).toHaveText(NAME);
  await expect(details(page)).toContainText(range(10 * 60));
  await expect(details(page)).not.toContainText(range(9 * 60 + 30));
  // Saved: the same after a reload.
  await page.reload();
  await waitForHydration(page, "section[data-staff-id]");
  await expect(block(page)).toContainText(range(10 * 60));
  await block(page).click();
  await expect(details(page)).toContainText(range(10 * 60));
});

test("booking details open while the visit is dragged shows the new time", async ({ page }) => {
  await newVisit(9 * 60 + 30);
  await openDay(page);
  await block(page).click();
  await expect(details(page)).toContainText(range(9 * 60 + 30));
  await block(page).evaluate((el) => el.setAttribute("data-dragtest", ""));
  await drag(page, 45);
  await expect.poll(savedStart).toBe(10 * 60 + 15);
  await expect(block(page)).toContainText(range(10 * 60 + 15));
  await expect(details(page)).toContainText(range(10 * 60 + 15));
  await expect(details(page)).not.toContainText(range(9 * 60 + 30));
  await page.reload();
  await waitForHydration(page, "section[data-staff-id]");
  await block(page).click();
  await expect(details(page)).toContainText(range(10 * 60 + 15));
});

test("booking details shows the new time while the move is still saving", async ({ page }) => {
  await newVisit(9 * 60 + 30);
  await openDay(page);
  await block(page).evaluate((el) => el.setAttribute("data-dragtest", ""));
  // The save (a server action, posted to the page) takes three seconds.
  let release = () => {};
  const held = new Promise<void>((done) => (release = done));
  await page.route(/\/calendar/, async (route) => {
    if (route.request().method() === "POST") await Promise.race([held, new Promise((r) => setTimeout(r, 3000))]);
    await route.fallback();
  });
  await drag(page, 30);
  await block(page).click();
  await expect(details(page)).toContainText(range(10 * 60), { timeout: 1500 });
  release();
  await expect.poll(savedStart).toBe(10 * 60);
  await expect(details(page)).toContainText(range(10 * 60));
});

test("a move the rules refuse puts the block back and says why", async ({ page }) => {
  await newVisit(9 * 60 + 30);
  await openDay(page);
  await block(page).evaluate((el) => el.setAttribute("data-dragtest", ""));
  // 12:30 runs into Bridget's 1-2 break.
  await drag(page, 3 * 60);
  await expect(ui(page).getByRole("alert")).toContainText(`Couldn't move ${NAME}'s Blowout`);
  await expect(block(page)).toContainText(range(9 * 60 + 30));
  expect(await savedStart()).toBe(9 * 60 + 30);
});

for (const zoom of ["Compact", "Comfortable", "Detailed"] as const) {
  test(`${zoom}: drops on the 15-minute line under the pointer, however the day is scrolled`, async ({ page }) => {
    await newVisit(9 * 60 + 30);
    await openDay(page);
    const menu = await openDisplayMenu(page);
    await menu.getByRole("radio", { name: zoom }).click();
    await page.keyboard.press("Escape");
    await block(page).evaluate((el) => el.setAttribute("data-dragtest", ""));
    // From near the top of the view, the middle, and lower down; grabbed
    // at the top or the middle of the block; each drop goes to the nearest
    // line (10:00 less 22 minutes is 9:38, so 9:45; 7 minutes is no move).
    const cases = [
      { offset: 10, grab: 6, minutes: 30, to: 10 * 60 },
      { offset: 200, grab: 20, minutes: -22, to: 9 * 60 + 45 },
      { offset: 380, grab: 30, minutes: 38, to: 10 * 60 + 30 },
      { offset: 100, grab: 10, minutes: 7, to: 10 * 60 + 30 },
    ];
    for (const c of cases) {
      await drag(page, c.minutes, c);
      await expect.poll(savedStart, { message: JSON.stringify(c) }).toBe(c.to);
      await expect(block(page)).toContainText(range(c.to));
    }
  });
}

test("follows the day when it scrolls mid-drag", async ({ page }) => {
  await newVisit(9 * 60 + 30);
  await openDay(page);
  await block(page).evaluate((el) => el.setAttribute("data-dragtest", ""));
  await drag(page, 15, { scrollMinutes: 45 });
  await expect.poll(savedStart).toBe(10 * 60 + 30);
});

test("a time label follows the drag and the preview sits on the grid lines", async ({ page }) => {
  await newVisit(9 * 60 + 30);
  await openDay(page);
  const ppm = await pxPerMinute(page);
  const from = (await block(page).boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 10 + 31 * ppm, { steps: 6 });
  const ghost = ui(page).locator("[data-drag-ghost]");
  await expect(ghost).toContainText(`${range(10 * 60)} · Bridget`);
  // Exactly half an hour below where it was: on the 10:00 line.
  const box = (await ghost.boundingBox())!;
  expect(Math.abs(box.y - (from.y + 30 * ppm))).toBeLessThan(1);
  expect(Math.abs(box.height - from.height)).toBeLessThan(1);
  await page.mouse.up();
  await expect.poll(savedStart).toBe(10 * 60);
});
