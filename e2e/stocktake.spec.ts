import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const L = SEED.location;

async function product(sku: string) {
  const { data } = await admin.from("products").select("id").eq("sku", sku).single();
  return data!.id;
}
const level = async (sku: string) => (await admin.from("stock_levels").select("on_hand").eq("product_id", await product(sku)).eq("location_id", L).single()).data!.on_hand;

// Put stock back the way the seed left it.
test.afterAll(async () => {
  const { data: takes } = await admin.from("stocktakes").select("id").eq("location_id", L);
  const ids = (takes ?? []).map((t) => t.id);
  if (!ids.length) return;
  const { data: moves } = await admin.from("stock_movements").select("id, product_id, change").in("stocktake_id", ids);
  for (const m of moves ?? []) {
    const { data: l } = await admin.from("stock_levels").select("on_hand").eq("product_id", m.product_id).eq("location_id", L).single();
    await admin.from("stock_levels").update({ on_hand: l!.on_hand - m.change }).eq("product_id", m.product_id).eq("location_id", L);
    await admin.from("stock_movements").delete().eq("id", m.id);
  }
  await admin.from("stocktakes").delete().in("id", ids);
});

test.describe("on an iPad", () => {
  test.use({ storageState: AUTH.owner, viewport: { width: 820, height: 1180 }, hasTouch: true });

  test("counts shelf by shelf, flags a big gap, and puts stock right", async ({ page }) => {
    const before = { sevenN: await level("GW-TC-7N"), fourN: await level("GW-TC-4N"), dryspun: await level("BB-TDF-150") };
    await page.goto("/inventory");
    await ui(page).getByRole("link", { name: "Stocktake" }).click();
    await ui(page).getByRole("button", { name: "Start a stocktake" }).click();
    await waitForHydration(page, "nav[aria-label=Shelves] button");

    const shelves = ui(page).getByRole("navigation", { name: "Shelves" });
    await shelves.getByRole("button", { name: /Color bar A/ }).tap();
    const shelf = ui(page).getByRole("region", { name: "Color bar A" });

    // 7N: two full tubes on the shelf (the records say 144 g).
    const sevenN = shelf.getByRole("form", { name: "Goldwell Topchic 7N", exact: true });
    await sevenN.getByRole("button", { name: "One more Goldwell Topchic 7N", exact: true }).tap();
    await sevenN.getByRole("button", { name: "One more Goldwell Topchic 7N", exact: true }).tap();
    await sevenN.getByRole("button", { name: "Save count" }).tap();
    await expect(sevenN.getByTestId("count-result")).toContainText(`Expected ${before.sevenN} g · counted 120 g`);
    await expect(sevenN.getByTestId("count-result")).toContainText("−24 g");

    // 4N: just an open tube with 30 g, far less than expected.
    const fourN = shelf.getByRole("form", { name: "Goldwell Topchic 4N", exact: true });
    await fourN.getByLabel("Open (g)").fill("30");
    await fourN.getByRole("button", { name: "Save count" }).tap();
    await expect(fourN.getByTestId("count-result")).toContainText("Possible shrinkage");
    await expect(shelves.getByRole("button", { name: /Color bar A/ })).toContainText("2/12");

    // Retail, by unit.
    await shelves.getByRole("button", { name: /Styling shelf/ }).tap();
    const dryspun = ui(page).getByRole("form", { name: "Bumble and bumble Thickening Dryspun Finish 150 ml" });
    await dryspun.getByLabel("Units").fill(String(before.dryspun));
    await dryspun.getByRole("button", { name: "Save count" }).tap();
    await expect(dryspun.getByTestId("count-result")).toContainText("Matches");
    await expect(ui(page).getByTestId("count-progress")).toHaveText("3 of 47 counted");

    await ui(page).getByRole("button", { name: "Review and finish" }).tap();
    const review = ui(page).getByRole("region", { name: "Review stocktake" });
    await expect(review.getByRole("note")).toContainText("well short of what the records say");
    const differences = review.getByRole("list", { name: "Differences" }).getByRole("listitem");
    await expect(differences).toHaveCount(2);
    await expect(differences.filter({ hasText: "Goldwell Topchic 4N" })).toContainText("Possible shrinkage");

    await review.getByRole("button", { name: "Finish and update stock" }).tap();
    await expect(page).toHaveURL(/\/inventory\/count\/[0-9a-f-]{36}$/);
    await expect(ui(page).getByText(/Stock was updated for 2 products/)).toBeVisible();
    await expect(ui(page).getByRole("note")).toContainText("Possible shrinkage on 1 product");
    expect(await level("GW-TC-7N")).toBe(120);
    expect(await level("GW-TC-4N")).toBe(30);
    expect(await level("BB-TDF-150")).toBe(before.dryspun);

    // The product's history shows the count.
    await page.goto(`/inventory/${await product("GW-TC-4N")}`);
    await expect(ui(page).getByRole("list", { name: "Stock history" }).getByRole("listitem").first()).toContainText("Stocktake");
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("can't run a stocktake", async ({ page }) => {
    await page.goto("/inventory");
    await expect(ui(page).getByRole("link", { name: "Stocktake" })).toHaveCount(0);
    await page.goto("/inventory/count");
    await expect(page).toHaveURL(/\/inventory$/);
  });
});
