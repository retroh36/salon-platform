import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { checkout, openCheckout } from "./checkout-helpers";
import { allowOfflineLogs, AUTH, expect, putBackSales, test } from "./fixtures";

// Stock and sales this file uses are put back afterwards.
putBackSales();

// The full-screen checkout on an iPad at the front desk: a busy ticket with
// two stylists, products by search and quick-add, editing and removing
// lines, an added service, tips, a split payment and rebooking.

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, gil: GIL, frontDesk: FRONT_DESK } = SEED.staff;
// A Wednesday clear of the seeded month and the other tests' days.
const DAY = addDays(startOfWeek(todayIn(TZ)), 79);
const PREFIX = `Cs${Date.now().toString(36)}`;

test.use({ storageState: AUTH.frontDesk, viewport: { width: 1180, height: 820 }, hasTouch: true });

test.beforeAll(async () => {
  // A $20 spray, 10 in stock, and one that's sold out.
  const { data } = await admin
    .from("products")
    .insert([
      { business_id: B, brand: PREFIX, name: "Shine Spray", sku: `${PREFIX}-SS`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 2000 },
      { business_id: B, brand: PREFIX, name: "Sold Out Serum", sku: `${PREFIX}-SO`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 3000 },
    ])
    .select("id, name");
  await admin.from("stock_levels").insert(data!.map((p) => ({ business_id: B, location_id: L, product_id: p.id, on_hand: p.name === "Shine Spray" ? 10 : 0 })));
});

