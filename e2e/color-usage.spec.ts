import type { Page } from "@playwright/test";
import { fromLocal, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { onCheckout } from "./checkout-helpers";
import { AUTH, checkOut, expect, test, ui, visitTab, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const TODAY = todayIn(TZ);
const PREFIX = `Cu${Date.now().toString(36)}`;
const created: string[] = [];

async function productId(sku: string) {
  const { data } = await admin.from("products").select("id").eq("sku", sku).single();
  return data!.id;
}

async function onHand(sku: string) {
  const { data } = await admin.from("stock_levels").select("on_hand").eq("product_id", await productId(sku)).eq("location_id", L).single();
  return data!.on_hand;
}

// A color visit with Bridget today, before opening so it doesn't clash.
async function colorVisit(status: "booked" | "checked_in") {
  const { data: client } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Rose`, last_name: "Test" }).select("id").single();
  const { data: s } = await admin.from("services").select("id, duration_minutes, active_minutes, processing_minutes, finishing_minutes, price_cents").eq("business_id", B).eq("name", "All-Over Color").single();
  const start = fromLocal(TODAY, 6 * 60, TZ)!;
  const end = new Date(start.getTime() + s!.duration_minutes! * 60_000);
  const { data: a } = await admin
    .from("appointments")
    .insert({ business_id: B, location_id: L, client_id: client!.id, starts_at: start.toISOString(), ends_at: end.toISOString(), status, created_by: SEED.staff.frontDesk })
    .select("id")
    .single();
  await admin.from("appointment_items").insert({
    business_id: B,
    location_id: L,
    appointment_id: a!.id,
    service_id: s!.id,
    staff_id: SEED.staff.bridget,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    active_minutes: s!.active_minutes,
    processing_minutes: s!.processing_minutes,
    finishing_minutes: s!.finishing_minutes,
    price_cents: s!.price_cents,
  });
  created.push(a!.id);
  return { appointmentId: a!.id, clientId: client!.id };
}

test.afterAll(async () => {
  // Put back what the visits took from stock, then remove them.
  const { data: moves } = await admin.from("stock_movements").select("product_id, change").in("appointment_id", created);
  for (const m of moves ?? []) {
    const { data: level } = await admin.from("stock_levels").select("on_hand").eq("product_id", m.product_id).eq("location_id", L).single();
    await admin.from("stock_levels").update({ on_hand: level!.on_hand - m.change }).eq("product_id", m.product_id).eq("location_id", L);
  }
  await admin.from("stock_movements").delete().in("appointment_id", created);
  await admin.from("appointments").delete().in("id", created);
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

async function openVisit(page: Page) {
  await page.goto("/calendar");
  await waitForHydration(page, "section[data-staff-id]");
  await ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Rose Test`) }).click();
  return page.getByRole("tabpanel", { name: "Booking details" });
}

test.describe("formulas and stock", () => {
  test("a stylist records a formula; checkout takes exactly that from stock", async ({ browser }) => {
    test.setTimeout(60_000);
    const visit = await colorVisit("checked_in");
    const before = { tc: await onHand("GW-TC-7N"), dev: await onHand("GW-DEV-20") };

    const stylist = await browser.newPage({ storageState: AUTH.stylist, viewport: { width: 1920, height: 1300 } });
    const panel = await openVisit(stylist);
    await visitTab(panel, "Formula");
    await panel.getByRole("button", { name: "Record formula" }).click();
    const form = panel.getByRole("form", { name: "Record formula" });
    const first = form.getByRole("group", { name: "Product 1" });
    await first.getByLabel("Product", { exact: true }).selectOption({ label: "Topchic 7N (g)" });
    await first.getByLabel("Amount").fill("30");
    await form.getByRole("button", { name: "Add a product" }).click();
    const second = form.getByRole("group", { name: "Product 2" });
    await second.getByLabel("Product", { exact: true }).selectOption({ label: "Topchic 20 Vol Developer (6%) (ml)" });
    await second.getByLabel("Amount").fill("30");
    await form.getByRole("button", { name: "Save formula" }).click();
    await expect(panel.getByRole("status")).toHaveText("Formula saved. Stock is taken at checkout.");
    await expect(panel.getByTestId("visit-formula-products")).toHaveText("30 g Goldwell Topchic 7N + 30 ml Goldwell Topchic 20 Vol Developer (6%)");
    expect(await onHand("GW-TC-7N")).toBeCloseTo(before.tc, 2);
    await stylist.close();

    const desk = await browser.newPage({ storageState: AUTH.frontDesk, viewport: { width: 1920, height: 1300 } });
    const deskPanel = await openVisit(desk);
    await checkOut(deskPanel);
    const checkout = await onCheckout(desk);
    await checkout.card();
    await checkout.complete();
    await expect.poll(() => onHand("GW-TC-7N")).toBeCloseTo(before.tc - 30, 2);
    await expect.poll(() => onHand("GW-TC-7N")).toBeCloseTo(before.tc - 30, 2);
    expect(await onHand("GW-DEV-20")).toBeCloseTo(before.dev - 30, 2);

    // The product's history says why.
    await desk.goto(`/inventory/${await productId("GW-TC-7N")}`);
    const history = ui(desk).getByRole("list", { name: "Stock history" }).getByRole("listitem").first();
    await expect(history).toContainText("Service use");
    await expect(history).toContainText("−30 g");
    await expect(history).toContainText("All-Over Color: formula");

    // And the client's record shows the products.
    await desk.goto(`/clients/${visit.clientId}`);
    await expect(ui(desk).getByTestId("formula-products").first()).toContainText("30 g Goldwell Topchic 7N");
    await desk.close();
  });

  test("a manager sets a service's default recipe", async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH.owner });
    const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Scalp Treatment").single();
    await page.goto(`/services/${s!.id}`);
    await waitForHydration(page, "form[aria-label='Product recipe'] button");
    const recipe = ui(page).getByRole("form", { name: "Product recipe" });
    await recipe.getByRole("button", { name: "Add a product" }).click();
    await recipe.getByRole("group", { name: "Product 1" }).getByLabel("Product", { exact: true }).selectOption({ label: "Acidic Bonding Concentrate Intensive Treatment (back bar) (ml)" });
    await recipe.getByRole("group", { name: "Product 1" }).getByLabel("Amount").fill("20");
    await recipe.getByRole("button", { name: "Save recipe" }).click();
    await expect(recipe.getByRole("status")).toHaveText("Recipe saved.");
    const { data } = await admin.from("service_products").select("amount").eq("service_id", s!.id);
    expect(data).toEqual([{ amount: 20 }]);
    await admin.from("service_products").delete().eq("service_id", s!.id);
    await page.close();
  });

  test("stylists see recipes but can't change them", async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH.stylist });
    const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Gloss / Toner").single();
    await page.goto(`/services/${s!.id}`);
    const card = ui(page).getByRole("region", { name: "Product recipe" });
    await expect(card).toContainText("60 ml Redken Shades EQ 09V + 60 ml Redken Shades EQ Processing Solution");
    await expect(card.getByRole("button", { name: "Save recipe" })).toHaveCount(0);
    await page.close();
  });
});
