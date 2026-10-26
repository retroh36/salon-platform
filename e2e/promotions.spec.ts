import type { Page } from "@playwright/test";
import { admin, SEED } from "../tests/db/helpers";
import { openCheckout } from "./checkout-helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Promotions: an owner sets up a code, the front desk applies it at
// checkout (not with another discount), and the booking site shows the
// salon's last-minute special on the times it covers and takes a code at
// review. Every use is recorded with who applied it.

const B = SEED.business;
const L = SEED.location;
const RUN = Date.now().toString(36);
const CODE = `E2E${RUN}`.toUpperCase().slice(0, 20);
let productId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data: p } = await admin
    .from("products")
    .insert({ business_id: B, brand: `Pr${RUN}`, name: "Gloss Oil", sku: `PR${RUN}`, type: "retail", unit: "unit", size: 1, cost_cents: 1000, price_cents: 4000 })
    .select("id")
    .single();
  productId = p!.id;
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: productId, on_hand: 20 });
  await admin.from("clients").insert({ business_id: B, first_name: `Pr${RUN}Buyer`, last_name: "Test" });
  // A special of our own for the week ahead (the demo week is busy).
  await admin.from("promotions").insert({ business_id: B, name: `Pr${RUN} Week`, kind: "last_minute", discount_kind: "percent", percent: 20, applies_services: true, hours_ahead: 168, online: true });
});

test.afterAll(async () => {
  await admin.from("sales").delete().in("id", (await admin.from("sale_items").select("sale_id").eq("product_id", productId)).data?.map((r) => r.sale_id) ?? []);
  await admin.from("promotions").delete().eq("business_id", B).eq("code", CODE);
  const { data: held } = await admin.from("promotions").select("id").eq("business_id", B).like("name", `Pr${RUN}%`);
  await admin.from("stock_levels").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
  const { data } = await admin.from("clients").select("id").eq("business_id", B).like("first_name", `Pr${RUN}%`);
  const ids = (data ?? []).map((c) => c.id);
  if (ids.length) {
    await admin.from("appointments").delete().in("client_id", ids);
    await admin.from("clients").delete().in("id", ids);
  }
  await admin.from("promotions").delete().in("id", (held ?? []).map((p) => p.id));
});

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("sets up a promo code for retail", async ({ page }) => {
    await page.goto("/promotions/new");
    const form = ui(page).getByRole("form", { name: "Promotion" });
    await waitForHydration(page, "form[aria-label=Promotion] input");
    await form.getByLabel("Name").fill(`Retail ${RUN}`);
    await form.getByLabel("Code").fill(CODE.toLowerCase());
    await form.getByLabel("Percent off").fill("25");
    await form.getByRole("checkbox", { name: "Services" }).uncheck();
    await form.getByRole("checkbox", { name: "Retail" }).check();
    await form.getByLabel("Uses per client (blank: no limit)").fill("1");
    await expect(form.getByTestId("promotion-summary")).toHaveText("25% off retail · once per client · not with other discounts");
    await form.getByRole("button", { name: "Create promotion" }).click();
    await expect(page).toHaveURL(/\/promotions$/);
    await expect(ui(page).getByTestId("promotion-row").filter({ hasText: `Retail ${RUN}` })).toContainText(`Code ${CODE}`);
    // How each did, from the same figures as Reports.
    await expect(ui(page).getByTestId("promotion-row").filter({ hasText: `Retail ${RUN}` }).getByTestId("promotion-results")).toHaveText("Not used in the last 90 days.");
    await expect(ui(page).getByTestId("promotion-row").filter({ hasText: "Last-minute 15%" }).getByTestId("promotion-results")).toHaveText(/^Last 90 days: \d+ sales · \$[\d,.]+ in sales · \$[\d,.]+ off · \d+ openings filled · \d+ first visits?$/);
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("applies the code at checkout; it won't stack with a staff discount; the use is recorded", async ({ page }) => {
    const co = await openCheckout(page, { productId, from: "/sales" });
    await expect(co.total).toHaveText("$44.10");
    await co.ticket.getByRole("button", { name: "Promotion" }).click();
    await co.dialog.getByLabel("Promo code").fill("nope");
    await co.dialog.getByRole("button", { name: "Apply code" }).click();
    await expect(co.dialog).toContainText("No promotion has that code, or it has ended.");
    // Once per client: it needs a client on the sale.
    await co.dialog.getByLabel("Promo code").fill(CODE.toLowerCase());
    await co.dialog.getByRole("button", { name: "Apply code" }).click();
    await expect(co.dialog).toContainText(`Retail ${RUN} needs a client on the sale.`);
    await page.keyboard.press("Escape");
    await co.ticket.getByLabel("Find a client").fill(`Pr${RUN}Buyer`);
    await co.ticket.getByRole("list", { name: "Matching clients" }).getByRole("button").first().click();
    await expect(page.getByTestId("checkout-client")).toHaveText(`Pr${RUN}Buyer Test`);
    await co.ticket.getByRole("button", { name: "Promotion" }).click();
    await co.dialog.getByLabel("Promo code").fill(CODE.toLowerCase());
    await co.dialog.getByRole("button", { name: "Apply code" }).click();
    await expect(co.dialog).toHaveCount(0);
    await expect(co.ticket.getByTestId("applied-promotion")).toContainText(`Retail ${RUN}`);
    await expect(co.ticket.getByTestId("applied-promotion")).toContainText("−$10");
    // $40 less 25%, plus 10.25% tax.
    await expect(co.total).toHaveText("$33.08");

    // Not with a discount staff give.
    const editor = await co.edit("Gloss Oil");
    await editor.getByLabel("Percent off").fill("5");
    await editor.getByLabel("Discount reason").fill("Loyalty");
    await expect(co.payment.getByTestId("checkout-blocked")).toContainText(`Retail ${RUN} can't be used with another discount.`);
    await editor.getByLabel("Percent off").fill("");
    await expect(co.total).toHaveText("$33.08");

    await co.cash();
    const done = await co.complete();
    await expect(done).toContainText("$33.08");
    const { data: r } = await admin.from("promotion_redemptions").select("source, discount_cents, applied_by, promotion:promotions!inner(code)").eq("promotion.code", CODE).single();
    expect(r).toMatchObject({ source: "code", discount_cents: 1000, applied_by: SEED.staff.frontDesk });
  });

  test("sees promotions and Denise's ideas for open time", async ({ page }) => {
    await page.goto("/promotions");
    await expect(ui(page).getByTestId("promotion-row").filter({ hasText: "Last-minute 15%" })).toContainText("15% off services · open time in the next 48 hours · never Master color");
    await expect(ui(page).getByTestId("opening-ideas")).toContainText("Ideas for open time");
    // Setting them up, and how they did, are for owners and managers.
    await expect(ui(page).getByRole("link", { name: "New promotion" })).toHaveCount(0);
    await expect(ui(page).getByTestId("promotion-results")).toHaveCount(0);
  });
});