test.afterAll(async () => {
  const { data: clients } = await admin.from("clients").select("id").like("first_name", `${PREFIX}%`);
  for (const c of clients ?? []) {
    await admin.from("sales").delete().eq("client_id", c.id);
    await admin.from("appointments").delete().eq("client_id", c.id);
  }
  const { data: products } = await admin.from("products").select("id").eq("brand", PREFIX);
  for (const p of products ?? []) {
    await admin.from("sale_items").delete().eq("product_id", p.id);
    await admin.from("stock_movements").delete().eq("product_id", p.id);
    await admin.from("stock_levels").delete().eq("product_id", p.id);
    await admin.from("products").delete().eq("id", p.id);
  }
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

// A cut with Bridget ($100) then a gloss with Gil ($65), checked in.
// Each visit two hours after the last, so no one is booked twice.
let visits = 0;
async function visit(first: string) {
  const t = 2 * 60 * visits++;
  const at = (minute: number) => fromLocal(DAY, minute + t, TZ)!;
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}${first}`, last_name: "Test" }).select("id").single();
  const { data: services } = await admin.from("services").select("id, name").eq("business_id", B).in("name", ["Women's Cut & Style", "Gloss / Toner"]);
  const id = (name: string) => services!.find((s) => s.name === name)!.id;
  const { data: a } = await admin
    .from("appointments")
    .insert({ business_id: B, location_id: L, client_id: c!.id, starts_at: at(600).toISOString(), ends_at: at(705).toISOString(), status: "checked_in", created_by: FRONT_DESK })
    .select("id")
    .single();
  await admin.from("appointment_items").insert([
    { business_id: B, location_id: L, appointment_id: a!.id, service_id: id("Women's Cut & Style"), staff_id: BRIDGET, starts_at: at(600).toISOString(), ends_at: at(660).toISOString(), active_minutes: 60, price_cents: 10000 },
    { business_id: B, location_id: L, appointment_id: a!.id, service_id: id("Gloss / Toner"), staff_id: GIL, starts_at: at(660).toISOString(), ends_at: at(705).toISOString(), active_minutes: 45, price_cents: 6500 },
  ]);
  return { clientId: c!.id, appointmentId: a!.id };
}

test("a busy checkout: search and quick-add, edit and remove with undo, an added service, tips, split payment and rebooking", async ({ page }) => {
  const { clientId, appointmentId } = await visit("Daniel");
  const co = await openCheckout(page, { appointmentId, from: `/calendar?date=${DAY}` });
  await expect(page.getByTestId("checkout-client")).toHaveText(`${PREFIX}Daniel Test`);

  // The visit's services, grouped by stylist with a subtotal each.
  const bridget = co.ticket.getByRole("region", { name: "Bridget Callahan's lines" });
  const gil = co.ticket.getByRole("region", { name: "Gil Navarro's lines" });
  await expect(bridget.getByTestId("stylist-subtotal")).toHaveText("Subtotal $100");
  await expect(gil.getByTestId("stylist-subtotal")).toHaveText("Subtotal $65");

  // A product by search: price and stock in the results, one tap adds it,
  // credited to the client's stylist.
  await co.search("shine");
  const results = co.ticket.getByRole("list", { name: "Matching products" });
  await expect(results).toContainText("$20");
  await expect(results).toContainText("10 left");
  await results.getByRole("button").first().click();
  await expect(bridget.getByTestId("ticket-line")).toHaveCount(2);
  await expect(bridget.getByTestId("ticket-line").last()).toContainText("sold by Bridget");
  // Two of them.
  await (await co.edit("Shine Spray")).getByRole("button", { name: "One more" }).click();
  await expect(bridget.getByTestId("ticket-line").last().getByTestId("line-total")).toHaveText("$40");

  // A best seller from the quick-add tiles.
  const before = await co.lines.count();
  await co.ticket.getByTestId("best-sellers").getByRole("button").filter({ hasNotText: "Out of stock" }).first().click();
  await expect(co.lines).toHaveCount(before + 1);

  // Out of stock: a warning, and the front desk needs a manager's OK.
  await co.addProduct("Sold Out Serum");
  const serum = co.lines.filter({ hasText: "Sold Out Serum" });
  await expect(serum.getByTestId("out-of-stock")).toHaveText("Only 0 in stock");
  await expect(co.payment.getByTestId("checkout-blocked")).toContainText("Sold Out Serum is out of stock: a manager needs to OK selling it.");
  await co.ticket.getByRole("button", { name: /Sold Out Serum.*Edit$/ }).click();
  await co.ticket.getByRole("button", { name: "Manager OK" }).click();
  await co.dialog.getByLabel("Manager’s email").fill("manager@mapleandash.test");
  await co.dialog.getByLabel("Password").fill("password123");
  await co.dialog.getByRole("button", { name: "OK the sale" }).click();
  await expect(co.dialog).toHaveCount(0);
  await expect(serum.getByTestId("out-of-stock")).toHaveCount(0);

  // Remove the serum, undo, and remove it for good.
  await co.ticket.getByRole("button", { name: /^Remove .*Sold Out Serum$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Removed" })).toContainText("Sold Out Serum");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(co.ticket.getByText("Sold Out Serum")).toBeVisible();
  await co.ticket.getByRole("button", { name: /^Remove .*Sold Out Serum$/ }).click();
  await expect(co.ticket.getByText("Sold Out Serum")).toHaveCount(0);

  // The cut at $90 with a reason; 10% off the gloss for loyalty.
  let line = await co.edit("Women's Cut & Style");
  await line.getByLabel("Price ($)").fill("90");
  await line.getByLabel(/^Why the price changed/).fill("Shorter visit");
  line = await co.edit("Gloss / Toner");
  await line.getByLabel("Percent off").fill("10");
  await line.getByLabel("Discount reason").fill("Loyalty");
  await expect(gil.getByTestId("stylist-subtotal")).toHaveText("Subtotal $58.50");
  // A blowout added on the spot, with Gil.
  await co.ticket.getByRole("button", { name: "Add service" }).click();
  await co.dialog.getByLabel("Stylist").selectOption({ label: "Gil Navarro" });
  await co.dialog.getByLabel("Find a service").fill("blowout");
  await co.dialog.getByRole("list", { name: "Services" }).getByRole("button", { name: /^Blowout/ }).click();
  await expect(gil.getByTestId("ticket-line").last()).toContainText("added at checkout");
  await expect(gil.getByTestId("stylist-subtotal")).toHaveText("Subtotal $123.50");

  // Tips on each stylist's services: 20% of Bridget's $90, 18% of Gil's
  // $123.50.
  await co.payment.getByRole("group", { name: "Tip for Bridget" }).getByRole("button", { name: "20%" }).click();
  await co.payment.getByRole("group", { name: "Tip for Gil" }).getByRole("button", { name: "18%" }).click();
  await expect(co.payment.getByRole("group", { name: "Tip for Bridget" }).getByTestId("tip-amount")).toHaveText("$18 on $90");
  await expect(co.payment.getByRole("group", { name: "Tip for Gil" }).getByTestId("tip-amount")).toHaveText("$22.23 on $123.50");

  // Nothing can be completed until it's paid.
  await expect(co.payment.getByRole("button", { name: /^Complete sale/ })).toBeDisabled();
  await expect(co.payment.getByTestId("checkout-blocked")).toHaveText(/still to pay\.$/);
  // The busy ticket, every line in view (the editor closed, the toast gone).
  await co.ticket.getByRole("button", { name: /^Blowout: .*Edit$/ }).click();
  await co.ticket.getByRole("button", { name: /^Blowout: .*Edit$/ }).click();
  await expect(co.ticket.getByRole("group", { name: /^Edit / })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Removed" })).toHaveCount(0, { timeout: 10_000 });
  await page.screenshot({ path: "e2e/screenshots/checkout-ipad-busy.png" });

  // Split: $100 on card, the rest in cash with change.
  await co.card("100");
  await expect(co.payment.getByTestId("payment-line")).toHaveCount(1);
  await co.payment.getByRole("button", { name: "Cash", exact: true }).click();
  const quick = co.dialog.getByRole("group", { name: "Quick amounts" }).getByRole("button");
  await quick.nth(1).click();
  await expect(co.dialog.getByTestId("change-due")).toContainText("Change due");
  await co.dialog.getByRole("button", { name: /^Record .* cash$/ }).click();
  await expect(co.payment.getByTestId("payment-line")).toHaveCount(2);
  await expect(co.remaining).toContainText("Paid in full");
  await expect(co.remaining).toContainText("Change to give");

  // Rebook before they leave: Denise's suggestion, in one tap.
  const rebook = co.payment.getByTestId("rebook");
  await expect(rebook).toContainText("with Bridget");
  await rebook.getByRole("button", { name: "Book it" }).click();
  await expect(co.payment.getByTestId("rebooked")).toContainText("Rebooked for");
  await page.screenshot({ path: "e2e/screenshots/checkout-ipad-paid.png" });

  const done = await co.complete();
  await expect(done.getByTestId("success-rebooked")).toContainText("Rebooked for");
  await expect(done.getByRole("button", { name: "No receipt" })).toBeVisible();
  await expect(done.getByRole("link", { name: "Back to calendar" })).toHaveAttribute("href", `/calendar?date=${DAY}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "e2e/screenshots/checkout-ipad-done.png" });

  // What was saved: stylist credit, the line discount, tips, the rebooking.
  const { data: sale } = await admin
    .from("sales")
    .select("rebook_appointment_id, sale_items(kind, description, staff_id, quantity, line_discount_cents, line_discount_reason), sale_tips(staff_id, amount_cents)")
    .eq("appointment_id", appointmentId)
    .single();
  const item = (d: string) => sale!.sale_items.find((i) => i.description.includes(d))!;
  expect(item("Shine Spray")).toMatchObject({ staff_id: BRIDGET, quantity: 2 });
  expect(item("Gloss")).toMatchObject({ staff_id: GIL, line_discount_cents: 650, line_discount_reason: "Loyalty" });
  expect(item("Blowout")).toMatchObject({ staff_id: GIL, kind: "service" });
  expect(sale!.sale_tips.sort((a, b) => a.amount_cents - b.amount_cents)).toEqual([
    { staff_id: BRIDGET, amount_cents: 1800 },
    { staff_id: GIL, amount_cents: 2223 },
  ]);
  const { data: next } = await admin.from("appointments").select("client_id, status").eq("id", sale!.rebook_appointment_id!).single();
  expect(next).toEqual({ client_id: clientId, status: "booked" });
});

