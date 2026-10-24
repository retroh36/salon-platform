import { addInterval } from "@/lib/memberships";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { runMembershipBilling } from "@/lib/memberships-billing";
import { admin, SEED, signIn } from "../tests/db/helpers";
import { openCheckout } from "./checkout-helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const today = todayIn(TZ);
// A Thursday clear of the seeded month and the other tests' days.
const DAY = addDays(startOfWeek(today), 87);
const PREFIX = `Me${Date.now().toString(36)}`;

let clientId: string;
const extra: string[] = [];

test.beforeAll(async () => {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Mia`, last_name: "Test" }).select("id").single();
  clientId = data!.id;
});

test.afterAll(async () => {
  for (const id of [clientId, ...extra]) {
    await admin.from("sales").delete().eq("client_id", id);
    await admin.from("appointments").delete().eq("client_id", id);
    await admin.from("clients").delete().eq("id", id);
  }
  await admin.from("membership_plans").delete().like("name", `${PREFIX}%`);
});

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("sets up a membership, and sees members, monthly revenue and churn in reports", async ({ page }) => {
    await page.goto("/settings/memberships");
    await waitForHydration(page, "form[aria-label='New membership'] input");
    const form = ui(page).getByRole("form", { name: "New membership" });
    await form.getByLabel("Name").fill(`${PREFIX} Gloss Club`);
    await form.getByLabel("Price ($)").fill("49");
    await form.getByLabel("Included service 1", { exact: true }).selectOption({ label: "Gloss / Toner" });
    await form.getByLabel("How many of included service 1").fill("1");
    await form.getByLabel("Unused roll over").check();
    await form.getByLabel("Member discount on retail (%)").fill("10");
    await form.getByLabel("Minimum term (periods)").fill("2");
    await form.getByRole("button", { name: "Add membership" }).click();
    await expect(form.getByText(/^Saved\./)).toBeVisible();
    await page.reload();
    await expect(ui(page).getByRole("region", { name: `${PREFIX} Gloss Club` })).toContainText("$49 a month · 1 Gloss / Toner a month (unused roll over), 10% off retail · at least 2 × month · 0 members");
    // Renewals can be run now (the nightly job does it too).
    await ui(page).getByRole("button", { name: "Run renewals now" }).click();
    await expect(ui(page).getByRole("region", { name: "Renewals" }).getByRole("status")).toHaveText(/renewed|Nothing is due/);

    await page.goto("/reports");
    const report = ui(page).getByTestId("membership-report");
    const { count } = await admin.from("client_memberships").select("id", { count: "exact", head: true }).eq("business_id", B).neq("status", "canceled");
    await expect(report.getByTestId("members")).toHaveText(String(count));
    await expect(report.getByTestId("mrr")).toHaveText(/^\$[\d,]+$/);
    await expect(report.getByTestId("churn")).toHaveText(/^\d+(\.\d)?%$|^—$/);
    await expect(ui(page).getByRole("table", { name: "Members by membership" })).toContainText("Blowout Club");
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("sells a membership at checkout, then its benefits apply by themselves on the next visit", async ({ page }) => {
    // A sale with the client: the Blowout Club, renewing on a test card.
    let co = await openCheckout(page, { from: "/sales" });
    await co.ticket.getByLabel("Find a client").fill(`${PREFIX}Mia`);
    await co.ticket.getByRole("list", { name: "Matching clients" }).getByRole("button").first().click();
    await expect(co.ticket.getByTestId("checkout-client")).toHaveText(`${PREFIX}Mia Test`);
    await waitForHydration(page, "#product-search");
    await co.ticket.getByRole("button", { name: "Membership", exact: true }).click();
    await co.dialog.getByRole("radio", { name: /Blowout Club/ }).check();
    await expect(co.dialog).toContainText("Test mode: no real card is saved or charged.");
    await co.dialog.getByLabel("Card it renews on").selectOption({ label: "Visa …4242 (always works)" });
    await co.dialog.getByRole("button", { name: "Add to ticket" }).click();
    await expect(co.lines.filter({ hasText: "Blowout Club" })).toContainText("$89 a month · renews on Visa …4242");
    await expect(co.total).toHaveText("$89");
    await co.card();
    await co.complete();
    const { data: m } = await admin.from("client_memberships").select("id, status, current_period_end").eq("client_id", clientId).single();
    expect(m!.status).toBe("active");
    expect(m!.current_period_end).toBe(addInterval(today, "month", 1));

    // A blowout with Bridget: included; a product: member price.
    const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single();
    const start = fromLocal(DAY, 10 * 60, TZ)!;
    const end = new Date(start.getTime() + 45 * 60_000);
    const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "checked_in" }).select("id").single();
    await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: s!.id, staff_id: SEED.staff.bridget, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 45, price_cents: 6500 });

    // Booking details says so.
    await page.goto(`/calendar?date=${DAY}`);
    await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
    await waitForHydration(page, "section[data-staff-id]");
    await ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Mia Test`) }).click();
    await expect(page.getByRole("tabpanel", { name: "Booking details" }).getByTestId("membership-info")).toHaveText("Blowout Club member · Blowout: 2 left · 10% off retail");

    co = await openCheckout(page, { appointmentId: a!.id });
    await expect(co.ticket.getByTestId("badge-membership")).toHaveText("Blowout Club · Blowout: 2 left");
    await expect(co.lines.filter({ hasText: "Blowout" })).toContainText("included in Blowout Club");
    // A retail product in stock.
    const { data: stock } = await admin.from("stock_levels").select("on_hand, product:products!inner(sku, type, is_active)").eq("location_id", L).eq("product.type", "retail").eq("product.is_active", true).gt("on_hand", 5).limit(1).single();
    await co.addProduct(stock!.product.sku!);
    await expect(co.ticket.locator("[data-testid=ticket-line][data-kind=product]")).toContainText("member price, 10% off");
    await co.card();
    await co.complete();
    const { data: credit } = await admin.from("membership_credits").select("used").eq("membership_id", m!.id).single();
    expect(credit!.used).toBe(1);

    // The profile: what's left, pausing, and ending by the rules.
    await page.goto(`/clients/${clientId}`);
    const card = ui(page).getByTestId("client-membership");
    await expect(card).toContainText("1 of 2 used · 1 left");
    await expect(card.getByTestId("membership-when")).toContainText(/^Member since .* Renews .* on Visa …4242\.$/);
    await card.getByRole("button", { name: "Pause" }).click();
    await card.getByRole("form", { name: "Pause Blowout Club" }).getByRole("button", { name: "Pause" }).click();
    await expect(card.getByTestId("membership-when")).toContainText(/^Pauses /);
    await card.getByRole("button", { name: "Call off the pause" }).click();
    await expect(card.getByTestId("membership-when")).toContainText(/^Member since/);
    await card.getByRole("button", { name: "End membership" }).click();
    const ending = card.getByRole("form", { name: "End Blowout Club" });
    await expect(ending.getByTestId("membership-ends")).toContainText("It can end on");
    // Only managers can end it today.
    await expect(ending.getByLabel(/End it today instead/)).toHaveCount(0);
    await ending.getByLabel("Why").fill("Moving away");
    await ending.getByRole("button", { name: /^End on / }).click();
    await expect(card.getByTestId("membership-when")).toContainText(/^Ends .*, as asked; no more payments\.$/);
    await card.getByRole("button", { name: "Keep membership" }).click();
    await expect(card.getByTestId("membership-when")).toContainText(/^Member since/);
    await card.getByText("History").click();
    await expect(card.getByRole("list", { name: "Blowout Club history" })).toContainText("Joined ($89)");
  });

  test("sees failed membership payments on the Dashboard, and a new card pays it", async ({ page }) => {
    // A member whose card is declined at renewal.
    const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Noa`, last_name: "Test" }).select("id").single();
    extra.push(c!.id);
    const desk = await signIn("frontdesk@mapleandash.test");
    const { data: plan } = await admin.from("membership_plans").select("id, price_cents").eq("business_id", B).eq("name", "Blowout Club").single();
    const sold = await desk.rpc("complete_sale", {
      p_location_id: L,
      p_input: { client_id: c!.id, lines: [{ kind: "membership", plan_id: plan!.id, payment_method_ref: "test_visa_0002", card_label: "Visa …0002" }], payments: [{ method: "card", amount_cents: plan!.price_cents }] } as never,
    });
    expect(sold.error).toBeNull();
    const { data: m } = await admin.from("client_memberships").select("id").eq("client_id", c!.id).single();
    await admin.from("client_memberships").update({ anchor_on: addInterval(today, "month", -1), current_period_start: addInterval(today, "month", -1), current_period_end: today }).eq("id", m!.id);
    expect(await runMembershipBilling(admin, { membershipId: m!.id })).toMatchObject({ failed: 1 });

    await page.goto("/dashboard");
    const notice = ui(page).getByTestId("membership-notices").getByRole("listitem").filter({ hasText: `${PREFIX}Noa` });
    await expect(notice).toContainText("Blowout Club, $89 a month · 1 try");
    await notice.getByRole("link").click();
    const card = ui(page).locator("[data-testid=client-membership][data-status=past_due]");
    await expect(card.getByTestId("membership-when")).toContainText("didn't go through (1 try)");
    await card.getByRole("button", { name: "Update card" }).click();
    await card.getByRole("form", { name: /^Card for / }).getByLabel("New card").selectOption({ label: "Visa …4242 (always works)" });
    await card.getByRole("button", { name: "Save card" }).click();
    await expect(ui(page).getByRole("status")).toHaveText("Card updated to Visa …4242. The payment went through.");
    await expect.poll(async () => (await admin.from("client_memberships").select("status").eq("id", m!.id).single()).data!.status).toBe("active");
  });
});
