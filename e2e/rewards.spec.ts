import { admin, SEED } from "../tests/db/helpers";
import { openCheckout } from "./checkout-helpers";
import { AUTH, expect, putBackSales, test, ui, waitForHydration } from "./fixtures";

// Stock and sales this file uses are put back afterwards.
putBackSales();

// Rewards: the front desk sees a client's points and tier at checkout with
// Denise's line, takes a reward in one tap, and the points move when the
// sale completes; the profile shows the history, and only those allowed
// adjust points; owners set the program up and see it on Reports.

const B = SEED.business;
const L = SEED.location;
const RUN = Date.now().toString(36);
let productId: string;
let clientId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data: p } = await admin
    .from("products")
    .insert({ business_id: B, brand: `Rw${RUN}`, name: "Shine Oil", sku: `RW${RUN}`, type: "retail", unit: "unit", size: 1, cost_cents: 1000, price_cents: 4000 })
    .select("id")
    .single();
  productId = p!.id;
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: productId, on_hand: 20 });
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `Rw${RUN}`, last_name: "Test" }).select("id").single();
  clientId = c!.id;
  await admin.from("reward_points").insert({ business_id: B, client_id: clientId, delta: 360, kind: "adjust", reason: "Test" });
});

test.afterAll(async () => {
  await admin.from("sales").delete().in("id", (await admin.from("sale_items").select("sale_id").eq("product_id", productId)).data?.map((r) => r.sale_id) ?? []);
  await admin.from("stock_levels").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("rewards").delete().eq("business_id", B).like("name", `Rw${RUN}%`);
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("takes a reward in one tap at checkout, and the points move when the sale completes", async ({ page }) => {
    const co = await openCheckout(page, { productId, from: "/sales" });
    await co.ticket.getByLabel("Find a client").fill(`Rw${RUN}`);
    await co.ticket.getByRole("list", { name: "Matching clients" }).getByRole("button").first().click();
    await expect(page.getByTestId("badge-points")).toHaveText("360 points");
    await expect(page.getByTestId("rewards-line")).toHaveText(`Rw${RUN} has 360 points: enough for 20% off retail, and 40 points from a free gloss.`);
    const rewards = co.ticket.getByTestId("rewards");
    await expect(rewards.getByRole("button", { name: /^Free gloss/ })).toBeDisabled();
    await expect(rewards).toContainText("40 more points needed.");
    await rewards.getByRole("button", { name: /^20% off retail/ }).click();
    await expect(co.ticket.getByTestId("applied-reward")).toContainText("20% off retail");
    await expect(co.ticket.getByTestId("applied-reward")).toContainText("−$8");
    // Once taken, the rest is what's left: 60 points.
    await expect(rewards).toContainText("60 points left");
    // $40 less 20%, plus 10.25% tax.
    await expect(co.total).toHaveText("$35.28");
    await co.cash();
    await co.complete();
    const { data: rows } = await admin.from("reward_points").select("kind, delta").eq("client_id", clientId).neq("kind", "adjust").order("delta");
    // 300 taken; 32 earned on the $32 paid (before tax).
    expect(rows).toEqual([
      { kind: "redeem", delta: -300 },
      { kind: "earn", delta: 32 },
    ]);
  });

  test("sees the points history on the profile, and can't adjust points", async ({ page }) => {
    await page.goto(`/clients/${clientId}`);
    const card = ui(page).getByTestId("client-rewards");
    await expect(card.getByTestId("points-balance")).toHaveText("92 points");
    await card.getByText("Points history").click();
    await expect(card.getByTestId("points-history")).toContainText("Redeemed: 20% off retail");
    await expect(card.getByRole("button", { name: "Adjust points" })).toHaveCount(0);
  });
});

test.describe("manager", () => {
  test.use({ storageState: AUTH.manager });

  test("adjusts points with a reason, logged with who", async ({ page }) => {
    await page.goto(`/clients/${clientId}`);
    const card = ui(page).getByTestId("client-rewards");
    await waitForHydration(page, "[data-testid=client-rewards] button");
    await card.getByRole("button", { name: "Adjust points" }).click();
    const form = card.getByRole("form", { name: "Adjust points" });
    await form.getByLabel("Points").fill("10");
    await form.getByLabel("Why").fill("Missed points from last visit");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toContainText("Saved. 102 points now.");
    const { data } = await admin.from("reward_points").select("reason, staff_id").eq("client_id", clientId).eq("kind", "adjust").order("created_at", { ascending: false }).limit(1).single();
    expect(data).toEqual({ reason: "Missed points from last visit", staff_id: SEED.staff.manager });
  });
});

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("adds a reward to the catalog and sees the program on Reports", async ({ page }) => {
    await page.goto("/settings/rewards");
    await expect(ui(page).getByRole("form", { name: "Rewards program" }).getByLabel("Clients earn points")).toBeChecked();
    const form = ui(page).getByRole("form", { name: "New reward" });
    await waitForHydration(page, "form[aria-label='New reward'] button[type=submit]");
    await form.getByLabel("Name").fill(`Rw${RUN} Free blowout`);
    await form.getByLabel("Points", { exact: true }).fill("600");
    await form.getByLabel("What it gives").selectOption("free_service");
    // (A select's name includes its chosen option, so find it by its options.)
    await form.locator("select", { has: page.locator("option", { hasText: "Choose a service" }) }).selectOption({ label: "Blowout" });
    await form.getByRole("button", { name: "Add reward" }).click();
    await expect(form).toContainText("Saved.");
    await page.reload();
    await expect(ui(page).getByRole("heading", { name: `Rw${RUN} Free blowout` })).toBeVisible();

    await page.goto("/reports");
    const report = ui(page).getByTestId("rewards-report");
    await expect(report.getByTestId("points-outstanding")).toHaveText(/^[\d,]+ points$/);
    await expect(report).toContainText(/About \$[\d,.]+ in rewards/);
    await expect(ui(page).getByRole("table", { name: "Members by tier" })).toContainText("VIP");
  });
});
