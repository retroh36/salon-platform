import type { Page } from "@playwright/test";
import { formatCode } from "@/lib/gift-cards";
import { admin, SEED } from "../tests/db/helpers";
import { openCheckout } from "./checkout-helpers";
import { AUTH, expect, putBackSales, test, ui, waitForHydration } from "./fixtures";

// Stock and sales this file uses are put back afterwards.
putBackSales();

const B = SEED.business;
const L = SEED.location;
const PREFIX = `Gf${Date.now().toString(36)}`;

let productId: string;

test.beforeAll(async () => {
  // A $30 product, untaxed for easy sums.
  const { data } = await admin
    .from("products")
    .insert({ business_id: B, brand: PREFIX, name: "Repair Mask", sku: `${PREFIX}-RM`, type: "retail", unit: "unit", size: 1, cost_cents: 1000, price_cents: 3000 })
    .select("id")
    .single();
  productId = data!.id;
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: productId, on_hand: 20 });
  await admin.from("businesses").update({ tax_rate_retail_bp: 0 }).eq("id", B);
});

test.afterAll(async () => {
  const { data: items } = await admin.from("sale_items").select("sale_id").eq("product_id", productId);
  const { data: cards } = await admin.from("gift_cards").select("id, sale_id").or(`recipient_name.like.${PREFIX}%,note.like.${PREFIX}%`);
  const saleIds = [...(items ?? []).map((i) => i.sale_id), ...(cards ?? []).flatMap((c) => (c.sale_id ? [c.sale_id] : []))];
  await admin.from("sales").delete().in("id", saleIds);
  await admin.from("gift_cards").delete().in("id", (cards ?? []).map((c) => c.id));
  await admin.from("stock_movements").delete().eq("product_id", productId);
  await admin.from("stock_levels").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
  await admin.from("gift_card_lookups").delete().eq("business_id", B);
  await admin.from("businesses").update({ tax_rate_retail_bp: 1025, gift_card_presets_cents: [2500, 5000, 10000, 15000] }).eq("id", B);
});

const newSale = (page: Page) => openCheckout(page, { from: "/sales" });

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("sells a digital gift card, emailed in the salon's colors, then it pays for part of a sale", async ({ page }) => {
    let co = await newSale(page);
    await co.ticket.getByRole("button", { name: "Gift card", exact: true }).click();
    await co.dialog.getByRole("button", { name: "Digital (email)" }).click();
    await co.dialog.getByRole("button", { name: "$50" }).click();
    await co.dialog.getByLabel("Recipient’s name").fill(`${PREFIX} Ava`);
    await co.dialog.getByLabel("Recipient’s email").fill("ava.gift@example.com");
    await co.dialog.getByRole("button", { name: "Add to ticket" }).click();
    await expect(co.total).toHaveText("$50");
    await co.card();
    await expect(await co.complete()).toContainText("$50");

    const { data: card } = await admin.from("gift_cards").select("code").eq("recipient_name", `${PREFIX} Ava`).single();
    const code = formatCode(card!.code);
    const { data: email } = await admin.from("outbox_messages").select("subject, body, html").eq("to_address", "ava.gift@example.com").order("created_at", { ascending: false }).limit(1).single();
    expect(email!.subject).toBe(`${PREFIX} Ava, here's a $50 gift card for Maple & Ash Hair Studio`);
    expect(email!.body).toContain(`Your code: ${code}`);
    expect(email!.html).toContain(code);

    // Two repair masks ($60): $40 from the card, $10 stays on it, $20 cash.
    co = await newSale(page);
    await co.search(`${PREFIX}-RM`);
    await co.ticket.getByLabel("Add a product: name, brand, SKU or scan").press("Enter");
    await (await co.edit("Repair Mask")).getByRole("button", { name: "One more" }).click();
    await co.payment.getByRole("button", { name: "Gift card", exact: true }).click();
    await co.dialog.getByLabel("Gift card code").fill(code.toLowerCase());
    await co.dialog.getByRole("button", { name: "Check" }).click();
    await expect(co.dialog.getByTestId("gift-card-balance")).toHaveText("Balance $50");
    await expect(co.dialog.getByLabel("Amount ($)")).toHaveValue("50.00");
    await co.dialog.getByLabel("Amount ($)").fill("40");
    await co.dialog.getByRole("button", { name: "Use $40 from the card" }).click();
    await expect(co.payment.getByTestId("payment-line")).toContainText("$10 left on it");
    await expect(co.remaining).toHaveText("$20 remaining to pay");
    await co.cash();
    await expect(co.remaining).toHaveText("Paid in full");
    await expect(await co.complete()).toContainText("$60");

    // Its balance and history.
    await page.goto("/gift-cards");
    await waitForHydration(page, "form[aria-label='Check a balance'] input");
    await ui(page).getByLabel(/^Card code/).fill(code);
    await ui(page).getByRole("button", { name: "Check balance" }).click();
    await expect(ui(page).getByTestId("card-balance")).toHaveText("$10");
    const history = ui(page).getByRole("list", { name: "Card history" }).getByRole("listitem");
    await expect(history).toHaveCount(2);
    await expect(history.first()).toContainText("Sold on sale #");
    await expect(history.last()).toContainText("Used on sale #");
    await expect(history.last()).toContainText("−$40 → $10");
    // No adjusting for the front desk.
    await expect(ui(page).getByRole("form", { name: "Adjust balance" })).toHaveCount(0);
  });

  test("says when a code isn't a gift card", async ({ page }) => {
    const co = await newSale(page);
    await co.payment.getByRole("button", { name: "Gift card", exact: true }).click();
    await co.dialog.getByLabel("Gift card code").fill("ZZZZ-ZZZZ-ZZZZ");
    await co.dialog.getByRole("button", { name: "Check" }).click();
    await expect(co.dialog.getByRole("alert")).toHaveText("No gift card has that code.");
  });
});

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("issues a promotional card, and sets gift card rules with the legal note", async ({ page }) => {
    await page.goto("/gift-cards");
    await waitForHydration(page, "form[aria-label='Issue a promotional card'] input");
    const promo = ui(page).getByRole("form", { name: "Issue a promotional card" });
    await promo.getByLabel("Amount ($)").fill("20");
    await promo.getByLabel(/^What it/).fill(`${PREFIX} Referral reward`);
    await promo.getByLabel(/^For \(name/).fill(`${PREFIX} Bea`);
    await promo.getByRole("button", { name: "Issue card" }).click();
    await expect(page).toHaveURL(/\/gift-cards\/[0-9a-f-]{36}$/);
    await expect(ui(page).getByRole("heading", { level: 1 })).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    await expect(ui(page)).toContainText("Promotional card");
    await expect(ui(page).getByTestId("card-balance")).toHaveText("$20");
    await expect(ui(page)).toContainText("Promotional: no cash value");

    await page.goto("/settings/gift-cards");
    await expect(ui(page).getByRole("status").filter({ hasText: "vary by state" })).toBeVisible();
    await waitForHydration(page, "form[aria-label='Gift card settings'] input");
    const settings = ui(page).getByRole("form", { name: "Gift card settings" });
    await settings.getByLabel(/^Preset amounts/).fill("30, 60, 120");
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(settings.getByRole("status")).toHaveText("Saved.");
    expect((await admin.from("businesses").select("gift_card_presets_cents").eq("id", B).single()).data!.gift_card_presets_cents).toEqual([3000, 6000, 12000]);
  });
});

test.describe("stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("doesn't see gift cards", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("aside").first().getByRole("link", { name: "Gift cards" })).toHaveCount(0);
    await page.goto("/gift-cards");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
