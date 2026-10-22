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

  // One line: the name (shortened if need be) and the time.
  await expect(short).toHaveText(new RegExp(`${PREFIX}Tiny.* · 10am`));
  const nameLine = short.locator("span.truncate").first();
  expect(await nameLine.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");

  await short.hover();
  const hint = page.getByRole("tooltip");
  await expect(hint).toBeVisible();
  await expect(hint.locator("p")).toHaveText([`${PREFIX}Tiny Long-Surname`, "Bang Trim", "10am–10:15am · Bridget Callahan", "Booked"]);
  await page.mouse.move(5, 5);
  await expect(hint).toBeHidden();

  // A full-size visit shows everything itself: no tooltip.
  await next.hover();
  await expect(page.getByRole("tooltip")).toBeHidden();

  // Selecting the short one draws its outline inside it, clear of the next.
  await short.click();
  const ring = short.locator("[data-ring=selected]");
  await expect(ring).toBeVisible();
  const [r, s, n] = await Promise.all([ring.boundingBox(), short.boundingBox(), next.boundingBox()]);
  expect(r!.y).toBeGreaterThanOrEqual(s!.y - 0.5);
  expect(r!.y + r!.height).toBeLessThanOrEqual(s!.y + s!.height + 0.5);
  expect(r!.y + r!.height).toBeLessThanOrEqual(n!.y + 0.5);
  expect(await ring.evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset");
});

test("Denise sits in the legend bar, not on top of the calendar", async ({ page }) => {
  await openDay(page);
  const launcher = page.getByTestId("denise-launcher");
  await expect(launcher).toBeVisible();
  const legend = page.getByRole("list", { name: "Service families" });
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
  await launcher.click();
  await expect(page.locator("aside[aria-label]").first()).toBeVisible();
  await expect(launcher).toBeHidden();
});

test("shows each stylist's level as color only: a ring, a bar and the legend", async ({ page }) => {
  await openDay(page);
  const levelColor = (level: string) => page.evaluate((l) => getComputedStyle(document.documentElement).getPropertyValue(`--color-level-${l}`).trim(), level);
  const header = (name: string) => ui(page).locator("[data-level]").filter({ hasText: name }).first();
  for (const [name, level] of [["Bridget Callahan", "master"], ["Nola Brennan", "senior"], ["Shae Morgan", "artisan"]] as const) {
    await expect(header(name)).toHaveAttribute("data-level", level);
    // The bar along the top of the column, in the level's color.
    const bar = header(name).getByTestId("level-bar");
    const rgb = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
    const hex = await levelColor(level);
    expect(rgb).toBe(`rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`);
    // The ring around the avatar.
    await expect(header(name).locator(`span[data-level=${level}]`)).toBeVisible();
  }
  // No level text on the calendar, only in the legend.
  await expect(ui(page).getByTestId("calendar-grid")).not.toContainText(/Master|Senior|Artisan/);
  const legend = ui(page).getByTestId("level-legend");
  await expect(legend).toContainText("Master");
  await expect(legend).toContainText("Senior");
  await expect(legend).toContainText("Artisan");
});
