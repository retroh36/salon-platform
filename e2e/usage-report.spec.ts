// Product usage: what went out over any dates, with what's on hand, a
// suggested order and Denise comparing it with an earlier period.
import { admin, SEED } from "../tests/db/helpers";
import { addDays, fromLocal, todayIn } from "../lib/scheduling/time";
import { AUTH, expect, test, ui } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const PREFIX = `Ur${Date.now().toString(36)}`;
let productId: string;

test.beforeAll(async () => {
  const today = todayIn(TZ);
  const { data } = await admin.from("products").insert({ business_id: B, brand: PREFIX, name: "9N", type: "color", unit: "g", size: 60, cost_cents: 950 }).select("id").single();
  productId = data!.id;
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: productId, on_hand: 60, reorder_point: 60, reorder_quantity: 2 });
  const move = (change: number, day: string) => ({
    business_id: B,
    location_id: L,
    product_id: productId,
    change,
    on_hand_after: 60,
    reason: "service_use" as const,
    created_at: fromLocal(day, 12 * 60, TZ)!.toISOString(),
  });
  // 120 g in the last 30 days; 100 g on the same 30 days last year, 40 g of
  // it in the same week (the demo has a year of history, so it compares
  // with last year).
  await admin.from("stock_movements").insert([move(-80, addDays(today, -1)), move(-40, addDays(today, -10)), move(-60, addDays(today, -380)), move(-40, addDays(today, -367))]);
});

test.afterAll(async () => {
  await admin.from("stock_movements").delete().eq("product_id", productId);
  await admin.from("stock_levels").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
});

test.describe("as the manager", () => {
  test.use({ storageState: AUTH.manager });

  test("shows each product's usage, a suggested order and Denise's comparison", async ({ page }) => {
    await page.goto("/inventory");
    await ui(page).getByRole("link", { name: "Usage" }).click();
    await expect(page).toHaveURL(/\/inventory\/usage$/);
    await expect(ui(page).getByTestId("usage-denise")).toContainText(/^Against the same dates last year \(.+\): color is /);

    const row = ui(page).locator(`[data-product="${productId}"]`);
    // Used 120 g, 60 g on hand, 100 g last year (+20%); 120 + 60 − 60 = 120 g: 2 tubes.
    await expect(row.getByRole("cell")).toHaveText([`${PREFIX} 9N`, "Color", "120 g", "—", "60 g", "—", "100 g", "+20%", "2 tubes"]);

    // Only the last week: 80 g, against the same week last year (40 g).
    const today = todayIn(TZ);
    const form = ui(page).getByRole("form", { name: "Dates" });
    await form.getByLabel("From").fill(addDays(today, -6));
    await form.getByLabel("To").fill(today);
    await form.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/from=.*&to=/);
    await expect(row.getByRole("cell").nth(2)).toHaveText("80 g");
    await expect(row.getByRole("cell").nth(6)).toHaveText("40 g");
    await expect(ui(page).getByTestId("usage-denise")).toContainText("Against the same dates last year");
  });
});

test.describe("at the front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("isn't open", async ({ page }) => {
    await page.goto("/inventory/usage");
    await expect(page).toHaveURL(/\/inventory$/);
  });
});
