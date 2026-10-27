import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { daysBetween, todayIn } from "@/lib/scheduling/time";
import { admin, busyDay, SEED } from "../tests/db/helpers";
import { shiftBusiness } from "../e2e-week/time-machine";
import { freshAuth } from "./fresh-auth";

export const PASSWORD = "password123";

// Saved sign-ins, created by auth.setup.ts.
export const AUTH = {
  owner: "e2e/.auth/owner.json",
  manager: "e2e/.auth/manager.json",
  frontDesk: "e2e/.auth/front-desk.json",
  stylist: "e2e/.auth/stylist.json",
  // Harbor & Vine, the large demo salon.
  largeOwner: "e2e/.auth/large-owner.json",
  largeFrontDesk: "e2e/.auth/large-front-desk.json",
};

// A test that takes the browser offline on purpose: Chrome logs each request
// it couldn't send ("Failed to load resource: net::ERR_INTERNET_DISCONNECTED"),
// which no page can stop. Only that line is let through; anything our code
// throws (an uncaught "Failed to fetch") still fails the test.
export function allowOfflineLogs(pageErrors: string[]) {
  pageErrors.splice(0, pageErrors.length, ...pageErrors.filter((e) => e !== "Failed to load resource: net::ERR_INTERNET_DISCONNECTED"));
}

// A test that opens a page that isn't there on purpose: on the production
// build the page's shell has already been sent when `notFound()` runs inside
// its Suspense boundary, so React shows "We can't find that page" in the
// browser and logs error #419 ("could not finish this Suspense boundary").
// Only that line is let through (docs/backlog.md).
export function allowNotFoundLogs(pageErrors: string[]) {
  pageErrors.splice(0, pageErrors.length, ...pageErrors.filter((e) => !e.startsWith("Minified React error #419;")));
}

// Fails the test if the page logs a console error or throws. In dev this
// includes Next.js errors shown in the dev overlay, such as prerendering
// problems.
export const test = base.extend<{ freshAuth: void; pageErrors: string[] }>({
  // Every saved sign-in close to expiring is replaced before the test's
  // browser opens, including those a test opens pages with itself
  // (e2e/fresh-auth.ts).
  freshAuth: [
    async ({}, use) => {
      for (const file of Object.values(AUTH)) await freshAuth(file);
      await use();
    },
    { auto: true },
  ],
  pageErrors: [
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- only so the sign-in is fresh before the page opens
    async ({ freshAuth, page }, use) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors, "browser console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// Waits until React has hydrated the visible element matching selector.
// Before that, clicks change the DOM without updating React state, which
// tests (unlike people) are fast enough to hit. Hidden copies of earlier pages
// are skipped.
export async function waitForHydration(page: Page, selector: string) {
  await page.waitForFunction(
    (sel) =>
      [...document.querySelectorAll(sel)].some(
        (el) => el.checkVisibility() && Object.keys(el).some((key) => key.startsWith("__reactProps")),
      ),
    selector,
  );
}

// Asks Denise on the calendar: her face in the corner opens her panel, and
// the question goes in her message box.
export async function askOnCalendar(page: Page, question: string) {
  await waitForHydration(page, "[data-testid=denise-launcher]");
  await page.getByTestId("denise-launcher").click();
  const box = page.getByRole("form", { name: "Message Denise" });
  await box.getByRole("textbox").fill(question);
  await box.getByRole("button", { name: "Send" }).click();
}

// The visible page's main content. Next.js keeps pages you navigated away
// from mounted but hidden (so back/forward keep their state), and text and
// label queries would otherwise also match those hidden copies.
export function ui(page: Page) {
  return page.locator("main").filter({ visible: true });
}

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await waitForHydration(page, "input[name=email]");
  await ui(page).getByLabel("Email").fill(email);
  await ui(page).getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");
}

// The calendar's scale: px per minute, from the person's zoom.
export async function pxPerMinute(page: Page): Promise<number> {
  return Number(await ui(page).getByTestId("calendar-grid").getAttribute("data-px-per-minute"));
}

// The y of a time in a stylist's column, after scrolling the calendar so
// it's in view (and the column's box then).
export async function slotAt(page: Page, column: Locator, minute: number) {
  const start = Number(await ui(page).locator("[data-range-start]").getAttribute("data-range-start"));
  const ppm = await pxPerMinute(page);
  await ui(page)
    .getByTestId("calendar-grid")
    .evaluate((el, top) => (el.scrollTop = top), Math.max(0, (minute - start) * ppm - 200));
  const box = (await column.boundingBox())!;
  return { box, y: box.y + (minute - start) * ppm + 3, ppm };
}

// "Check in" in booking details, through its one warning listing anything
// the visit still needs (a new client's consultation form, say).
export async function checkIn(panel: Locator) {
  await panel.getByRole("button", { name: "Check in", exact: true }).click();
  const anyway = panel.getByRole("button", { name: "Check in anyway" });
  await expect(anyway.or(panel.getByTestId("visit-status").filter({ hasText: /^Checked in/ }))).toBeVisible();
  if (await anyway.isVisible()) await anyway.click();
  await expect(panel.getByTestId("visit-status")).toHaveText(/^Checked in/);
}

// Booking details' other actions (Running late, Edit booking, Undo
// check-in, Mark no-show, Cancel booking) are in the "⋯" menu in its footer.
export async function moreAction(panel: Locator, name: string) {
  const more = panel.getByRole("button", { name: "More actions" });
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  await panel.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name, exact: true }).click();
}

