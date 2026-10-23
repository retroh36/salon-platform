import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
// A Tuesday clear of the other tests' days: Bridget works 9-1.
const DAY = addDays(startOfWeek(todayIn(TZ)), 141);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const PREFIX = `Cl${Date.now().toString(36)}`;

async function clear() {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
}
test.afterAll(async () => {
  await clear();
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

async function book(first: string, service: string, hour: number, minute: number, minutes: number) {
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}${first}`, last_name: "Long-Surname" }).select("id").single();
  const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", service).single();
  const start = at(hour, minute), end = new Date(start.getTime() + minutes * 60_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: c!.id, starts_at: start.toISOString(), ends_at: end.toISOString() }).select("id").single();
  const { error } = await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: s!.id, staff_id: SEED.staff.bridget, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: minutes, price_cents: 0 });
  expect(error).toBeNull();
}

async function openDay(page: Page) {
  await page.goto(`/calendar?date=${DAY}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
  await waitForHydration(page, "section[data-staff-id]");
}

test.use({ storageState: AUTH.frontDesk, viewport: { width: 1440, height: 1000 } });

test("short visits show name and time on one line, with the details on hover", async ({ page }) => {
  await clear();
  await book("Tiny", "Bang Trim", 10, 0, 15);
  await book("Next", "Women's Cut & Style", 10, 15, 60);
  await openDay(page);
  const bridget = ui(page).getByRole("region", { name: "Bridget Callahan", exact: true });
  const short = bridget.getByRole("button", { name: new RegExp(`${PREFIX}Tiny`) });
  const next = bridget.getByRole("button", { name: new RegExp(`${PREFIX}Next`) });

  // One line: the name (shortened if need be) and the whole time range.
  await expect(short).toHaveText(new RegExp(`${PREFIX}Tiny.* · 10(am)?–10:15(am)?$`));
  const nameLine = short.locator("span.truncate").first();
  expect(await nameLine.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");

  await short.hover();
  const hint = page.getByRole("tooltip");
  await expect(hint).toBeVisible();
  await expect(hint.locator("p")).toHaveText([`${PREFIX}Tiny Long-Surname`, "Bang Trim", "10am–10:15am · Bridget Callahan", "Booked"]);
  await page.mouse.move(5, 5);
  await expect(hint).toBeHidden();

  // A full-size visit has the tooltip too, for its status and the rest.
  await next.hover();
  await expect(page.getByRole("tooltip").locator("p").first()).toHaveText(`${PREFIX}Next Long-Surname`);
  await page.mouse.move(5, 5);

  // Selecting the short one draws its outline inside it, clear of the next.
  await short.click();
  const ring = short.locator("[data-ring=selected]");
  await expect(ring).toBeVisible();
  const [r, s, n] = await Promise.all([ring.boundingBox(), short.boundingBox(), next.boundingBox()]);
  expect(r!.y).toBeGreaterThanOrEqual(s!.y - 0.5);
  expect(r!.y + r!.height).toBeLessThanOrEqual(s!.y + s!.height + 0.5);
  expect(r!.y + r!.height).toBeLessThanOrEqual(n!.y + 0.5);
  // A subtle inset ring in the brand blue, not a heavy near-black outline.
  const shadow = await ring.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).toContain("inset");
  expect(shadow).not.toContain("rgb(23, 39, 59)");
});

test("the key is one small button under the calendar, with Denise at the end of its row", async ({ page }) => {
  await openDay(page);
  const launcher = page.getByTestId("denise-launcher");
  await expect(launcher).toBeVisible();
  // Folded away until asked for.
  await expect(page.getByRole("list", { name: "Service families" })).toHaveCount(0);
  const legend = page.getByRole("button", { name: "Key" });
  const [l, g] = await Promise.all([launcher.boundingBox(), legend.boundingBox()]);
  // On the legend's row, at its right end.
  expect(Math.abs(l!.y + l!.height / 2 - (g!.y + g!.height / 2))).toBeLessThan(l!.height);
  expect(l!.x).toBeGreaterThan(g!.x + g!.width);
  // Below the calendar's scrolling area, so it never covers appointments.
  const calendarBottom = await ui(page)
    .locator("section[data-staff-id]")
    .first()
    .evaluate((el) => {
      let node: HTMLElement | null = el.parentElement;
      while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
      return (node ?? el).getBoundingClientRect().bottom;
    });
  expect(l!.y).toBeGreaterThanOrEqual(calendarBottom - 0.5);
  // It opens the colors, statuses and levels.
  await legend.click();
  const key = page.getByRole("dialog", { name: "Calendar key" });
  await expect(key.getByRole("list", { name: "Service families" })).toContainText("Color");
  await expect(key.getByTestId("status-legend")).toContainText(/Checked in.*Checked out.*No-show/);
  await expect(key.getByTestId("level-legend")).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(key).toBeHidden();
  await launcher.click();
  await expect(page.locator("aside[aria-label]").first()).toBeVisible();
  await expect(launcher).toBeHidden();
});

test("shows each stylist's level as a colored ring, badge and bar, explained by the legend", async ({ page }) => {
  await openDay(page);
  const header = (name: string) => ui(page).locator("[data-column-header]").filter({ hasText: name }).first();
  const colors = new Set<string>();
  for (const [name, level] of [["Bridget Callahan", "master"], ["Nola Brennan", "senior"], ["Shae Morgan", "artisan"]] as const) {
    await expect(header(name)).toHaveAttribute("data-level", level);
    // A 4px bar along the top of the column, in the level's color.
    const bar = header(name).getByTestId("level-bar");
    expect((await bar.boundingBox())!.height).toBeCloseTo(4, 1);
    const color = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
    colors.add(color);
    // The avatar: a 3px ring in the same color, and a badge so it isn't color alone.
    const ring = header(name).locator(`span[data-level=${level}] > span`).first();
    expect(await ring.evaluate((el) => [getComputedStyle(el).outlineWidth, getComputedStyle(el).outlineColor])).toEqual(["3px", color]);
    await expect(header(name).locator(`[data-level-badge=${level}]`)).toBeVisible();
  }
  expect(colors.size).toBe(3);
  // The key has the same badges; the calendar names no levels otherwise.
  await ui(page).getByRole("button", { name: "Key" }).click();
  const legend = ui(page).getByTestId("level-legend");
  for (const level of ["master", "senior", "artisan"]) await expect(legend.locator(`[data-level-badge=${level}]`)).toBeVisible();
  await expect(legend).toHaveText(/Master.*Senior.*Artisan/);
  await expect(ui(page).getByTestId("calendar-grid")).not.toContainText(/Master|Senior|Artisan|Stylist\b/);
});

test("each stylist's header shows their day at a glance", async ({ page }) => {
  await clear();
  await book("Glance", "Women's Cut & Style", 9, 0, 60);
  await book("Glance2", "Bang Trim", 10, 0, 15);
  await openDay(page);
  const summary = ui(page).locator("[data-column-header]").filter({ hasText: "Bridget" }).getByTestId("booked-summary");
  await expect(summary).toHaveAttribute("title", "2 visits · 1h 15m booked");
  // Shortened to fit if need be, never cut off with an ellipsis.
  await expect(summary).toHaveText(/^2 (visits )?· 1h 15m( booked)?$/);
  await expect(ui(page).locator("[data-column-header]").filter({ hasText: "Nola Brennan" }).getByTestId("booked-summary")).toHaveText("No bookings");
  // Narrower columns get the shorter form, whole.
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(summary).toHaveText(/^2 (visits )?· 1h 15m( booked)?$/);
  expect(await summary.locator("span").evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5)).toBe(true);
});

