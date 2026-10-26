import type { CDPSession, Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration, slotAt } from "./fixtures";

// The calendar on the front desk's iPad, with real touches (sent through
// Chrome's own touch input, so scrolling is the browser's): a swipe scrolls
// the day, even when it starts on a visit; holding a visit still picks it
// up to drag.

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const BRIDGET = SEED.staff.bridget;
// A Tuesday clear of the seeded month and the other calendar tests' days.
// Bridget works 9-1 and 2-6.
const DAY = addDays(startOfWeek(todayIn(TZ)), 43);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const PREFIX = `Tc${Date.now().toString(36)}`;

let visitId: string;
let itemId: string;

test.use({ storageState: AUTH.frontDesk, viewport: { width: 1180, height: 820 }, hasTouch: true });

test.beforeEach(async () => {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Ava`, last_name: "Test" }).select("id").single();
  const { data: s } = await admin.from("services").select("id, active_minutes, price_cents").eq("business_id", B).eq("name", "Blowout").single();
  const end = new Date(at(10).getTime() + s!.active_minutes * 60_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: c!.id, starts_at: at(10).toISOString(), ends_at: end.toISOString() }).select("id").single();
  visitId = a!.id;
  const { data: i } = await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: s!.id, staff_id: BRIDGET, starts_at: at(10).toISOString(), ends_at: end.toISOString(), active_minutes: s!.active_minutes, price_cents: s!.price_cents })
    .select("id")
    .single();
  itemId = i!.id;
});

test.afterAll(async () => {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

async function openDay(page: Page) {
  await page.goto(`/calendar?date=${DAY}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
  await waitForHydration(page, "section[data-staff-id]");
}

const grid = (page: Page) => ui(page).getByTestId("calendar-grid");
const scrollTop = (page: Page) => grid(page).evaluate((el) => el.scrollTop);
const startsAt = async () => (await admin.from("appointment_items").select("starts_at").eq("id", itemId).single()).data!.starts_at;

// A finger down at (x, y), moved by dy in steps, then lifted; `holdMs`
// still before it moves.
async function touch(cdp: CDPSession, page: Page, x: number, y: number, dy: number, holdMs = 0) {
  const point = (py: number) => [{ x, y: py, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(y) });
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let n = 1; n <= 10; n++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(y + (dy * n) / 10) });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("a swipe that starts on a visit scrolls the day and leaves the visit where it is", async ({ page }) => {
  await openDay(page);
  const column = ui(page).getByRole("region", { name: "Bridget Callahan", exact: true });
  const { box, y } = await slotAt(page, column, 10 * 60 + 15);
  const before = await scrollTop(page);
  const cdp = await page.context().newCDPSession(page);
  // Finger on Ava's blowout, straight up the screen.
  await touch(cdp, page, box.x + box.width / 2, y, -300);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(before + 100);
  await expect(ui(page).locator("[data-drag-ghost]")).toHaveCount(0);
  expect(await startsAt()).toBe(at(10).toISOString().replace(".000Z", "+00:00"));
});

test("holding a visit still picks it up: dragging moves it, and the day doesn't scroll", async ({ page }) => {
  await openDay(page);
  const column = ui(page).getByRole("region", { name: "Bridget Callahan", exact: true });
  const { box, y, ppm } = await slotAt(page, column, 10 * 60 + 15);
  const before = await scrollTop(page);
  const cdp = await page.context().newCDPSession(page);
  // Held, then down an hour.
  await touch(cdp, page, box.x + box.width / 2, y, 60 * ppm, 600);
  await expect.poll(startsAt).toBe(at(11).toISOString().replace(".000Z", "+00:00"));
  expect(Math.abs((await scrollTop(page)) - before)).toBeLessThan(5);
  expect((await admin.from("appointments").select("id").eq("id", visitId)).data).toHaveLength(1);
});

test("a held visit lands on the 15-minute line under the finger, however the day is scrolled", async ({ page }) => {
  await openDay(page);
  const block = ui(page).locator("[data-block]").filter({ hasText: `${PREFIX}Ava` });
  const cdp = await page.context().newCDPSession(page);
  const ppm = Number(await grid(page).getAttribute("data-px-per-minute"));
  // Each from 10:00 (put back between): the drop goes to the nearest line.
  for (const { scroll, minutes, to } of [
    { scroll: 0, minutes: 38, to: 10 * 60 + 45 },
    { scroll: 60, minutes: 22, to: 10 * 60 + 15 },
    { scroll: 120, minutes: -23, to: 9 * 60 + 30 },
  ]) {
    await admin.from("appointment_items").update({ starts_at: at(10).toISOString(), ends_at: at(10, 45).toISOString() }).eq("id", itemId);
    await admin.from("appointments").update({ starts_at: at(10).toISOString(), ends_at: at(10, 45).toISOString() }).eq("id", visitId);
    await openDay(page);
    await grid(page).evaluate((el, top) => (el.scrollTop = top), scroll);
    const box = (await block.boundingBox())!;
    await touch(cdp, page, box.x + box.width / 2, box.y + 12, minutes * ppm, 600);
    await expect.poll(async () => (await startsAt()).slice(11, 16), { message: `${scroll}px` }).toBe(at(Math.floor(to / 60), to % 60).toISOString().slice(11, 16));
  }
});
