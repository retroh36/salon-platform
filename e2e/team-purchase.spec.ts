// A product's employee price, own tax rate and other barcodes: set on the
// product form, and used at checkout (a team purchase pays the employee
// price; a scan of any barcode finds it).
import { admin, SEED } from "../tests/db/helpers";
import { onCheckout } from "./checkout-helpers";
import { AUTH, expect, putBackSales, test, ui } from "./fixtures";

putBackSales();

const B = SEED.business;
const L = SEED.location;
const PREFIX = `Tp${Date.now().toString(36)}`;
const OTHER_CODE = `8${Date.now().toString().slice(-10)}`;
let productId: string;
let retailBefore: number;

test.beforeAll(async () => {
  retailBefore = (await admin.from("businesses").select("tax_rate_retail_bp").eq("id", B).single()).data!.tax_rate_retail_bp;
  await admin.from("businesses").update({ tax_rate_retail_bp: 1000 }).eq("id", B);
  const { data } = await admin
    .from("products")
    .insert({ business_id: B, brand: PREFIX, name: "Team Shampoo", sku: `${PREFIX}-TS`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 3000 })
    .select("id")
    .single();
  productId = data!.id;
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: productId, on_hand: 5 });
});

test.afterAll(async () => {
  const { data: items } = await admin.from("sale_items").select("sale_id").eq("product_id", productId);
  for (const i of items ?? []) await admin.from("sales").delete().eq("id", i.sale_id);
  await admin.from("stock_movements").delete().eq("product_id", productId);
  await admin.from("stock_levels").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
  await admin.from("businesses").update({ tax_rate_retail_bp: retailBefore }).eq("id", B);
});

test.describe("as the manager", () => {
  test.use({ storageState: AUTH.manager });

  test("sets a product's employee price, its own tax and another barcode", async ({ page }) => {
    await page.goto(`/inventory/${productId}/edit`);
    const form = ui(page).getByRole("form", { name: "Edit product" });
    await expect(form.getByLabel("Tax")).toHaveValue("salon");
    await expect(form.getByLabel("Tax")).toContainText("Salon's retail rate (10%)");
    await form.getByLabel("Employee price ($)").fill("18");
    await form.getByLabel("Tax").selectOption("own");
    await form.getByLabel("Tax rate (%)").fill("5");
    await form.getByLabel("Other barcodes").fill(OTHER_CODE);
    await form.getByRole("button", { name: "Save product" }).click();

    await expect(page).toHaveURL(new RegExp(`/inventory/${productId}$`));
    await expect(ui(page).getByTestId("retail-terms")).toHaveText("Team $18 · Tax 5%");
    await expect(ui(page).getByTestId("barcodes")).toHaveText(OTHER_CODE);
    expect((await admin.from("products").select("employee_price_cents, tax_rate_bp, other_barcodes").eq("id", productId).single()).data).toEqual({
      employee_price_cents: 1800,
      tax_rate_bp: 500,
      other_barcodes: [OTHER_CODE],
    });
  });
});

test.describe("at the front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("a team purchase pays the employee price, and a scan of the other barcode finds it", async ({ page, browser }) => {
    await admin.from("products").update({ employee_price_cents: 1800, tax_rate_bp: 500, other_barcodes: [OTHER_CODE] }).eq("id", productId);
    await page.goto("/sales");
    await ui(page).getByRole("link", { name: "New sale" }).click();
    const co = await onCheckout(page);
    await co.addProduct(OTHER_CODE);
    // $30 at 5% tax.
    await expect(co.total).toHaveText("$31.50");

    await co.ticket.getByTestId("team-purchase").selectOption({ label: "Jordan Pike" });
    await expect(co.ticket.getByTestId("checkout-client")).toHaveText("Team purchase · Jordan Pike");
    // $18 at 5% tax.
    await expect(co.total).toHaveText("$18.90");
    await co.card();
    await co.complete();

    const { data: item } = await admin.from("sale_items").select("sale_id, unit_price_cents, staff_id").eq("product_id", productId).single();
    expect(item).toMatchObject({ unit_price_cents: 1800, staff_id: null });
    expect((await admin.from("sales").select("employee_id, total_cents").eq("id", item!.sale_id).single()).data).toEqual({ employee_id: SEED.staff.jordan, total_cents: 1890 });
    await page.goto(`/sales/${item!.sale_id}`);
    await expect(ui(page).getByTestId("receipt")).toContainText("Team purchase · Jordan Pike");

    // A manager sees it in the Audit trail as a team purchase.
    const { data: sale } = await admin.from("sales").select("number").eq("id", item!.sale_id).single();
    const managerContext = await browser.newContext({ storageState: AUTH.manager });
    try {
      const audit = await managerContext.newPage();
      await audit.goto("/audit?type=team");
      await expect(ui(audit).getByTestId("audit-table").getByRole("row").filter({ hasText: `Sale #${sale!.number}, team purchase for Jordan Pike` })).toContainText("$18.90");
    } finally {
      await managerContext.close();
    }
  });
});
