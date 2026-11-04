import type { Page } from "@playwright/test";
import { admin, SEED } from "../tests/db/helpers";
import { checkout } from "./checkout-helpers";
import { AUTH, expect, putBackSales, test, waitForHydration } from "./fixtures";

// Stock and sales this file uses are put back afterwards.
putBackSales();

// The booking site's Review step and what follows it: a last-minute special
// picked with the time is on Review from the start, on the confirmation and
// in the client's account, and comes off at checkout; a special the client
// can't have says why before they book; and the price at Review is exact
// once stylists are known, and the confirmation matches it.

const B = SEED.business;
const SLUG = "maple-and-ash";
const RUN = Date.now().toString(36);
const SPECIAL = `Br${RUN} Week`;
const newPhone = () => `(4${String(Math.floor(Math.random() * 90) + 10)}) 555-01${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
test.use({ ...phone, storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

const flow = (page: Page) => page.getByTestId("booking-flow");
const cont = (page: Page) => flow(page).getByRole("button", { name: "Continue" });

test.beforeEach(async () => {
  await admin.from("rate_limits").delete().neq("key", "");
});

test.afterAll(async () => {
  const { data } = await admin.from("clients").select("id").eq("business_id", B).like("first_name", `Br${RUN}%`);
  const ids = (data ?? []).map((c) => c.id);
  if (ids.length) {
    await admin.from("appointments").delete().in("client_id", ids);
    await admin.from("clients").delete().in("id", ids);
  }
  await admin.from("promotions").delete().eq("business_id", B).like("name", `Br${RUN}%`);
});

// Server actions answer slowly while this is on, so a test can see what a
// step shows before the server has answered.
async function slowActions(page: Page, ms: number) {
  await page.route(`**/book/${SLUG}**`, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) await new Promise((r) => setTimeout(r, ms));
    // Unless the test has moved on and stopped slowing them.
    await route.fallback().catch(() => {});
  });
}

// Confirms a phone number with the code from the dev outbox.
async function confirmPhone(page: Page, number: string) {
  await flow(page).getByLabel("Mobile number").fill(number);
  await flow(page).getByRole("button", { name: "Send code" }).click();
  await expect(flow(page).getByLabel("Code", { exact: true })).toBeVisible();
  const outbox = await page.context().newPage();
  await outbox.goto(`/dev/outbox?to=${number.replace(/\D/g, "")}`);
  const code = /code is (\d{6})/.exec(await outbox.getByTestId("outbox-body").first().innerText())![1];
  await outbox.close();
  await flow(page).getByLabel("Code", { exact: true }).fill(code);
  await flow(page).getByRole("button", { name: "Confirm" }).click();
}

async function newClientDetails(page: Page, first: string) {
  await confirmPhone(page, newPhone());
  await flow(page).getByLabel("First name").fill(first);
  await flow(page).getByLabel("Last name").fill("Client");
  await flow(page).getByLabel("Email").fill(`${first.toLowerCase()}@example.com`);
}

// A cut with Shae (Artisan: $70) at a time the special covers.
async function cutWithShaeOnSpecial(page: Page) {
  await page.goto(`/book/${SLUG}`);
  await waitForHydration(page, "[data-testid=booking-flow] button[aria-pressed]");
  await flow(page).getByRole("button", { name: /^Women's Cut & Style\s*\d/ }).click();
  await cont(page).click();
  await flow(page).getByRole("button", { name: /Shae Morgan/ }).click();
  await cont(page).click();
  await flow(page).getByRole("radiogroup", { name: "Date" }).getByRole("radio", { name: /\d+ times?$/ }).first().click();
  await flow(page).getByRole("radio", { name: /, 20% off$/ }).first().click();
  await cont(page).click();
}

const book = async (page: Page) => {
  await flow(page).getByLabel(/^I agree to the cancellation policy/).check();
  await flow(page).getByRole("button", { name: /^Book appointment$|deposit and book$/ }).click();
  await expect(page.getByRole("heading", { name: /You’re booked/ })).toBeVisible();
};

test.describe("a last-minute special", () => {
  test.beforeAll(async () => {
    await admin.from("promotions").insert({ business_id: B, name: SPECIAL, kind: "last_minute", discount_kind: "percent", percent: 20, applies_services: true, hours_ahead: 168, online: true });
  });

  test("is on Review from the start, on the confirmation and in the account, and comes off at checkout", async ({ page, browser }) => {
    await cutWithShaeOnSpecial(page);
    await newClientDetails(page, `Br${RUN}Deal`);
    // Review shows the special before the server has said anything.
    await slowActions(page, 3000);
    await cont(page).click();
    const offer = flow(page).getByTestId("online-promotion");
    await expect(offer).toContainText("Last-minute 20% off", { timeout: 1000 });
    await expect(offer).toContainText("−$14");
    await expect(flow(page).getByTestId("review-total")).toHaveText("$56");
    await page.unroute(`**/book/${SLUG}**`);

    await flow(page).getByLabel("Keep me signed in on this device").check();
    await book(page);
    const booked = page.getByTestId("manage-booking");
    await expect(booked.getByTestId("booking-offer")).toContainText("Last-minute 20% off");
    await expect(booked.getByTestId("booking-offer")).toContainText("−$14");
    await expect(booked.getByTestId("booking-total")).toHaveText("$56");

    await page.goto(`/book/${SLUG}/account`);
    const upcoming = page.getByTestId("upcoming-visit").first();
    await expect(upcoming).toContainText("$56");
    await expect(upcoming).toContainText("Last-minute 20% off");

    // At checkout, the same $14 comes off, and the sale keeps it.
    const { data: visit } = await admin.from("appointments").select("id, promotion:promotions(name), client:clients!inner(first_name)").eq("client.first_name", `Br${RUN}Deal`).single();
    expect(visit!.promotion).toEqual({ name: SPECIAL });
    const desk = await (await browser.newContext({ storageState: AUTH.frontDesk, viewport: { width: 1440, height: 1000 } })).newPage();
    await desk.goto(`/checkout/new?appointment=${visit!.id}&from=/calendar`);
    await expect(desk).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
    await waitForHydration(desk, "#product-search");
    const co = checkout(desk);
    await expect(co.ticket.getByTestId("applied-promotion")).toContainText(SPECIAL, { timeout: 15_000 });
    await expect(co.ticket.getByTestId("applied-promotion")).toContainText("−$14");
    await co.card();
    await co.complete();
    await expect(desk.getByText(/Sale complete|Paid/).first()).toBeVisible();
    const { data: sale } = await admin.from("sales").select("id, sale_items(promo_discount_cents)").eq("appointment_id", visit!.id).single();
    expect(sale!.sale_items.reduce((n, i) => n + i.promo_discount_cents, 0)).toBe(1400);
    await desk.context().close();
  });

  test("a client it doesn't apply to is told why at Review, before booking", async ({ page }) => {
    // First visits only: a client who has been before can't have it.
    await admin.from("promotions").update({ first_visit_only: true }).eq("business_id", B).eq("name", SPECIAL);
    try {
      const { data: regular } = await admin
        .from("clients")
        .select("phone, appointments!inner(status)")
        .eq("business_id", B)
        .eq("appointments.status", "completed")
        .not("phone", "is", null)
        .is("sms_stopped_at", null)
        .eq("appointment_sms_ok", true)
        .limit(1)
        .single();
      await cutWithShaeOnSpecial(page);
      await confirmPhone(page, regular!.phone!);
      await expect(flow(page)).toContainText("Welcome back");
      await cont(page).click();
      await expect(flow(page).getByTestId("offer-lost")).toHaveText(/^Last-minute 20% off doesn't apply: it's for a client's first visit only\.$/);
      await expect(flow(page).getByTestId("online-promotion")).toHaveCount(0);
      await expect(flow(page).getByTestId("review-total")).toHaveText("$70");
    } finally {
      await admin.from("promotions").update({ first_visit_only: false }).eq("business_id", B).eq("name", SPECIAL);
    }
  });
});

test("No preference across two stylists: Review shows the exact total, and the confirmation matches it", async ({ page }) => {
  await page.goto(`/book/${SLUG}`);
  await waitForHydration(page, "[data-testid=booking-flow] button[aria-pressed]");
  // Nobody does both: Hannah or Lois do updos, Gil or Nola skin fades.
  await flow(page).getByRole("button", { name: /^Updo\s*\d/ }).click();
  await flow(page).getByRole("button", { name: /^Skin Fade\s*\d/ }).click();
  await cont(page).click();
  await flow(page).getByRole("button", { name: /^No preference/ }).click();
  await cont(page).click();
  await flow(page).getByRole("radiogroup", { name: "Date" }).getByRole("radio", { name: /\d+ times?$/ }).first().click();
  await flow(page).locator("[role=radiogroup]:not([aria-label=Date]) [role=radio]").first().click();
  await cont(page).click();
  await newClientDetails(page, `Br${RUN}Pair`);
  await cont(page).click();

  const total = flow(page).getByTestId("review-total");
  await expect(total).toHaveText(/^\$\d[\d,]*(\.\d\d)?$/);
  // Each service with its stylist and price, adding up to the total.
  const lines = flow(page).getByTestId("review-line");
  await expect(lines).toHaveCount(2);
  const cents = async (text: string) => Math.round(Number(text.replace(/[^\d.]/g, "")) * 100);
  const each = await Promise.all((await lines.all()).map(async (l) => cents(await l.getByTestId("line-price").innerText())));
  const shown = await total.innerText();
  // Less a special, if the time has one.
  const offer = flow(page).getByTestId("online-promotion");
  const off = (await offer.count()) ? await cents((await offer.innerText()).match(/−\$[\d,.]+/)![0]) : 0;
  expect(each.reduce((a, b) => a + b, 0) - off).toBe(await cents(shown));

  await book(page);
  await expect(page.getByTestId("manage-booking").getByTestId("booking-total")).toHaveText(shown);
});
