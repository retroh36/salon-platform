import type { Page } from "@playwright/test";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, openDisplayMenu, test, ui, waitForHydration } from "./fixtures";

// The calendar at a big salon (Harbor & Vine, supabase/seed-large.sql: 35
// stylists, about ten off any day), on a laptop and an iPad: who's off is
// hidden behind a chip, columns keep a readable width and scroll sideways
// under a sticky header and time column, Fit all squeezes everyone on in
// Compact, saved views pick who shows and in what order (remembered), and
// owners set the salon's order by dragging a header or on Team. Screenshots
// go to e2e/screenshots/ (not committed).

const LARGE = SEED.large;
const TAG = `Lv${Date.now().toString(36)}`;
const LAPTOP = { width: 1440, height: 900 };
const IPAD = { width: 1180, height: 820 };
const IPAD_PORTRAIT = { width: 820, height: 1180 };
// A column's narrowest, in px (9.5rem).
const COLUMN_MIN = 152;

// The salon's calendar order as the seed sets it (stylist …00NN at NN − 10),
// before the file starts, whatever an earlier run left, and again after.
async function seededOrder() {
  const { data } = await admin.from("staff").select("id").eq("business_id", LARGE.business).gte("id", "d1000000-0000-4000-8000-000000000010").lte("id", "d1000000-0000-4000-8000-000000000099");
  for (const s of data ?? []) await admin.from("staff").update({ calendar_position: Number(s.id.slice(-2)) - 10 }).eq("id", s.id);
}

test.beforeAll(seededOrder);

// Puts back what the file changed: its views (and any an earlier run left,
// all named "Lv…"), the seeded order, and the front desk's zoom.
test.afterAll(async () => {
  await admin.from("calendar_views").delete().eq("business_id", LARGE.business).like("name", "Lv%");
  await admin.from("staff").update({ calendar_zoom: "comfortable" }).eq("email", "frontdesk@harborvine.test");
  await seededOrder();
});

