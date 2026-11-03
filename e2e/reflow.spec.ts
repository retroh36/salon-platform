// Nothing cut off at an edge, with or without Denise's panel docked beside
// the page: the checkout's client header, the calendar's column headers and
// booking form, Scheduling's week, Events' pipeline, the Clients table, the
// booking site's dates, and Denise's bubble (never over a page's own
// buttons: it tucks to the edge, and pages leave room under their last row).
import type { Locator, Page } from "@playwright/test";
import { admin, busyDay, SEED } from "../tests/db/helpers";
import { AUTH, expect, putBackSales, test, ui, waitForHydration } from "./fixtures";

// The checkout drafts this file opens are removed afterwards.
putBackSales();

const B = SEED.business;
const PREFIX = `Rf${Date.now().toString(36)}`;
let clientId: string;

test.beforeAll(async () => {
  // A long name and a package covering two services: the header's worst case.
  const { data: client } = await admin
    .from("clients")
    .insert({ business_id: B, first_name: `${PREFIX}Maximiliana`, last_name: "Featherstonehaugh-Delacroix" })
    .select("id")
    .single();
  clientId = client!.id;
  const { data: services } = await admin.from("services").select("id, name").eq("business_id", B).in("name", ["Deep Conditioning", "Gloss / Toner"]);
  const { data: pkg } = await admin
    .from("client_packages")
    .insert({ business_id: B, client_id: clientId, name: `${PREFIX} treatments`, price_cents: 10000 })
    .select("id")
    .single();
  await admin.from("client_package_items").insert(services!.map((s) => ({ business_id: B, client_package_id: pkg!.id, service_id: s.id, total: 3, use_value_cents: 3000 })));
});

test.afterAll(async () => {
  await admin.from("sale_drafts").delete().eq("client_id", clientId);
  await admin.from("client_packages").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
});

test.use({ storageState: AUTH.owner, viewport: { width: 1180, height: 820 } });

// Every text in `texts` shows whole: its own width (measured exactly, since
// scrollWidth rounds a fraction of a pixel away) fits its box.
async function expectWhole(texts: Locator) {
  const over = await texts.evaluateAll((els) =>
    els.flatMap((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect().width;
      const box = el.getBoundingClientRect().width;
      return text > box + 0.01 ? [`${el.textContent} (${text.toFixed(1)} in ${box.toFixed(1)})`] : [];
    }),
  );
  expect(over).toEqual([]);
}

// `inner` lies inside `outer`, left to right.
async function expectInside(inner: Locator, outer: Locator) {
  const a = (await inner.boundingBox())!;
  const b = (await outer.boundingBox())!;
  expect(a.x).toBeGreaterThanOrEqual(b.x - 0.5);
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width + 0.5);
}

async function openDenise(page: Page) {
  await page.getByTestId("denise-bubble-launcher").click();
  await expect(page.getByRole("complementary", { name: "Denise" })).toBeVisible();
}

test("the checkout's client header keeps the name whole and the badges as pills, with Denise open", async ({ page }) => {
  await page.goto(`/checkout/new?client=${clientId}&from=/clients`);
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
  await waitForHydration(page, "#product-search");
  await openDenise(page);
  const ticket = page.getByRole("main", { name: "Ticket" });
  const name = ticket.getByTestId("checkout-client");
  await expect(name).toHaveText(`${PREFIX}Maximiliana Featherstonehaugh-Delacroix`);
  await expectWhole(name);
  // A pill per service, each on one line and inside the ticket.
  const pills = ticket.getByTestId("badge-package").locator("> span");
  await expect(pills).toHaveText(["Package: 3 Deep Conditionings left", "Package: 3 Gloss / Toners left"]);
  for (const pill of await pills.all()) {
    expect((await pill.boundingBox())!.height).toBeLessThanOrEqual(22);
    await expectInside(pill, ticket);
  }
  // The search box shows its whole placeholder.
  const search = ticket.getByLabel("Add a product: name, brand, SKU or scan");
  expect(await search.evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth)).toBe(true);
  // Quick-add tiles past the edge fade rather than stop dead, and only on
  // the side with more: the first tile is whole and unfaded.
  const strip = ticket.getByTestId("best-sellers").locator("xpath=..");
  if (await strip.evaluate((el) => el.scrollWidth > el.clientWidth)) {
    await expect(strip).toHaveAttribute("data-more-right", "true");
    await expect(ticket.getByRole("button", { name: "More products to the right" })).toBeVisible();
  }
  await expect(strip).not.toHaveAttribute("data-more-left");
  await expectInside(strip.getByRole("button").first(), strip);
});

