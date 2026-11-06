// The opening drawer count before the first cash of the day: at checkout,
// Cash asks for the count first (cards don't); a manager can skip it on the
// spot with a reason, which owners see in the audit trail.
import { todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { onCheckout } from "./checkout-helpers";
import { AUTH, expect, PASSWORD, test, ui } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const today = todayIn("America/Chicago");
const PREFIX = `Db${Date.now().toString(36)}`;
const REASON = `Drawer key lost ${PREFIX}`;
const since = new Date().toISOString();
let productId: string;

test.use({ storageState: AUTH.frontDesk });

const clearDrawer = () => Promise.all([admin.from("drawer_counts").delete().eq("location_id", L).eq("day", today), admin.from("drawer_skips").delete().eq("location_id", L).eq("day", today)]);

test.beforeAll(async () => {
  await clearDrawer();
  const { data } = await admin
    .from("products")
    .insert({ business_id: B, brand: PREFIX, name: "Drawer Spray", sku: `${PREFIX}-DS`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 2000 })
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
  await clearDrawer();
  await admin.from("notifications").delete().eq("business_id", B).eq("template", "alert_drawer_skipped").gte("created_at", since);
});

test("cash waits for the opening count; a manager skips it with a reason, and the owner sees it", async ({ page, browser }) => {
  const { count: closed } = await admin.from("cash_closeouts").select("id", { count: "exact", head: true }).eq("location_id", L).eq("day", today);
  test.skip(!!closed, "Today's drawer is already closed out.");

  await page.goto("/sales");
  await expect(ui(page).getByTestId("drawer-reminder")).toContainText("Cash can’t be taken until it is.");
  await ui(page).getByRole("link", { name: "New sale" }).click();
  const co = await onCheckout(page);
  await co.ticket.getByRole("button", { name: "Walk-in guest" }).click();
  await co.addProduct(`${PREFIX}-DS`);

  await co.payment.getByRole("button", { name: "Cash", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Cash payment" });
  await expect(sheet.getByTestId("drawer-first")).toBeVisible();
  await expect(sheet.getByRole("form", { name: "Opening count", exact: true })).toBeVisible();
  const skip = sheet.getByRole("form", { name: "Skip the opening count" });
  await skip.getByLabel("Why isn’t it being counted?").fill(REASON);
  await skip.getByLabel("Manager’s email").fill("manager@mapleandash.test");
  await skip.getByLabel("Manager’s password").fill(PASSWORD);
  await skip.getByRole("button", { name: "Skip the count" }).click();
  await expect(sheet).toContainText("Cash can be taken today. Owners and managers have been told.");
  await sheet.getByRole("button", { name: /^Exact / }).click();
  await sheet.getByRole("button", { name: /^Record .* cash/ }).click();
  await co.complete();

  const { data: alert } = await admin.from("notifications").select("body").eq("staff_id", SEED.staff.owner).eq("template", "alert_drawer_skipped").like("body", `%${REASON}%`);
  expect(alert).toEqual([{ body: `Daniel Okafor let cash be taken today without the opening drawer count (asked by Sam Rivera): ${REASON}.` }]);

  const owner = await browser.newContext({ storageState: AUTH.owner });
  const op = await owner.newPage();
  try {
    await op.goto("/audit?type=drawer");
    await expect(ui(op).getByText(`Let cash be taken without the opening count (asked by Sam Rivera): ${REASON}`)).toBeVisible();
    await op.goto("/sales/drawer");
    await expect(ui(op).getByTestId("drawer-not-opened")).toContainText(REASON);
  } finally {
    await owner.close();
  }
});
