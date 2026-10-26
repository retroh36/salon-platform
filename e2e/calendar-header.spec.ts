// The stylist header row on the calendar: whatever is dragged, each column
// keeps its name and avatar. Dragging a header by its grip never blanks it
// (headers don't fade in again as they move), Escape cancels the drag, and
// a dragged visit or blocked time passes under the sticky header row, never
// over it. Saving a new order is in e2e/large-salon.spec.ts.
import type { Page } from "@playwright/test";
import { addDays, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
// A Tuesday clear of the seeded month and the other tests' days.
const DAY = addDays(startOfWeek(todayIn(TZ)), 64);

const headers = (page: Page) => ui(page).locator("[data-column-header]");
const names = (page: Page) => headers(page).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.split("\n")[1] ?? ""));

// Every header shown in full: opaque, with a name and an avatar.
async function allShown(page: Page) {
  const seen = await headers(page).evaluateAll((els) =>
    els.map((el) => ({ opacity: getComputedStyle(el).opacity, name: (el as HTMLElement).innerText.split("\n")[1] ?? "", avatar: !!el.querySelector(".rounded-full") })),
  );
  for (const h of seen) expect(h).toMatchObject({ opacity: "1", avatar: true, name: expect.stringMatching(/\w/) });
}

// The salon's own order (none set in the seed), in case a drag saved one.
async function clear() {
  await admin.from("time_blocks").delete().eq("location_id", L).eq("on_date", DAY);
  await admin.from("staff").update({ calendar_position: null }).eq("business_id", B).not("calendar_position", "is", null);
}
test.beforeAll(clear);
test.afterAll(clear);

test.use({ storageState: AUTH.owner, viewport: { width: 1440, height: 900 } });

async function openDay(page: Page) {
  await page.goto(`/calendar?date=${DAY}`);
  await waitForHydration(page, "[data-column-grip]");
}

test("a header dragged by its grip keeps its name and avatar, and Escape cancels the drag", async ({ page }) => {
  await openDay(page);
  const before = await names(page);
  expect(before.length).toBeGreaterThanOrEqual(3);
  const third = headers(page).nth(2);
  const grip = (await third.locator("[data-column-grip]").boundingBox())!;
  const last = (await headers(page).last().boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width * 0.75, grip.y + 10, { steps: 12 });

  // Mid-drag: the columns make room, and every header is still there in full.
  const dragged = headers(page).and(ui(page).locator("[data-dragging]"));
  await expect(dragged).toHaveCount(1);
  await expect(dragged).toContainText(before[2]);
  await expect.poll(() => names(page)).not.toEqual(before);
  await allShown(page);

  // Escape puts everything back, even with the button still held.
  await page.keyboard.press("Escape");
  await expect(ui(page).locator("[data-dragging]")).toHaveCount(0);
  await expect.poll(() => names(page)).toEqual(before);
  await page.mouse.up();
  await allShown(page);

  // Dropped where it started: nothing to save, every header back.
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width * 0.75, grip.y + 10, { steps: 8 });
  // A little left of its own middle: clearly its first place again.
  await page.mouse.move(grip.x + grip.width / 2 - 30, grip.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(ui(page).locator("[data-dragging]")).toHaveCount(0);
  await expect.poll(() => names(page)).toEqual(before);
  await allShown(page);
  const { data } = await admin.from("staff").select("calendar_position").eq("business_id", B).not("calendar_position", "is", null);
  expect(data).toEqual([]);
});

test("blocked time dragged up under the header row never covers a stylist's name", async ({ page }) => {
  await admin.from("time_blocks").insert({ business_id: B, location_id: L, staff_id: SEED.staff.bridget, kind: "meeting", note: "Header test", start_minute: 11 * 60, end_minute: 12 * 60, on_date: DAY });
  await openDay(page);
  const column = ui(page).getByRole("region", { name: "Bridget Callahan", exact: true });
  const block = column.getByRole("button", { name: /^Meeting/ });
  await expect(block).toBeVisible();
  // Scroll the day so the meeting starts just under the header row.
  await block.evaluate((el) => {
    const grid = el.closest("[data-testid=calendar-grid]")!;
    grid.scrollTop += el.getBoundingClientRect().top - grid.querySelector("[data-grid-header]")!.getBoundingClientRect().bottom;
  });
  const header = headers(page).filter({ hasText: "Bridget Callahan" });
  const summary = (await header.getByTestId("booked-summary").boundingBox())!;
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 6 - (box.y - summary.y) - 10, { steps: 8 });

  // What's on top where the header's lines are is the header itself.
  const onTop = (x: number, y: number) => page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest("[data-column-header]"), [x, y]);
  expect(await onTop(summary.x + 10, summary.y + summary.height / 2)).toBe(true);
  const avatarBox = (await header.locator(".rounded-full").first().boundingBox())!;
  expect(await onTop(avatarBox.x + avatarBox.width / 2, avatarBox.y + avatarBox.height / 2)).toBe(true);

  // Let go back where it was: the header's still whole.
  await page.mouse.move(box.x + 20, box.y + 6, { steps: 8 });
  await page.mouse.up();
  await allShown(page);
  await expect(header).toContainText("Bridget Callahan");
});