test("the calendar's column headers and the booking form fit beside the side panel", async ({ page }) => {
  await page.goto(`/calendar?date=${(await busyDay("America/Chicago")).date}`);
  await waitForHydration(page, "section[data-staff-id]");
  await page.getByTestId("denise-launcher").click();
  await expectWhole(ui(page).getByTestId("column-hours").locator("span"));
  await ui(page).getByRole("button", { name: "New booking" }).click();
  const form = ui(page).getByRole("group", { name: "Service 1" });
  // The stylist has the whole row, as wide as the service.
  // (Service, then Stylist: a label's name includes its chosen option.)
  const service = (await form.getByRole("combobox").nth(0).boundingBox())!;
  const stylist = (await form.getByRole("combobox").nth(1).boundingBox())!;
  expect(Math.abs(stylist.width - service.width)).toBeLessThan(1);
});

// Testers found columns squeezed or cut off with Denise open: they keep a
// readable width and scroll sideways, with an arrow on the side with more.
async function expectScrollsWithArrows(page: Page, scroller: Locator, label: string) {
  await expect(scroller).toHaveJSProperty("scrollLeft", 0);
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(page.getByRole("button", { name: `${label} to the left` })).toHaveCount(0);
  await page.getByRole("button", { name: `${label} to the right` }).click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: `${label} to the left` })).toBeVisible();
}

