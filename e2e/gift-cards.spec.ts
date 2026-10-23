import type { Page } from "@playwright/test";
import { formatCode } from "@/lib/gift-cards";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

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

async function newSale(page: Page) {
  await page.goto("/sales/new");
  await waitForHydration(page, "form[aria-label=Checkout] input");
  return ui(page).getByRole("form", { name: "Checkout" });
}

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("sells a digital gift card, emailed in the salon's colors, then it pays for part of a sale", async ({ page }) => {
    let form = await newSale(page);
    await form.getByRole("button", { name: "Sell a gift card" }).click();
    const giftCard = form.getByRole("group", { name: "Gift card 1" });
    await giftCard.getByRole("button", { name: "$50" }).click();
    await giftCard.getByLabel("Digital (email)").check();
    await giftCard.getByLabel("For (name)").fill(`${PREFIX} Ava`);
    await giftCard.getByLabel("Send to (email)").fill("ava.gift@example.com");
    await expect(form.getByTestId("checkout-total")).toHaveText("$50");
    await form.getByRole("button", { name: "Card", exact: true }).click();
    await form.getByRole("button", { name: /^Complete sale/ }).click();
    await expect(ui(page).getByTestId("checkout-done")).toContainText("Paid $50");

    const { data: card } = await admin.from("gift_cards").select("code").eq("recipient_name", `${PREFIX} Ava`).single();
    const code = formatCode(card!.code);
    const { data: email } = await admin.from("outbox_messages").select("subject, body, html").eq("to_address", "ava.gift@example.com").order("created_at", { ascending: false }).limit(1).single();
    expect(email!.subject).toBe(`${PREFIX} Ava, here's a $50 gift card for Maple & Ash Hair Studio`);
    expect(email!.body).toContain(`Your code: ${code}`);
    expect(email!.html).toContain(code);

    // Two repair masks ($60): $50 from the card (all of it), $10 cash.
    form = await newSale(page);
    await form.getByLabel(/^Add a product/).fill(`${PREFIX}-RM`);
    await form.getByLabel(/^Add a product/).press("Enter");
    await form.getByLabel(/^How many/).fill("2");
    await form.getByRole("button", { name: "Gift card", exact: true }).click();
    const pay = form.getByRole("group", { name: "Payment 1" });
    await pay.getByLabel("Gift card code").fill(code.toLowerCase());
    await pay.getByRole("button", { name: "Check balance" }).click();
    await expect(pay.getByTestId("gift-card-balance")).toHaveText("Balance $50 · $0 left after this");
    await expect(pay.getByLabel("Amount")).toHaveValue("50");
    // Only $40 of it, actually: $10 stays on the card.
    await pay.getByLabel("Amount").fill("40");
    await expect(pay.getByTestId("gift-card-balance")).toHaveText("Balance $50 · $10 left after this");
    await form.getByRole("button", { name: "Cash" }).click();
    await expect(form.getByTestId("checkout-due")).toHaveText("Paid in full");
    await form.getByRole("button", { name: /^Complete sale/ }).click();
    await expect(ui(page).getByTestId("checkout-done")).toContainText("Paid $60");

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
    const form = await newSale(page);
    await form.getByRole("button", { name: "Gift card", exact: true }).click();
    const pay = form.getByRole("group", { name: "Payment 1" });
    await pay.getByLabel("Gift card code").fill("ZZZZ-ZZZZ-ZZZZ");
    await pay.getByRole("button", { name: "Check balance" }).click();
    await expect(pay).toContainText("No gift card has that code.");
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
