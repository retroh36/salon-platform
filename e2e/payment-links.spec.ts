import { createHash } from "node:crypto";
import { admin, makeRoom, SEED } from "../tests/db/helpers";
import { openCheckout } from "./checkout-helpers";
import { AUTH, expect, putBackSales, test } from "./fixtures";

// Stock and sales this file uses are put back afterwards.
putBackSales();

// Text-to-pay: the front desk sends a payment link from checkout; the
// client opens it on their phone, adds a tip and pays; the checkout
// completes by itself.

const B = SEED.business;
const L = SEED.location;
const PREFIX = `Tp${Date.now().toString(36)}`;
let clientId: string;
let appointmentId: string;
let putBack = async () => {};

test.beforeAll(async () => {
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Pia`, last_name: "Test", phone: "(312) 555-0177" }).select("id").single();
  clientId = c!.id;
  const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single();
  const start = new Date(Date.now() - 2 * 3_600_000);
  const end = new Date(start.getTime() + 3_600_000);
  // Bridget may have demo clients then, on a working day.
  putBack = await makeRoom(SEED.staff.bridget, start, end);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "checked_in" }).select("id").single();
  appointmentId = a!.id;
  await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: appointmentId, service_id: s!.id, staff_id: SEED.staff.bridget, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: 10000 });
});

test.afterAll(async () => {
  await admin.from("sales").delete().eq("client_id", clientId);
  await admin.from("appointments").delete().eq("client_id", clientId);
  await putBack();
  await admin.from("clients").delete().eq("id", clientId);
});

test.use({ storageState: AUTH.frontDesk });

test("sends a payment link; the client tips and pays on their phone; the checkout completes by itself", async ({ page, browser }) => {
  const co = await openCheckout(page, { appointmentId });
  await co.payment.getByRole("button", { name: "Text a payment link instead" }).click();
  await expect(co.dialog.getByLabel("Mobile number")).toHaveValue("(312) 555-0177");
  await co.dialog.getByRole("button", { name: "Send payment link" }).click();
  const waiting = page.getByTestId("link-waiting");
  await expect(waiting).toContainText("A link to pay $100 went to (312) 555-0177 by text");
  // The ticket waits as sent.
  await expect(co.ticket).toHaveAttribute("inert", "");

  // The text, in the outbox.
  const { data: sent } = await admin.from("outbox_messages").select("body").eq("to_address", "(312) 555-0177").order("created_at", { ascending: false }).limit(1).single();
  expect(sent!.body).toMatch(/^Maple & Ash Hair Studio: your total today is \$100\. Add a tip if you'd like and pay securely here: .+\/pay\/[A-Za-z0-9_-]+ \(the link works once and expires in 24 hours\)\.$/);
  const url = /(https?:\/\/\S+\/pay\/[A-Za-z0-9_-]+)/.exec(sent!.body)![1];
  const token = url.split("/pay/")[1];

  // On the client's phone, signed out.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const client = await phone.newPage();
  try {
    await client.goto(`/pay/${token}`);
    await expect(client.getByRole("heading", { level: 1 })).toHaveText(`Thanks for coming in, ${PREFIX}Pia`);
    await expect(client.getByTestId("link-line")).toHaveText(["Women's Cut & Stylewith Bridget$100"]);
    await client.getByRole("group", { name: "Tip for Bridget" }).getByRole("button", { name: /^20%/ }).click();
    await expect(client.getByTestId("link-total")).toHaveText("$120");
    // A declined card: nothing charged, try another.
    await client.getByLabel(/^Card/).selectOption({ label: "Visa …0002 (declined)" });
    await client.getByRole("button", { name: "Pay $120" }).click();
    await expect(client.locator("main").getByRole("alert")).toHaveText("The card was declined. You haven't been charged; try another card.");
    await client.getByLabel(/^Card/).selectOption({ label: "Visa …4242 (always works)" });
    await client.getByRole("button", { name: "Pay $120" }).click();
    await expect(client.getByTestId("link-paid")).toContainText("$120, including $20 in tips");
    // The link works once.
    await client.reload();
    await expect(client.getByTestId("link-paid")).toContainText("Paid. Thank you.");
  } finally {
    await phone.close();
  }

  // Back at the desk: done by itself.
  await expect(page.getByTestId("checkout-success")).toContainText("Paid by link", { timeout: 15_000 });
  await expect(page.getByTestId("checkout-success")).toContainText("$120");
  expect((await admin.from("appointments").select("status").eq("id", appointmentId).single()).data!.status).toBe("completed");
  const { data: link } = await admin.from("payment_links").select("status, tip_cents").eq("token_hash", createHash("sha256").update(token).digest("hex")).single();
  expect(link).toEqual({ status: "paid", tip_cents: 2000 });
});

test.describe("a manager voids it", () => {
  test.use({ storageState: AUTH.manager });

  test("after saying the card is refunded online, and it is", async ({ page }) => {
    const { data: sale } = await admin.from("sales").select("id").eq("appointment_id", appointmentId).eq("status", "completed").single();
    await page.goto(`/sales/${sale!.id}`);
    const form = page.getByRole("form", { name: "Void sale" });
    await form.getByLabel(/being voided/).fill("Charged the wrong client");
    await form.getByRole("button", { name: "Void sale" }).click();
    // It asks first: the money goes back to the card online.
    const ask = form.getByRole("alertdialog", { name: "Refund the card" });
    await expect(ask).toContainText("Voiding refunds $120 to the client's card through the payment provider.");
    await ask.getByRole("button", { name: "Keep the sale" }).click();
    await expect(ask).toHaveCount(0);
    expect((await admin.from("sales").select("status").eq("id", sale!.id).single()).data!.status).toBe("completed");
    await form.getByRole("button", { name: "Void sale" }).click();
    await form.getByRole("button", { name: "Void and refund $120" }).click();
    await expect(page.getByRole("list", { name: "Sale history" })).toContainText("Card refunded online");
    const { data: reversal } = await admin.from("payments").select("amount_cents, provider_refund").eq("sale_id", sale!.id).lt("amount_cents", 0);
    expect(reversal).toEqual([{ amount_cents: -12000, provider_refund: "refunded" }]);
  });
});

test("can cancel a link to take payment at the desk; a canceled link no longer works", async ({ page, browser }) => {
  // A retail sale for the same client.
  const { data: product } = await admin.from("stock_levels").select("product:products!inner(id, type, is_active)").eq("location_id", L).eq("product.type", "retail").eq("product.is_active", true).gt("on_hand", 5).limit(1).single();
  const co = await openCheckout(page, { productId: product!.product.id, from: "/sales" });
  await co.ticket.getByLabel("Find a client").fill(`${PREFIX}Pia`);
  await co.ticket.getByRole("list", { name: "Matching clients" }).getByRole("button").first().click();
  await co.payment.getByRole("button", { name: "Text a payment link instead" }).click();
  await co.dialog.getByRole("button", { name: "Send payment link" }).click();
  await expect(page.getByTestId("link-waiting")).toBeVisible();
  const { data: sent } = await admin.from("outbox_messages").select("body").eq("to_address", "(312) 555-0177").order("created_at", { ascending: false }).limit(1).single();
  const token = /\/pay\/([A-Za-z0-9_-]+)/.exec(sent!.body)![1];
  await page.getByRole("button", { name: "Cancel the link" }).click();
  await expect(co.payment.getByRole("button", { name: "Text a payment link instead" })).toBeVisible();

  const phone = await browser.newContext();
  const client = await phone.newPage();
  try {
    await client.goto(`/pay/${token}`);
    await expect(client.getByTestId("link-closed")).toContainText("This link is no longer active");
  } finally {
    await phone.close();
  }
});
