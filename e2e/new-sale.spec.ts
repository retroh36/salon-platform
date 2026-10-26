// New sale, one tap from anywhere: the sidebar and the calendar header
// open the full-screen checkout for a sale without a visit. A walk-in
// guest buys a product, credited to whoever is signed in unless changed,
// and stock comes down.
import { admin, busyDay, SEED } from "../tests/db/helpers";
import { onCheckout } from "./checkout-helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const PREFIX = `Ns${Date.now().toString(36)}`;
let productId: string;

test.use({ storageState: AUTH.frontDesk });

test.beforeAll(async () => {
  const { data } = await admin
    .from("products")
    .insert({ business_id: B, brand: PREFIX, name: "Walk-in Spray", sku: `${PREFIX}-WS`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 2000 })
    .select("id")
    .single();
  productId = data!.id;
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: productId, on_hand: 5 });
});

test.afterAll(async () => {
  const { data: items } = await admin.from("sale_items").select("sale_id").eq("product_id", productId);
  for (const i of items ?? []) await admin.from("sales").delete().eq("id", i.sale_id);
  await admin.from("sale_items").delete().eq("product_id", productId);
  await admin.from("stock_movements").delete().eq("product_id", productId);
  await admin.from("stock_levels").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
});

test("New sale from the sidebar: a walk-in guest, credited to whoever is signed in", async ({ page }) => {
  await page.goto("/clients");
  await waitForHydration(page, "[data-testid=new-sale]");
  await page.getByTestId("new-sale").first().click();
  const co = await onCheckout(page);
  await expect(page.getByRole("heading", { name: "New sale" })).toBeVisible();

  await co.ticket.getByRole("button", { name: "Walk-in guest" }).click();
  await expect(co.ticket.getByTestId("checkout-client")).toHaveText("Walk-in guest");
  // Credit to starts on the person signed in (Sam, at the front desk).
  await expect(co.ticket.getByLabel("Credit product sales to")).toHaveValue(SEED.staff.frontDesk);

  await co.addProduct(`${PREFIX}-WS`);
  await expect(co.lines).toHaveCount(1);
  await co.cash();
  await co.complete();

  const { data: items } = await admin.from("sale_items").select("staff_id, sales!inner(client_id, status)").eq("product_id", productId);
  expect(items).toHaveLength(1);
  expect(items![0].staff_id).toBe(SEED.staff.frontDesk);
  expect(items![0].sales).toMatchObject({ client_id: null, status: "completed" });
  const { data: stock } = await admin.from("stock_levels").select("on_hand").eq("product_id", productId).single();
  expect(Number(stock!.on_hand)).toBe(4);
});

test("New sale on the calendar header, credited to a stylist; More holds Waitlist, Walk-ins and Block time", async ({ page }) => {
  await page.goto(`/calendar?date=${(await busyDay("America/Chicago")).date}`);
  await waitForHydration(page, "section[data-staff-id]");
  const header = ui(page);
  await expect(header.getByRole("button", { name: "New booking" })).toBeVisible();
  await expect(header.getByTestId("new-sale")).toBeVisible();
  await expect(header.getByRole("link", { name: "Waitlist" })).toHaveCount(0);
  await header.getByRole("button", { name: "More", exact: true }).click();
  const more = page.getByRole("menu", { name: "More" });
  await expect(more.getByRole("menuitem")).toHaveText(["Waitlist", "Walk-ins", "Block time"]);
  await page.keyboard.press("Escape");

  await header.getByTestId("new-sale").click();
  const co = await onCheckout(page);
  await co.ticket.getByLabel("Credit product sales to").selectOption(SEED.staff.bridget);
  await co.addProduct(`${PREFIX}-WS`);
  await co.cash();
  await co.complete();
  const { data: items } = await admin.from("sale_items").select("staff_id").eq("product_id", productId).eq("staff_id", SEED.staff.bridget);
  expect(items).toHaveLength(1);
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("don't have New sale", async ({ page }) => {
    await page.goto(`/calendar?date=${(await busyDay("America/Chicago")).date}`);
    await waitForHydration(page, "section[data-staff-id]");
    await expect(page.getByTestId("new-sale")).toHaveCount(0);
  });
});