test("with Denise open, the calendar keeps its width: she's a compact card under the stylists' headers", async ({ browser }) => {
  // Harbor & Vine: more stylists than fit, whatever the day.
  const page = await browser.newPage({ storageState: AUTH.largeFrontDesk, viewport: { width: 1180, height: 820 } });
  await page.goto("/calendar");
  await waitForHydration(page, "section[data-staff-id]");
  const grid = ui(page).getByTestId("calendar-grid");
  const before = (await grid.boundingBox())!.width;
  await page.getByTestId("denise-launcher").click();
  await expect(page.getByTestId("denise-says")).toBeVisible();
  const card = page.locator("aside[aria-label='Assistant and booking details']");
  await expect(card).toHaveAttribute("data-compact", "true");
  // Wait for it to slide in, then: the grid hasn't made room, columns keep
  // their width and still scroll with an arrow, and the card starts below
  // the header row, so every stylist's name and day stays in view.
  await expect.poll(async () => {
    const b = (await card.boundingBox())!;
    return b.x + b.width;
  }).toBeLessThanOrEqual(1180 - 15);
  expect(Math.abs((await grid.boundingBox())!.width - before)).toBeLessThan(1);
  for (const column of await ui(page).locator("section[data-staff-id]").all()) expect((await column.boundingBox())!.width).toBeGreaterThanOrEqual(151);
  const header = (await ui(page).locator("[data-grid-header]").boundingBox())!;
  const box = (await card.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(box.width).toBeLessThanOrEqual(384 + 1);
  // The arrow for more stylists sits just left of the card, never under it.
  const arrow = (await page.getByRole("button", { name: "More stylists to the right" }).boundingBox())!;
  expect(arrow.x + arrow.width).toBeLessThanOrEqual(box.x);
  await expectScrollsWithArrows(page, grid, "More stylists");
  // Booking details is the full-height panel again, which the page makes room for.
  await card.getByRole("tab", { name: "Booking details" }).click();
  await expect(card).not.toHaveAttribute("data-compact", "true");
  await page.close();
});

test("with Denise open, Scheduling keeps its full width: she's a compact card over the corner", async ({ page }) => {
  await page.goto("/scheduling");
  const grid = ui(page).getByRole("grid", { name: /^Team schedule/ });
  await waitForHydration(page, "[data-testid=denise-bubble-launcher]");
  const before = (await grid.boundingBox())!.width;
  await openDenise(page);
  const card = page.getByRole("complementary", { name: "Denise" });
  await expect(card).toHaveAttribute("data-overlay", "true");
  expect(Math.abs((await grid.boundingBox())!.width - before)).toBeLessThan(1);
  for (const day of await grid.locator("[role=columnheader][data-day]").all()) expect((await day.boundingBox())!.width).toBeGreaterThanOrEqual(91);
  const box = (await card.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(352 + 1);
  expect(box.height).toBeLessThanOrEqual(448 + 1);
});

test("Scheduling shows the whole week, Sunday included", async ({ page }) => {
  await page.goto("/scheduling");
  const grid = ui(page).getByRole("grid", { name: /^Team schedule/ });
  await expect(grid).toBeVisible();
  const days = grid.locator("[role=columnheader][data-day]");
  await expect(days).toHaveCount(7);
  await expectInside(days.last(), grid.locator(".."));
  expect(await grid.locator("..").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("Events shows every stage of the pipeline", async ({ page }) => {
  await page.goto("/events");
  const pipeline = ui(page).getByRole("list", { name: "Pipeline" });
  await expect(pipeline.locator("> li")).toHaveCount(6);
  for (const stage of await pipeline.locator("> li").all()) await expectInside(stage, pipeline);
  await expect(pipeline.getByTestId("column-completed")).toBeInViewport();
});

test("Clients keeps Spend on screen at iPad width", async ({ page }) => {
  await page.goto("/clients");
  const table = ui(page).getByRole("table", { name: "Clients" });
  await expect(table.getByRole("columnheader", { name: /Spend/ })).toBeVisible();
  expect(await table.evaluate((el) => el.parentElement!.scrollWidth <= el.parentElement!.clientWidth)).toBe(true);
});

test("Denise's bubble never covers a page's own buttons, and the sidebar opens her too", async ({ page }) => {
  await page.goto("/promotions");
  const bubble = page.getByTestId("denise-bubble-launcher");
  await waitForHydration(page, "[data-testid=denise-bubble-launcher]");
  // Whatever is scrolled under it, it never sits on a button or link: it
  // tucks to the edge instead.
  const covered = async () => {
    const box = (await bubble.boundingBox())!;
    return page.evaluate((b) => {
      const hits = new Set<Element>();
      for (const x of [b.x + 2, b.x + b.width / 2, b.x + b.width - 2])
        for (const y of [b.y + 2, b.y + b.height / 2, b.y + b.height - 2])
          for (const el of document.elementsFromPoint(x, y)) {
            const use = el.closest("a[href], button, input, select, textarea");
            if (use && !use.closest("[data-testid=denise-bubble-launcher]")) hits.add(use);
          }
      return [...hits].map((el) => el.textContent?.trim() || el.tagName);
    }, box);
  };
  const main = page.locator("main").first();
  const height = await main.evaluate((el) => el.scrollHeight);
  let tuckedOnce = false;
  for (let y = 0; y <= height; y += 120) {
    await main.evaluate((el, top) => el.scrollTo(0, top), y);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.waitForTimeout(300);
    expect(await covered(), `scrolled to ${y}`).toEqual([]);
    if (await bubble.getAttribute("data-tucked")) tuckedOnce = true;
  }
  // The page's End and Message buttons pass under its spot on the way down.
  expect(tuckedOnce).toBe(true);
  // At the end of the page there's room under the last row: the bubble is whole.
  await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(bubble).not.toHaveAttribute("data-tucked");
  // The sidebar's "Ask Denise" opens her as well.
  await page.getByTestId("sidebar-footer").getByRole("button", { name: "Ask Denise" }).click();
  await expect(page.getByRole("complementary", { name: "Denise" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the booking site's dates show whole days only", async ({ page }) => {
    await page.goto("/book/maple-and-ash");
    const flow = page.getByTestId("booking-flow");
    await waitForHydration(page, "[data-testid=booking-flow] button");
    await flow.getByRole("button", { name: /^Men's Cut\s*\d/ }).tap();
    await flow.getByRole("button", { name: "Continue" }).tap();
    await flow.getByRole("button", { name: /^No preference/ }).tap();
    await flow.getByRole("button", { name: "Continue" }).tap();
    const strip = flow.getByRole("radiogroup", { name: "Date" });
    await expect(strip.getByRole("radio").first()).toBeVisible();
    // Each day is all in view or all out of it: never a sliver.
    const box = (await strip.boundingBox())!;
    const slivers = await strip.getByRole("radio").evaluateAll(
      (days, edge) =>
        days.flatMap((d) => {
          const r = d.getBoundingClientRect();
          const inside = r.left >= edge.left - 0.5 && r.right <= edge.right + 0.5;
          const outside = r.right <= edge.left + 0.5 || r.left >= edge.right - 0.5;
          return inside || outside ? [] : [d.getAttribute("aria-label")];
        }),
      { left: box.x, right: box.x + box.width },
    );
    expect(slivers).toEqual([]);
  });
});