test("Escape goes back with nothing lost, and the ticket is there when it's opened again", async ({ page }) => {
  const { appointmentId } = await visit("Esme");
  let co = await openCheckout(page, { appointmentId, from: `/calendar?date=${DAY}` });
  await co.addProduct("shine");
  await expect(co.lines).toHaveCount(3);
  // Removing a line by swiping it left.
  const row = co.lines.last().getByRole("button").first();
  const box = (await row.boundingBox())!;
  await row.dispatchEvent("pointerdown", { pointerType: "touch", clientX: box.x + box.width - 80, clientY: box.y + 20, pointerId: 7 });
  await row.dispatchEvent("pointermove", { pointerType: "touch", clientX: box.x + box.width - 260, clientY: box.y + 20, pointerId: 7 });
  await row.dispatchEvent("pointerup", { pointerType: "touch", clientX: box.x + box.width - 260, clientY: box.y + 20, pointerId: 7 });
  await expect(co.lines).toHaveCount(2);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(co.lines).toHaveCount(3);

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(`/calendar?date=${DAY}`);
  co = await openCheckout(page, { appointmentId });
  await expect(co.lines).toHaveCount(3);
  await expect(checkout(page).ticket).toContainText("Shine Spray");
});

test("the connection drops as the sale completes: it says so, and tapping again shows it done, recorded once", async ({ page, pageErrors }) => {
  const { data: spray } = await admin.from("products").select("id").eq("brand", PREFIX).eq("name", "Shine Spray").single();
  const co = await openCheckout(page, { productId: spray!.id, from: "/sales" });
  const draftId = page.url().split("/").pop()!;
  await co.cash();
  // The server completes the sale, but the answer never gets back.
  let dropped = false;
  await page.route(`**/checkout/${draftId}`, async (route) => {
    if (route.request().method() !== "POST" || dropped || !(route.request().postData() ?? "").includes("payments")) return route.continue();
    dropped = true;
    await route.fetch();
    await route.abort("internetdisconnected");
  });
  await co.payment.getByRole("button", { name: /^Complete sale/ }).click();
  await expect(co.payment.getByRole("alert")).toContainText("We couldn't reach the server");
  await co.payment.getByRole("button", { name: /^Complete sale/ }).click();
  await expect(page.getByTestId("checkout-success")).toBeVisible();
  // One sale for this checkout (the busy one above sold a spray too).
  const { data: sales } = await admin.from("sales").select("id").eq("draft_id", draftId);
  expect(sales).toHaveLength(1);
  // The dropped request is the browser's one complaint.
  allowOfflineLogs(pageErrors);
});

test("offline, going back keeps the checkout open and says so, so the ticket isn't lost", async ({ page, pageErrors }) => {
  const { appointmentId } = await visit("Ollie");
  const co = await openCheckout(page, { appointmentId, from: `/calendar?date=${DAY}` });
  const here = page.url();
  await page.context().setOffline(true);
  await co.addProduct("shine");
  await expect(co.lines).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("checkout-blocked")).toContainText("The ticket isn't saved: check the connection");
  expect(page.url()).toBe(here);
  await page.context().setOffline(false);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(`/calendar?date=${DAY}`);
  await openCheckout(page, { appointmentId });
  await expect(checkout(page).ticket).toContainText("Shine Spray");
  allowOfflineLogs(pageErrors);
});
