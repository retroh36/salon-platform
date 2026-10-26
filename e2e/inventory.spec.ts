import type { Page } from "@playwright/test";
import { admin, SEED } from "../tests/db/helpers";
import { onCheckout } from "./checkout-helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const RUN = `Inv${Date.now().toString(36)}`;

test.afterAll(async () => {
  await admin.from("products").delete().like("brand", `${RUN}%`);
});

async function openInventory(page: Page, query = "") {
  await page.goto(`/inventory${query}`);
  await expect(ui(page).getByRole("heading", { name: "Inventory", level: 1 })).toBeVisible();
  await waitForHydration(page, "input[name=q]");
}

const products = (page: Page) => ui(page).getByRole("table", { name: "Products" }).locator("tbody").getByRole("row");

// A retail product with stock, straight into the database.
async function retailProduct(name: string, onHand: number) {
  const { data } = await admin
    .from("products")
    .insert({ business_id: B, brand: RUN, name, type: "retail", unit: "unit", size: 1, cost_cents: 1000, price_cents: 2000 })
    .select("id")
    .single();
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: data!.id, on_hand: onHand });
  await admin.from("stock_movements").insert({ business_id: B, location_id: L, product_id: data!.id, change: onHand, on_hand_after: onHand, reason: "count" });
  return data!.id;
}

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("searches and filters stock, with on hand, reorder point and value", async ({ page }) => {
    await openInventory(page);
    await expect(ui(page).getByTestId("stock-value")).toHaveText(/^\$[\d,]+\.\d\d$/);

    // Color is counted by weight, partly used tubes included.
    const search = ui(page).getByRole("searchbox", { name: "Search products" });
    await search.fill("topchic 7n");
    await expect(products(page)).toHaveCount(2); // 7N and 7NN
    const sevenN = products(page).filter({ hasText: /Goldwell Topchic 7N(?!N)/ });
    await expect(sevenN).toContainText("144 g");
    await expect(sevenN).toContainText("2.4 tubes");
    await expect(sevenN).toContainText("180 g");
    await expect(sevenN).toContainText("Low stock");
    await expect(sevenN).toContainText("$22.80");

    await search.fill("");
    await ui(page).getByRole("button", { name: /Brand/ }).click();
    await page.getByRole("option", { name: "Olaplex" }).click();
    await expect(page).toHaveURL(/brand=Olaplex/);
    await ui(page).getByRole("radio", { name: "Retail" }).click();
    await expect(page).toHaveURL(/type=retail/);
    await expect(products(page).first()).toBeVisible();
    for (const text of await products(page).allTextContents()) {
      expect(text).toContain("Olaplex");
      expect(text).toContain("Retail");
    }

    await openInventory(page, "?low=1");
    await expect(ui(page).getByRole("button", { name: "Low stock" })).toHaveAttribute("aria-pressed", "true");
    const count = await products(page).count();
    expect(count).toBeGreaterThanOrEqual(3);
    await expect(products(page).filter({ hasText: "Low stock" })).toHaveCount(count);
  });

  test("sees a low-stock alert that links to the low items", async ({ page }) => {
    await openInventory(page);
    const alert = ui(page).getByTestId("low-stock-alert");
    await expect(alert).toContainText("below the reorder point");
    await alert.click();
    await expect(page).toHaveURL(/low=1/);
  });

  test("adds a product and adjusts its stock", async ({ page }) => {
    await page.goto("/inventory/new");
    await waitForHydration(page, "input[name=brand]");
    const form = ui(page).getByRole("form", { name: "New product" });
    await form.getByLabel("Brand").fill(`${RUN} Color`);
    await form.getByLabel("Line").fill("Test Line");
    await form.getByLabel("Shade or name").fill("6.66");
    await form.getByLabel(/Container size/).fill("90");
    await form.getByLabel(/Cost per container/).fill("11.20");
    await form.getByLabel("Supplier").selectOption({ label: "Northline Beauty Supply" });
    await form.getByRole("button", { name: "Add product" }).click();

    await expect(ui(page).getByRole("heading", { name: `${RUN} Color Test Line 6.66` })).toBeVisible();
    await expect(ui(page).getByTestId("on-hand")).toHaveText("0 g");

    const adjust = ui(page).getByRole("form", { name: "Adjust stock" });
    await adjust.getByRole("radio", { name: "Add" }).click();
    await adjust.getByLabel(/Amount/).fill("135");
    await adjust.getByLabel("Why").fill("Samples from the rep");
    await adjust.getByRole("button", { name: "Adjust" }).click();
    await expect(ui(page).getByTestId("on-hand")).toHaveText("135 g");
    await expect(ui(page).getByRole("list", { name: "Stock history" })).toContainText("Samples from the rep");
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("sells retail, but can't adjust or edit", async ({ page }) => {
    const id = await retailProduct("Sale Shampoo", 5);
    await page.goto(`/inventory/${id}`);
    await expect(ui(page).getByTestId("on-hand")).toHaveText("5 units");
    // A sale at the front desk, with this product already on it.
    await ui(page).getByRole("link", { name: "Sell this product" }).click();
    const checkout = await onCheckout(page);
    await (await checkout.edit("Sale Shampoo")).getByRole("button", { name: "One more" }).click();
    await checkout.cash();
    await checkout.complete();
    await page.goto(`/inventory/${id}`);
    await expect(ui(page).getByTestId("on-hand")).toHaveText("3 units");
    await expect(ui(page).getByRole("list", { name: "Stock history" }).getByRole("listitem").first()).toContainText("Sale");
    await expect(ui(page).getByRole("form", { name: "Adjust stock" })).toHaveCount(0);
    await expect(ui(page).getByRole("link", { name: "Edit product" })).toHaveCount(0);
  });
});

test.describe("stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("views stock only", async ({ page }) => {
    await openInventory(page);
    await expect(ui(page).getByRole("link", { name: "Add product" })).toHaveCount(0);
    await products(page).filter({ hasText: "Olaplex No.3" }).getByRole("link").click();
    await expect(ui(page).getByTestId("on-hand")).toBeVisible();
    await expect(ui(page).getByRole("link", { name: "Sell this product" })).toHaveCount(0);
    await expect(ui(page).getByRole("form", { name: "Adjust stock" })).toHaveCount(0);
    await page.goto("/inventory/new");
    await expect(page).toHaveURL(/\/inventory$/);
  });
});