const grid = (page: Page) => ui(page).getByTestId("calendar-grid");
const headers = (page: Page) => ui(page).locator("[data-column-header]");
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/large-salon-${name}.png` });

async function openCalendar(page: Page) {
  await page.goto("/calendar");
  await expect(ui(page).getByTestId("calendar-date")).toBeVisible();
  await waitForHydration(page, "[data-testid=off-chip]");
}

// The names of the columns shown, left to right.
async function columnNames(page: Page): Promise<string[]> {
  return ui(page).locator("section[data-staff-id]").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")!));
}

// Who's off today, and why, from the "off today" list.
async function offList(page: Page): Promise<string[]> {
  await ui(page).getByTestId("off-chip").click();
  const list = ui(page).getByRole("dialog", { name: "Off today" }).getByRole("list", { name: "Who's off" });
  return list.getByRole("listitem").allInnerTexts();
}

async function checkLayout(page: Page) {
  // Everyone shown keeps a readable width, so the grid scrolls sideways.
  const widths = await headers(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(COLUMN_MIN - 1);
  expect(await grid(page).evaluate((el) => el.scrollWidth > el.clientWidth + 100)).toBe(true);
  // Scrolled across and down, the stylists' header and the time column stay put.
  await grid(page).evaluate((el) => {
    el.scrollLeft = 900;
    el.scrollTop = 300;
  });
  const box = (await grid(page).boundingBox())!;
  const header = (await ui(page).locator("[data-grid-header]").boundingBox())!;
  expect(Math.abs(header.y - box.y)).toBeLessThan(3);
  const time = (await ui(page).locator("[data-hour-label]").first().evaluate((el) => el.parentElement!.getBoundingClientRect().left))!;
  expect(Math.abs(time - box.x)).toBeLessThan(3);
  await grid(page).evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
}

for (const [device, viewport] of [
  ["laptop", LAPTOP],
  ["ipad", IPAD],
] as const) {
  test.describe(device === "ipad" ? "on an iPad" : "on a laptop", () => {
    test.use({ storageState: AUTH.largeFrontDesk, viewport, hasTouch: device === "ipad" });

    test("hides who's off behind a chip, keeps columns readable and scrolls sideways under a sticky header", async ({ page }) => {
      await openCalendar(page);
      const chip = ui(page).getByTestId("off-chip");
      const count = Number((await chip.innerText()).match(/^(\d+) off today$/)![1]);
      expect(count).toBeGreaterThanOrEqual(10);
      const shown = await columnNames(page);
      expect(shown.length + count).toBe(LARGE.stylists);
      await checkLayout(page);
      await shot(page, `${device}`);

      // The list says who and why; none of them has a column.
      const off = await offList(page);
      expect(off).toHaveLength(count);
      expect(off.some((row) => row.includes("Day off"))).toBe(true);
      const today = await page.evaluate(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }));
      const { data: away } = await admin
        .from("staff_time_off")
        .select("reason, start_minute, staff_id")
        .eq("business_id", LARGE.business)
        .eq("status", "approved")
        .lte("starts_on", today)
        .gte("ends_on", today);
      const { data: people } = await admin.from("staff").select("id, first_name, last_name").eq("business_id", LARGE.business);
      const nameOf = (id: string) => people!.filter((p) => p.id === id).map((p) => `${p.first_name} ${p.last_name}`)[0];
      for (const t of away!.filter((t) => t.start_minute === null)) {
        const name = nameOf(t.staff_id);
        expect(off.find((row) => row.includes(name))).toMatch(t.reason === "sick" ? /Sick/ : /Vacation · Lisbon|Personal/);
        expect(shown).not.toContain(name);
      }
      // Someone off for part of the day still shows, greyed for those hours.
      for (const t of away!.filter((t) => t.start_minute !== null)) {
        const name = nameOf(t.staff_id);
        await expect(ui(page).getByRole("region", { name }).locator("[data-time-off]")).toContainText("Time off: Personal · Dentist");
      }
      await shot(page, `${device}-off-today`);

      // Shown anyway: everyone, the ones off greyed all day.
      await ui(page).getByLabel("Show them on the calendar anyway").check();
      await expect(ui(page).locator("section[data-staff-id]")).toHaveCount(LARGE.stylists);
      await expect(chip).toHaveText(new RegExp(`^${count} off today.*shown$`));
      await page.keyboard.press("Escape");
    });

    test("fits everyone on screen in Compact with Fit all, and remembers it", async ({ page }) => {
      await openCalendar(page);
      await (await openDisplayMenu(page)).getByRole("radio", { name: "Compact" }).click();
      await ui(page).getByRole("button", { name: "Fit all" }).click();
      await expect(ui(page).getByRole("button", { name: "Fit all" })).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Escape");
      await expect(grid(page)).toHaveAttribute("data-fit-all", "true");
      expect(await grid(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      // Names shorten (to initials if need be), never spill.
      const spill = await headers(page).evaluateAll((els) => els.some((el) => el.scrollWidth > el.clientWidth + 1));
      expect(spill).toBe(false);
      await shot(page, `${device}-fit-all`);

      // Remembered on this device (once the zoom has saved).
      await expect.poll(async () => (await admin.from("staff").select("calendar_zoom").eq("email", "frontdesk@harborvine.test").single()).data!.calendar_zoom, { timeout: 15_000 }).toBe("compact");
      await page.reload();
      await expect(grid(page)).toHaveAttribute("data-fit-all", "true");
      // Not in the other zooms: the columns are readable again.
      await waitForHydration(page, "[role=radio]");
      await (await openDisplayMenu(page)).getByRole("radio", { name: "Comfortable" }).click();
      await expect(grid(page)).not.toHaveAttribute("data-fit-all");
      await expect(ui(page).getByRole("button", { name: "Fit all" })).toHaveCount(0);
    });
  });
}

test.describe("saved views", () => {
  test.use({ storageState: AUTH.largeFrontDesk, viewport: IPAD, hasTouch: true });

  test("anyone makes their own: who's in it and in what order, remembered on this device", async ({ page }) => {
    await openCalendar(page);
    const [a, b, c] = (await columnNames(page)).slice(0, 3);
    const views = ui(page).getByRole("button", { name: /^Department or view/ });
    await views.click();
    // The salon's shared views are there for everyone.
    await expect(ui(page).getByRole("option", { name: "Color team" })).toBeVisible();
    await ui(page).getByRole("option", { name: "New view…" }).click();

    const editor = page.getByRole("dialog", { name: "New view" });
    await editor.getByLabel("Name").fill(`${TAG} My section`);
    // Only owners share views.
    await expect(editor.getByLabel("Share with everyone at the salon")).toHaveCount(0);
    for (const name of [a, b, c]) {
      await editor.getByLabel("Find a stylist").fill(name);
      await editor.getByRole("list", { name: "Stylists" }).getByLabel(name).check();
    }
    await editor.getByRole("button", { name: `Move ${c} up` }).click();
    await editor.getByRole("button", { name: `Move ${c} up` }).click();
    await shot(page, "view-editor");
    await editor.getByRole("button", { name: "Save view" }).click();
    await expect(editor).toHaveCount(0);

    await expect(views).toHaveAccessibleName(`Department or view ${TAG} My section`);
    await expect.poll(() => columnNames(page)).toEqual([c, a, b]);
    await shot(page, "my-view");
    const { data } = await admin.from("calendar_views").select("owner_staff_id").eq("name", `${TAG} My section`).single();
    expect(data!.owner_staff_id).not.toBeNull();

    // Remembered on this device.
    await page.reload();
    await expect.poll(() => columnNames(page)).toEqual([c, a, b]);

    // And deleted again, back to everyone.
    await waitForHydration(page, "[aria-haspopup=listbox]");
    await views.click();
    await ui(page).getByRole("option", { name: `Edit ${TAG} My section…` }).click();
    const edit = page.getByRole("dialog", { name: `Edit ${TAG} My section` });
    await edit.getByRole("button", { name: "Delete view" }).click();
    await edit.getByRole("group", { name: "Delete view" }).getByRole("button", { name: "Delete" }).click();
    await expect(views).toHaveAccessibleName("Department or view All departments");
    expect((await columnNames(page)).length).toBeGreaterThan(20);
  });

  test("a department view shows only those stylists", async ({ page }) => {
    await openCalendar(page);
    await ui(page).getByRole("button", { name: /^Department or view/ }).click();
    await ui(page).getByRole("option", { name: "Nails & skin" }).click();
    const names = await columnNames(page);
    const { data: team } = await admin.from("staff").select("first_name, last_name, staff_services(service:services(category))").eq("business_id", LARGE.business).eq("role", "stylist");
    const nailsAndSkin = team!.filter((s) => s.staff_services.some((x) => ["Nails", "Skin", "Brows & Lashes"].includes(x.service!.category))).map((s) => `${s.first_name} ${s.last_name}`);
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) expect(nailsAndSkin).toContain(n);
    await expect(ui(page).locator("[data-block][data-family=nails]").first()).toBeVisible();
    await shot(page, "nails-and-skin");
  });
});

test.describe("the salon's order", () => {
  test.use({ storageState: AUTH.largeOwner, viewport: LAPTOP });

  test("owners drag a column header to a new place, for everyone", async ({ page }) => {
    await openCalendar(page);
    const [first, second, third] = await columnNames(page);
    const ids = await ui(page).locator("section[data-staff-id]").evaluateAll((els) => els.slice(0, 3).map((el) => el.getAttribute("data-staff-id")!));
    const grip = headers(page).first().locator("[data-column-grip]");
    const from = (await grip.boundingBox())!;
    const target = (await headers(page).nth(2).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width * 0.75, from.y + 20, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => columnNames(page).then((n) => n.slice(0, 3))).toEqual([second, third, first]);
    // Saved for everyone, and still in place after a reload.
    const saved = async () => {
      const { data } = await admin.from("staff").select("id, calendar_position").in("id", ids);
      return [...data!].sort((x, y) => x.calendar_position! - y.calendar_position!).map((x) => x.id);
    };
    await expect.poll(saved).toEqual([ids[1], ids[2], ids[0]]);
    await page.reload();
    await expect.poll(() => columnNames(page).then((n) => n.slice(0, 3))).toEqual([second, third, first]);
  });

  test("or on Team → Calendar order", async ({ page }) => {
    await page.goto("/team");
    await ui(page).getByRole("link", { name: "Calendar order" }).click();
    await expect(page).toHaveURL("/team/order");
    await waitForHydration(page, "[data-reorder-row] button");
    const list = ui(page).getByRole("list", { name: "Calendar order" });
    const rows = () => list.locator("[data-reorder-row]").evaluateAll((els) => els.map((el) => el.getAttribute("data-reorder-row")));
    const before = await rows();
    expect(before).toHaveLength(LARGE.stylists);
    // The second one up to first.
    await list.getByRole("button", { name: /^Move .* up$/ }).nth(1).click();
    await ui(page).getByRole("button", { name: "Save order" }).click();
    await expect(ui(page).getByText("Saved. The calendar shows stylists in this order.")).toBeVisible();
    const { data } = await admin.from("staff").select("id").in("id", before.slice(0, 2) as string[]).order("calendar_position");
    expect(data!.map((s) => s.id)).toEqual([before[1], before[0]]);
    await shot(page, "team-calendar-order");
  });

  test("the front desk can't change it", async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH.largeFrontDesk });
    await openCalendar(page);
    await expect(headers(page).first().locator("[data-column-grip]")).toHaveCount(0);
    await page.goto("/team/order");
    await expect(page).toHaveURL("/team");
    await page.close();
  });
});

test.describe("on an iPad held upright", () => {
  test.use({ storageState: AUTH.largeFrontDesk, viewport: IPAD_PORTRAIT, hasTouch: true });

  test("still scrolls sideways under a sticky header", async ({ page }) => {
    await openCalendar(page);
    await (await openDisplayMenu(page)).getByRole("radio", { name: "Comfortable" }).click();
    await page.keyboard.press("Escape");
    await checkLayout(page);
    await shot(page, "ipad-portrait");
  });
});
