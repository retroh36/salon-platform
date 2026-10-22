import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const L = SEED.location;
const START = new Date().toISOString();

// Put back stock that orders received during the tests, and remove the
// orders and suggestions they made.
test.afterAll(async () => {
  const { data: moves } = await admin.from("stock_movements").select("id, product_id, change").eq("reason", "order_received").gte("created_at", START);
  for (const m of moves ?? []) {
    const { data: level } = await admin.from("stock_levels").select("on_hand").eq("product_id", m.product_id).eq("location_id", L).single();
    await admin.from("stock_levels").update({ on_hand: level!.on_hand - m.change }).eq("product_id", m.product_id).eq("location_id", L);
    await admin.from("stock_movements").delete().eq("id", m.id);
  }
  await admin.from("purchase_order_lines").update({ received_quantity: 0 }).gte("received_quantity", 1);
  await admin.from("purchase_orders").update({ status: "sent", received_at: null }).neq("status", "draft").eq("notes", "Toner restock");
  await admin.from("purchase_orders").delete().gte("created_at", START);
  await admin.from("ai_actions").delete().eq("feature", "reorder");
});

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("Denise suggests a reorder before stock runs out; approving drafts it, with undo", async ({ page }) => {
    await page.goto("/inventory");
    const card = ui(page).getByRole("region", { name: "Denise's reorder suggestions" });
    await expect(card.getByTestId("reorder-suggestion").first()).toBeVisible({ timeout: 15_000 });
    await expect(card.locator("[data-pose]")).toHaveAttribute("data-pose", "point");
    const first = card.getByTestId("reorder-suggestion").first();
    await expect(first).toContainText(/You'll run out of .+ before .+ — \d+ (color )?appointments? needs? it\./);
    await expect(first).toContainText("I've put together an order for Northline Beauty Supply");

    await first.getByText("What's in it").click();
    await expect(first.getByRole("listitem").first()).toContainText(/Runs out/);

    await first.getByRole("button", { name: "Draft this order" }).click();
    const done = card.getByRole("status");
    await expect(done).toContainText(/Done — I've drafted PO-\d+\. Review it and send it when you're ready; nothing has been ordered yet\./);

    // Undo right there.
    await done.getByRole("button", { name: "Undo" }).click();
    await expect(card.getByRole("status")).toHaveText("Undone — that draft order is gone.");

    // She suggests it again; draft it and open it: Denise's lines, ready to
    // review and send.
    const northline = card.getByTestId("reorder-suggestion").filter({ hasText: "Northline Beauty Supply" });
    await northline.getByRole("button", { name: "Draft this order" }).click();
    await card.getByRole("link", { name: "Open order" }).click();
    await expect(ui(page).getByRole("heading", { level: 1 })).toContainText("Northline Beauty Supply");
    await expect(ui(page).getByText("Drafted by Denise")).toBeVisible();
    await expect(ui(page).getByRole("region", { name: "Why Denise suggested these" })).toContainText("Runs out");
    await waitForHydration(page, "form[aria-label='Edit order'] select");
    await ui(page).getByRole("button", { name: "Mark as sent" }).click();
    await expect(ui(page).getByRole("form", { name: "Receive delivery" })).toBeVisible();
  });

  test("writes an order by hand", async ({ page }) => {
    await page.goto("/inventory/orders/new");
    await waitForHydration(page, "form[aria-label='New order'] select");
    const form = ui(page).getByRole("form", { name: "New order" });
    await form.getByLabel("Supplier").selectOption({ label: "Prairie Pro Distributors" });
    await form.getByRole("button", { name: "Add a product" }).click();
    const line = form.getByRole("group", { name: "Line 1" });
    await line.getByLabel("Product", { exact: true }).selectOption({ label: "Olaplex No.3 Hair Perfector 100 ml" });
    await line.getByLabel("Quantity").fill("12");
    await expect(form.getByTestId("order-total")).toHaveText("$180");
    await form.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/inventory\/orders\/[0-9a-f-]{36}$/);
    await expect(ui(page).getByRole("heading", { level: 1 })).toContainText("Prairie Pro Distributors");
  });

  test("sees low stock on the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(ui(page).getByTestId("low-stock-alert")).toContainText("below the reorder point");
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("receives a delivery into stock, part now and the rest later", async ({ page }) => {
    const { data: po } = await admin.from("purchase_orders").select("id, purchase_order_lines(product_id, quantity, product:products(sku))").eq("notes", "Toner restock").single();
    const t18 = po!.purchase_order_lines.find((l) => l.product.sku === "WE-CC-T18")!;
    const level = async () => (await admin.from("stock_levels").select("on_hand").eq("product_id", t18.product_id).single()).data!.on_hand;
    const before = await level();

    await page.goto("/inventory/orders");
    await ui(page).getByRole("list", { name: "Orders" }).getByRole("link", { name: /Lakeshore Salon Wholesale/ }).click();
    await waitForHydration(page, "form[aria-label='Receive delivery'] input");
    const form = ui(page).getByRole("form", { name: "Receive delivery" });
    // Only 4 of the 6 T18 arrived; the other lines came in full.
    await form.getByLabel(/T18 .* arrived/).fill("4");
    await form.getByRole("button", { name: "Receive into stock" }).click();
    await expect(form.getByRole("status")).toHaveText("Received. Stock is updated; the rest is still due.");
    await expect(ui(page).getByText("Partly received")).toBeVisible();
    await expect.poll(level).toBeCloseTo(before + 4 * 42, 2);

    await expect(form.getByLabel(/T18 .* arrived/)).toHaveValue("2");
    await form.getByRole("button", { name: "Receive into stock" }).click();
    await expect(ui(page).getByText("Received", { exact: true })).toBeVisible();
    await expect.poll(level).toBeCloseTo(before + 6 * 42, 2);
  });

  test("sees Denise's suggestions but leaves approving to managers", async ({ page }) => {
    await page.goto("/inventory");
    const card = ui(page).getByRole("region", { name: "Denise's reorder suggestions" });
    await expect(card.getByTestId("reorder-suggestion").first()).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole("button", { name: "Draft this order" })).toHaveCount(0);
    await expect(card.getByText("An owner or manager can turn this into an order.").first()).toBeVisible();
  });
});

test.describe("stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("can't see orders", async ({ page }) => {
    await page.goto("/inventory/orders");
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(ui(page).getByRole("link", { name: "Orders" })).toHaveCount(0);
  });
});