test("the stylist menu opens below the header, inside the screen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Today, so stylists have the menu.
  await page.goto("/calendar");
  await waitForHydration(page, "section[data-staff-id]");
  const header = ui(page).locator("[data-column-header]").filter({ has: page.getByRole("button", { name: /^More for / }) }).last();
  const button = header.getByRole("button", { name: /^More for / });
  await button.click();
  const dialog = page.getByRole("dialog", { name: /'s day$/ });
  await expect(dialog).toBeVisible();
  const [d, h] = [(await dialog.boundingBox())!, (await header.boundingBox())!];
  // Below the name and hours, never over them, and on screen.
  expect(d.y).toBeGreaterThanOrEqual(h.y + h.height);
  expect(d.x).toBeGreaterThanOrEqual(0);
  expect(d.x + d.width).toBeLessThanOrEqual(1280);
  // The buttons each fit on one line.
  for (const b of await dialog.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeLessThanOrEqual(34);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the current-time pill takes the hour label's place when they'd meet", async ({ page }) => {
  await page.clock.setFixedTime(at(10, 3));
  await openDay(page);
  await expect(ui(page).getByRole("img", { name: "Now, 10:03am" })).toBeVisible();
  await expect(ui(page).locator("[data-hour-label='600']")).toHaveCSS("opacity", "0");
  await expect(ui(page).locator("[data-hour-label='660']")).toHaveCSS("opacity", "1");
});

test("Ask Denise's example names a stylist on the team", async ({ page }) => {
  await openDay(page);
  const placeholder = await ui(page).getByRole("textbox", { name: /Ask Denise/ }).getAttribute("placeholder");
  expect(placeholder).toMatch(/^Find a haircut with (Bridget|Gil|Hannah|Lois|Shae|Sandra|Nola) after 1 PM$/);
});

test("the sidebar footer keeps the name, sign-out and Powered by Maestra apart", async ({ page }) => {
  for (const [width, height] of [[1440, 900], [1280, 640]]) {
    await page.setViewportSize({ width, height });
    await openDay(page);
    const footer = page.getByTestId("sidebar-footer");
    const boxes = await Promise.all([footer.getByText("Sam", { exact: true }), footer.getByText("Front desk"), footer.getByRole("button", { name: "Sign out" }), footer.getByTestId("powered-by")].map(async (l) => (await l.boundingBox())!));
    const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `${i} and ${j} at ${width}x${height}`).toBe(false);
    // All on screen, and clear of the navigation above.
    expect(boxes[3].y + boxes[3].height).toBeLessThanOrEqual(height);
    const nav = (await page.getByRole("navigation", { name: "Main" }).first().boundingBox())!;
    expect(nav.y + nav.height).toBeLessThanOrEqual((await footer.boundingBox())!.y + 1);
  }
});
