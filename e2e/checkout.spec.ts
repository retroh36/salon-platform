import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { onCheckout, openCheckout } from "./checkout-helpers";
import { AUTH, checkOut, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, frontDesk: FRONT_DESK } = SEED.staff;
// A Tuesday clear of the seeded month and the other tests' days.
const DAY = addDays(startOfWeek(todayIn(TZ)), 71);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const PREFIX = `Ck${Date.now().toString(36)}`;

let productId: string;

test.beforeAll(async () => {
  // A retail product of our own ($20, 10 in stock); retail taxed at 10%.
  const { data } = await admin
    .from("products")
    .insert({ business_id: B, brand: PREFIX, name: "Shine Spray", sku: `${PREFIX}-SS`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 2000 })
    .select("id")
    .single();
  productId = data!.id;
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: productId, on_hand: 10 });
  await admin.from("businesses").update({ tax_rate_services_bp: 0, tax_rate_retail_bp: 1000 }).eq("id", B);
});

test.afterAll(async () => {
  const { data: clients } = await admin.from("clients").select("id").like("first_name", `${PREFIX}%`);
  for (const c of clients ?? []) {
    await admin.from("sales").delete().eq("client_id", c.id);
    await admin.from("appointments").delete().eq("client_id", c.id);
  }
  await admin.from("sale_items").delete().eq("product_id", productId);
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
  await admin.from("stock_movements").delete().eq("product_id", productId);
  await admin.from("stock_levels").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
  await admin.from("businesses").update({ tax_rate_retail_bp: 1025 }).eq("id", B);
});

test.use({ viewport: { width: 1920, height: 1500 } });

// A $100 cut with Bridget, checked in.
async function visit(first: string) {
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}${first}`, last_name: "Test", email: `${first.toLowerCase()}@example.com` }).select("id").single();
  const { data: s } = await admin.from("services").select("id, active_minutes").eq("business_id", B).eq("name", "Women's Cut & Style").single();
  const end = new Date(at(10).getTime() + 60 * 60_000).toISOString();
  const { data: a } = await admin
    .from("appointments")
    .insert({ business_id: B, location_id: L, client_id: c!.id, starts_at: at(10).toISOString(), ends_at: end, status: "checked_in", created_by: FRONT_DESK })
    .select("id")
    .single();
  await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: s!.id, staff_id: BRIDGET, starts_at: at(10).toISOString(), ends_at: end, active_minutes: 60, price_cents: 10000 });
  return { clientId: c!.id, appointmentId: a!.id };
}

// From the visit's "Check out" on the calendar to the full-screen
// checkout.
async function fromCalendar(page: Page, first: string) {
  await page.goto(`/calendar?date=${DAY}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
  await waitForHydration(page, "section[data-staff-id]");
  await ui(page).getByRole("button", { name: new RegExp(`${PREFIX}${first} Test`) }).click();
  await checkOut(page.getByRole("tabpanel", { name: "Booking details" }));
  return onCheckout(page);
}