// The calendar toolbar's "More" menu: Waitlist, Walk-ins, Block time.
export async function toolbarMore(page: Page, name: string) {
  const more = ui(page).getByRole("button", { name: "More", exact: true });
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  await page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name, exact: true }).click();
}

// Check out: the main button once the client's checked in.
export async function checkOut(panel: Locator) {
  const primary = panel.getByTestId("primary-action");
  await expect(primary).toHaveText("Check out");
  await primary.click();
}

// One of booking details' tabs: Notes, Formula or History.
export async function visitTab(panel: Locator, name: "Notes" | "Formula" | "Photos" | "History") {
  await panel.getByRole("tab", { name, exact: true }).click();
}

// One of the client profile's history tabs.
export async function clientTab(page: Page, name: "Visits" | "Formulas" | "Photos" | "Patch tests" | "Forms") {
  await waitForHydration(page, "[role=tab]");
  await ui(page).getByRole("region", { name: "History" }).getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  return ui(page).getByRole("region", { name: "History" });
}

// "Before this visit (2)", opened to its checklist.
export async function openChecklist(panel: Locator) {
  const region = panel.getByRole("region", { name: "Before this visit" });
  const toggle = region.getByRole("button", { name: /^Before this visit/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return region;
}

// For tests about a busy today, whatever day they run: when today has no
// visits on the demo calendar (the salon is closed Sundays and Mondays),
// Maple & Ash's whole world moves back so the next day that has them is
// today, with its weekly hours turned to match (the week test's time
// machine), and the same day last week too. Returns the move back, for
// afterAll. Nothing moves when today already has visits.
export async function busyToday(): Promise<() => void> {
  const TZ = "America/Chicago";
  const days = daysBetween(todayIn(TZ), (await busyDay(TZ)).date);
  if (days > 0) shiftBusiness(SEED.business, TZ, -days);
  return () => {
    if (days > 0) shiftBusiness(SEED.business, TZ, days);
  };
}

// For a test file that sells or checks out: afterwards, puts back the stock
// its checkouts and sales took (and gave back: voids and refunds) and
// removes the sales it made, walk-ins included, so no other file, or the
// next run, sees them. Single worker: everything since the file started is
// its own. Call it once at the top of the file.
export function putBackSales() {
  let since = "";
  test.beforeAll(() => {
    since = new Date().toISOString();
  });
  test.afterAll(async () => {
    await undoSalesSince(since);
  });
}

export async function undoSalesSince(since: string) {
  const { data: moves, error } = await admin.from("stock_movements").select("id, product_id, location_id, change").in("reason", ["service_use", "sale"]).gte("created_at", since);
  if (error) throw error;
  const back = new Map<string, { product: string; location: string; change: number }>();
  for (const m of moves ?? []) {
    const key = `${m.product_id}:${m.location_id}`;
    const b = back.get(key) ?? { product: m.product_id, location: m.location_id, change: 0 };
    b.change += Number(m.change);
    back.set(key, b);
  }
  for (const b of back.values()) {
    if (Math.abs(b.change) < 0.005) continue;
    const { data: level } = await admin.from("stock_levels").select("on_hand").eq("product_id", b.product).eq("location_id", b.location).single();
    await admin.from("stock_levels").update({ on_hand: Number(level!.on_hand) - b.change }).eq("product_id", b.product).eq("location_id", b.location);
  }
  if (moves?.length) await admin.from("stock_movements").delete().in("id", moves.map((m) => m.id));
  // Points the sales earned (or spent), then the sales themselves.
  await admin.from("reward_points").delete().gte("created_at", since).not("sale_id", "is", null);
  const { error: salesError } = await admin.from("sales").delete().gte("created_at", since);
  if (salesError) throw salesError;
}

// Opens the calendar's display menu (the zoom and Fit all), named after the
// zoom it's on.
export async function openDisplayMenu(page: Page) {
  const dialog = page.locator("main").filter({ visible: true }).getByRole("dialog", { name: "Calendar display" });
  if (!(await dialog.count())) await page.locator("main").filter({ visible: true }).getByRole("button", { name: /^(Compact|Comfortable|Detailed)$/ }).click();
  await dialog.waitFor();
  return dialog;
}
