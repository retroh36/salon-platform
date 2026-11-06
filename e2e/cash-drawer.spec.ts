import { todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// The cash drawer: the front desk is reminded on Sales, counts the drawer
// when opening (a blind count), and again during the day; a count that's
// off lists the cash since the count before it.

const L = SEED.location;
const today = todayIn("America/Chicago");
const since = new Date().toISOString();
// A usual float of $100, so the drawer holds cash before anyone takes any
// today (just after midnight, the demo's float of $0 would match a $0 count).
let floatBefore = 0;

test.beforeAll(async () => {
  await admin.from("drawer_counts").delete().eq("location_id", L).eq("day", today);
  floatBefore = (await admin.from("businesses").select("cash_float_cents").eq("id", SEED.business).single()).data!.cash_float_cents;
  await admin.from("businesses").update({ cash_float_cents: 10000 }).eq("id", SEED.business);
});

test.afterAll(async () => {
  await admin.from("businesses").update({ cash_float_cents: floatBefore }).eq("id", SEED.business);
  await admin.from("drawer_counts").delete().eq("location_id", L).eq("day", today);
  await admin.from("notifications").delete().eq("template", "alert_drawer_off").gte("created_at", since);
});

test("the front desk opens the drawer, then counts it short during the day", async ({ browser }) => {
  // What the opening should hold: what the last close-out left, else the usual float.
  const { data: last } = await admin.from("cash_closeouts").select("counted_cents, deposit_cents").eq("location_id", L).lt("day", today).order("day", { ascending: false }).limit(1).maybeSingle();
  const { data: b } = await admin.from("businesses").select("cash_float_cents").eq("id", SEED.business).single();
  const opening = last ? last.counted_cents - last.deposit_cents : b!.cash_float_cents;
  const { count: closedToday } = await admin.from("cash_closeouts").select("id", { count: "exact", head: true }).eq("location_id", L).eq("day", today);
  test.skip(!!closedToday, "Today's drawer is already closed out.");

  const page = await browser.newPage({ storageState: AUTH.frontDesk });
  try {
    await page.goto("/sales");
    const main = ui(page);
    await expect(main.getByTestId("drawer-reminder")).toContainText("The cash drawer hasn’t been counted today.");
    await main.getByTestId("drawer-reminder").getByRole("link", { name: "Count it now" }).click();
    await expect(page).toHaveURL("/sales/drawer");
    await expect(main.getByTestId("drawer-not-opened")).toBeVisible();

    await waitForHydration(page, "form[aria-label='Opening count'] input");
    const open = main.getByRole("form", { name: "Opening count", exact: true });
    await open.getByLabel("Cash counted ($)").fill((opening / 100).toFixed(2));
    await open.getByRole("button", { name: "Save count" }).click();
    await expect(main.getByRole("status").filter({ hasText: "Saved. The drawer matches." })).toBeVisible();

    await page.reload();
    await waitForHydration(page, "form[aria-label='Count the drawer'] input");
    const mid = main.getByRole("form", { name: "Count the drawer" });
    await mid.getByLabel("Cash counted ($)").fill("0");
    await mid.getByLabel("Note (optional)").fill("Shift change");
    await mid.getByRole("button", { name: "Save count" }).click();
    await expect(mid.getByRole("status")).toContainText("short. Owners and managers have been told");
    await page.reload();
    await expect(main.getByTestId("drawer-counts").getByRole("row")).toHaveCount(3);
    await expect(main.getByRole("heading", { name: /^Cash before the .* count$/ })).toBeVisible();
  } finally {
    await page.close();
  }
});