const onHand = async () => Number((await admin.from("stock_levels").select("on_hand").eq("product_id", productId).single()).data!.on_hand);

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("checks out a visit: a changed price, retail, a discount, a tip, and card plus cash with change", async ({ page }) => {
    const { appointmentId } = await visit("Ava");
    const co = await fromCalendar(page, "Ava");

    // $100 cut at $90, with a reason.
    let line = await co.edit("Women's Cut & Style");
    await line.getByLabel("Price ($)").fill("90");
    await line.getByLabel(/^Why the price changed/).fill("Shorter visit");
    // Two shine sprays, found by name.
    await co.addProduct("shine");
    line = await co.edit("Shine Spray");
    await line.getByRole("button", { name: "One more" }).click();
    await expect(line.getByTestId("line-quantity")).toHaveText("2");
    // 10% off the sale with a reason, and a $15 tip for Bridget.
    await co.ticket.getByRole("button", { name: "Discount the whole sale" }).click();
    await co.dialog.getByLabel("Percent off").fill("10");
    await co.dialog.getByLabel("Reason").fill("First visit");
    await co.dialog.getByRole("button", { name: "Apply discount" }).click();
    const tip = co.payment.getByRole("group", { name: "Tip for Bridget" });
    await tip.getByRole("button", { name: "Custom" }).click();
    await tip.getByLabel("Custom tip for Bridget ($)").fill("15");
    // $90 + $40 = $130; 10% off = $117 ($81 + $36); tax 10% of $36 = $3.60;
    // plus the tip: $135.60.
    await expect(co.total).toHaveText("$135.60");

    await co.card("100");
    await expect(co.remaining).toHaveText("$35.60 remaining to pay");
    await co.cash(40);
    await expect(co.remaining).toHaveText("Paid in fullChange to give: $4.40");
    const done = await co.complete();
    await expect(done).toContainText("$135.60");
    await expect(done.getByTestId("success-change")).toHaveText("Change to give: $4.40");

    // Email the receipt (to the dev outbox).
    await done.getByRole("button", { name: "Email" }).click();
    await done.getByLabel("Email address").fill("ava@example.com");
    await done.getByRole("button", { name: "Send" }).click();
    await expect(done.getByRole("status")).toHaveText("Receipt sent to ava@example.com.");
    const { data: sent } = await admin.from("outbox_messages").select("subject, body, html").eq("to_address", "ava@example.com").order("created_at", { ascending: false }).limit(1).single();
    expect(sent!.subject).toBe("Your receipt from Maple & Ash Hair Studio");
    expect(sent!.body).toContain("Total  $135.60");
    expect(sent!.html).toContain("Tip for Bridget");

    expect(await onHand()).toBe(8);
    expect((await admin.from("appointments").select("status").eq("id", appointmentId).single()).data!.status).toBe("completed");

    // The sale's page: the receipt, and no refunds for the front desk.
    await done.getByRole("link", { name: "View the sale" }).click();
    const receipt = ui(page).getByTestId("receipt");
    await expect(receipt).toContainText("Booked at $100 · Shorter visit");
    await expect(receipt).toContainText("Discount (First visit)−$13");
    await expect(receipt).toContainText("Paid · Card$100");
    await expect(receipt).toContainText("Change given$4.40");
    await expect(ui(page).getByRole("form", { name: "Refund" })).toHaveCount(0);
    await expect(ui(page).getByRole("form", { name: "Void sale" })).toHaveCount(0);
  });

  test("can't pay short, and can't give more discount than allowed", async ({ page }) => {
    await admin.from("businesses").update({ discount_max_percent: 10 }).eq("id", B);
    try {
      const { appointmentId } = await visit("Bea");
      const co = await openCheckout(page, { appointmentId });
      await co.ticket.getByRole("button", { name: "Discount the whole sale" }).click();
      await co.dialog.getByLabel("Percent off").fill("25");
      await co.dialog.getByLabel("Reason").fill("Friend");
      await co.dialog.getByRole("button", { name: "Apply discount" }).click();
      await co.card();
      await expect(co.payment.getByTestId("checkout-blocked")).toHaveText("You can give up to 10% off. Ask a manager for more.");
      await expect(co.payment.getByRole("button", { name: /^Complete sale/ })).toBeDisabled();
      // Without the discount, the card's $75 leaves $25 to pay, and the sale
      // can't be completed.
      await co.ticket.getByRole("button", { name: "Change discount" }).click();
      await co.dialog.getByLabel("Percent off").fill("");
      await co.dialog.getByRole("button", { name: "No discount" }).click();
      await expect(co.payment.getByTestId("checkout-blocked")).toHaveText("$25 still to pay.");
      await expect(co.payment.getByRole("button", { name: /^Complete sale/ })).toBeDisabled();
    } finally {
      await admin.from("businesses").update({ discount_max_percent: 100 }).eq("id", B);
    }
  });

  test("sells retail without a visit", async ({ page }) => {
    const co = await openCheckout(page, { from: "/sales" });
    // Scanning: the SKU and Enter.
    await co.search(`${PREFIX}-SS`);
    await co.ticket.getByLabel("Add a product: name, brand, SKU or scan").press("Enter");
    await expect(co.total).toHaveText("$22");
    await co.cash();
    const done = await co.complete();
    await expect(done).toContainText("$22");
    await done.getByRole("link", { name: "Back to sales" }).click();
    await expect(ui(page).getByRole("list", { name: "Sales" }).getByRole("listitem").first()).toContainText("Walk-in sale");
  });
});

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("refunds part of a sale, then voids another, each with a reason", async ({ page }) => {
    const total = 2000 * 2 + 400;
    const sell = async () => {
      const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Cy`, last_name: "Test" }).select("id").single();
      // Sold by the front desk, through the database function.
      const desk = await import("../tests/db/helpers").then((h) => h.signIn("frontdesk@mapleandash.test"));
      const { data: saleId, error } = await desk.rpc("complete_sale", {
        p_location_id: L,
        p_input: { client_id: data!.id, lines: [{ kind: "product", product_id: productId, quantity: 2 }], payments: [{ method: "card", amount_cents: total }] },
      });
      expect(error).toBeNull();
      return saleId!;
    };

    const first = await sell();
    await page.goto(`/sales/${first}`);
    await waitForHydration(page, "form[aria-label=Refund] input");
    const refund = ui(page).getByRole("form", { name: "Refund" });
    await refund.getByLabel("Amount ($)").fill("22");
    await refund.getByLabel(/returned$/).fill("1");
    await refund.getByLabel("Reason", { exact: true }).fill("One was damaged");
    await refund.getByRole("button", { name: "Refund" }).click();
    await expect(refund.getByRole("status")).toHaveText("Refunded.");
    await expect(ui(page).getByText("Part refunded")).toBeVisible();
    await expect(ui(page).getByRole("list", { name: "Sale history" })).toContainText("Refunded · One was damaged · by Olivia");
    expect((await admin.from("sales").select("refunded_cents").eq("id", first).single()).data!.refunded_cents).toBe(2200);

    const second = await sell();
    await page.goto(`/sales/${second}`);
    await waitForHydration(page, "form[aria-label='Void sale'] input");
    const voidForm = ui(page).getByRole("form", { name: "Void sale" });
    await voidForm.getByLabel(/being voided/).fill("Rang up twice");
    await voidForm.getByRole("button", { name: "Void sale" }).click();
    await expect(ui(page).getByTestId("receipt")).toContainText("Voided: Rang up twice");
    expect((await admin.from("sales").select("status").eq("id", second).single()).data!.status).toBe("voided");
  });

  test("refunding a gift card gives back only what's left on it, and cancels the card", async ({ page }) => {
    const desk = await import("../tests/db/helpers").then((h) => h.signIn("frontdesk@mapleandash.test"));
    const { data: saleId } = await desk.rpc("complete_sale", {
      p_location_id: L,
      p_input: { lines: [{ kind: "gift_card", amount_cents: 5000, recipient_name: `${PREFIX} Gift` }], payments: [{ method: "card", amount_cents: 5000 }] },
    });
    const { data: card } = await admin.from("gift_cards").select("id, code").eq("sale_id", saleId!).single();
    // $12 of it already spent.
    await admin.from("gift_cards").update({ balance_cents: 3800 }).eq("id", card!.id);
    await page.goto(`/sales/${saleId}`);
    await waitForHydration(page, "form[aria-label=Refund] input");
    const refund = ui(page).getByRole("form", { name: "Refund" });
    await refund.getByRole("checkbox", { name: /^Refund Gift card/ }).check();
    await expect(refund.getByRole("checkbox", { name: /^Refund Gift card/ })).toHaveAccessibleName(/\$38 back: cancels what's left on the card/);
    await expect(refund.getByLabel("Amount ($)")).toHaveValue("38.00");
    await refund.getByLabel("Reason", { exact: true }).fill("Changed their mind");
    await refund.getByRole("button", { name: "Refund" }).click();
    await expect(refund.getByRole("status")).toHaveText("Refunded.");
    expect((await admin.from("gift_cards").select("status, balance_cents").eq("id", card!.id).single()).data).toEqual({ status: "voided", balance_cents: 0 });
    expect((await admin.from("sales").select("refunded_cents").eq("id", saleId!).single()).data!.refunded_cents).toBe(3800);
    await admin.from("sales").delete().eq("id", saleId!);
    await admin.from("gift_cards").delete().eq("id", card!.id);
  });
});

test.describe("stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("doesn't see sales", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("aside").first().getByRole("link", { name: "Sales" })).toHaveCount(0);
    await page.goto("/sales");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
