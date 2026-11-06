// Paid by other: the checkout's "Other" needs a note; owners and managers
// get an alert, and it shows in the audit trail and on Reconcile with the
// note.
import { admin, SEED } from "../tests/db/helpers";
import { onCheckout } from "./checkout-helpers";
import { AUTH, expect, putBackSales, test, ui } from "./fixtures";

putBackSales();

const B = SEED.business;
const L = SEED.location;
const PREFIX = `Po${Date.now().toString(36)}`;
const NOTE = `Check ${PREFIX}`;
const since = new Date().toISOString();
let productId: string;

test.use({ storageState: AUTH.frontDesk });

test.beforeAll(async () => {
  const { data } = await admin
    .from("products")
    .insert({ business_id: B, brand: PREFIX, name: "Other Spray", sku: `${PREFIX}-OS`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 2000 })
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
  await admin.from("notifications").delete().eq("business_id", B).eq("template", "alert_paid_other").gte("created_at", since);
});

test("a sale paid by Other needs a note, and owners see it in the audit trail and on Reconcile", async ({ page, browser }) => {
  await page.goto("/sales");
  await ui(page).getByRole("link", { name: "New sale" }).click();
  const co = await onCheckout(page);
  await co.ticket.getByRole("button", { name: "Walk-in guest" }).click();
  await co.addProduct(`${PREFIX}-OS`);

  await co.payment.getByRole("button", { name: "Other", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Other payment" });
  const record = sheet.getByRole("button", { name: /^Record .* other payment/ });
  await expect(record).toBeDisabled();
  await sheet.getByLabel("What was it?").fill(NOTE);
  await record.click();
  await expect(co.payment).toContainText(NOTE);
  await co.complete();

  const { data: pay } = await admin.from("payments").select("sale_id, amount_cents").eq("method", "other").eq("reference", NOTE).single();
  const { data: alert } = await admin.from("notifications").select("body").eq("staff_id", SEED.staff.owner).eq("template", "alert_paid_other").like("body", `%${NOTE}%`);
  expect(alert).toHaveLength(1);

  const owner = await browser.newContext({ storageState: AUTH.owner });
  const op = await owner.newPage();
  try {
    await op.goto("/audit?type=other");
    await expect(ui(op).getByText(`as "Other"`).filter({ hasText: NOTE })).toBeVisible();
    await op.goto("/reports/reconcile");
    await expect(ui(op).getByTestId("other-note").filter({ hasText: NOTE })).toBeVisible();
    await op.goto(`/sales/${pay!.sale_id}`);
    await expect(ui(op).getByText(NOTE)).toBeVisible();
  } finally {
    await owner.close();
  }
});