test.describe("booking site", () => {
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  test.use({ ...phone, storageState: { cookies: [], origins: [] } });
  const flow = (page: Page) => page.getByTestId("booking-flow");
  const cont = (page: Page) => flow(page).getByRole("button", { name: "Continue" });

  test.beforeEach(async () => {
    await admin.from("rate_limits").delete().neq("key", "");
  });

  test("marks last-minute special times, applies it at review, and checks a code", async ({ page }) => {
    await page.goto("/book/maple-and-ash");
    await waitForHydration(page, "[data-testid=booking-flow] button[aria-pressed]");
    await flow(page).getByRole("button", { name: /^Women's Cut & Style\s*\d/ }).click();
    await cont(page).click();
    // An Artisan stylist: the special covers their cuts.
    await flow(page).getByRole("button", { name: /Shae M\./ }).click();
    await cont(page).click();
    await expect(flow(page).getByTestId("specials-note")).toBeVisible();
    const dates = flow(page).getByRole("radiogroup", { name: "Date" });
    await dates.getByRole("radio", { name: /\d+ times?$/ }).first().click();
    const badged = flow(page).getByRole("radio", { name: /, 20% off$/ }).first();
    await expect(badged).toContainText("20% off");
    await badged.click();
    await cont(page).click();

    const number = `(4${String(Math.floor(Math.random() * 90) + 10)}) 555-01${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
    await flow(page).getByLabel("Mobile number").fill(number);
    await flow(page).getByRole("button", { name: "Send code" }).click();
    // The code box shows once the code is sent, so the outbox has it.
    await expect(flow(page).getByLabel("Code", { exact: true })).toBeVisible();
    const outbox = await page.context().newPage();
    await outbox.goto(`/dev/outbox?to=${number.replace(/\D/g, "")}`);
    const code = /code is (\d{6})/.exec(await outbox.getByTestId("outbox-body").first().innerText())![1];
    await outbox.close();
    await flow(page).getByLabel("Code", { exact: true }).fill(code);
    await flow(page).getByRole("button", { name: "Confirm" }).click();
    await flow(page).getByLabel("First name").fill(`Pr${RUN}Web`);
    await flow(page).getByLabel("Last name").fill("Client");
    await flow(page).getByLabel("Email").fill(`pr-${RUN}@example.com`);
    await cont(page).click();

    // The special, with about what it takes off ($70 cut, 20%).
    await expect(flow(page).getByTestId("online-promotion")).toContainText(`Pr${RUN} Week: 20% off`);
    await expect(flow(page).getByTestId("online-promotion")).toContainText("about −$14");
    await flow(page).getByRole("button", { name: "Have a promo code?" }).click();
    await flow(page).getByLabel("Promo code").fill("NOTACODE");
    await flow(page).getByRole("button", { name: "Apply" }).click();
    await expect(flow(page).getByRole("alert")).toHaveText("That code isn't valid. Check it and try again.");

    await flow(page).getByLabel(/^I agree to the cancellation policy/).check();
    await flow(page).getByRole("button", { name: /^Book appointment$|deposit and book$/ }).click();
    await expect(page.getByRole("heading", { name: /You’re booked/ })).toBeVisible();
    const { data: visit } = await admin.from("appointments").select("promotion:promotions(name), client:clients!inner(first_name)").eq("client.first_name", `Pr${RUN}Web`).single();
    expect(visit!.promotion).toEqual({ name: `Pr${RUN} Week` });
  });
});
