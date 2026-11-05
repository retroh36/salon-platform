import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// The audit trail: a visit's cancel, written by the database, shows with who
// did it, for an owner; the front desk can't open it.

let visitId: string;

test.beforeAll(async () => {
  // A visit of its own, booked far ahead with a throwaway time, then
  // canceled by the front desk's own login (so the log says who).
  const { data: client } = await admin.from("clients").insert({ business_id: SEED.business, first_name: "Audit", last_name: `Trail${Date.now().toString(36)}` }).select("id, last_name").single();
  const { data: service } = await admin.from("services").select("id").eq("business_id", SEED.business).eq("name", "Blowout").single();
  const start = new Date(Date.now() + 400 * 86_400_000);
  start.setUTCHours(16, 0, 0, 0);
  const { data: a } = await admin.from("appointments").insert({ business_id: SEED.business, location_id: SEED.location, client_id: client!.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 45 * 60_000).toISOString(), created_by: SEED.staff.frontDesk }).select("id").single();
  visitId = a!.id;
  await admin.from("appointment_items").insert({ business_id: SEED.business, location_id: SEED.location, appointment_id: visitId, service_id: service!.id, staff_id: SEED.staff.bridget, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 45 * 60_000).toISOString(), active_minutes: 45, price_cents: 4500 });
  await admin.from("appointments").update({ status: "canceled", canceled_at: new Date().toISOString(), cancel_reason: "client" }).eq("id", visitId);
});

test.afterAll(async () => {
  const { data } = await admin.from("appointments").select("client_id").eq("id", visitId).single();
  await admin.from("appointments").delete().eq("id", visitId);
  if (data?.client_id) await admin.from("clients").delete().eq("id", data.client_id);
});

test("an owner sees visit changes with who made them, and filters by type", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.owner });
  await page.goto("/audit?type=visits");
  await waitForHydration(page, "[data-testid=audit-table]");
  const row = ui(page).getByTestId("audit-table").getByRole("row").filter({ hasText: "Canceled (client)" }).filter({ hasText: "Audit Trail" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Maestra");
  await expect(ui(page).getByTestId("audit-table").locator("tbody tr:not([data-type=visits])")).toHaveCount(0);
  await expect(page.locator("aside").first().getByRole("link", { name: "Audit trail" })).toBeVisible();
  await page.close();
});

test("the front desk can't open it", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.frontDesk });
  await page.goto("/audit");
  await expect(page).not.toHaveURL(/\/audit/);
  await expect(page.locator("aside").first().getByRole("link", { name: "Audit trail" })).toHaveCount(0);
  await page.close();
});

test("an alert shows on the owner's Dashboard until Got it", async ({ browser }) => {
  const body = `Sam Rivera voided sale #9${Date.now().toString().slice(-5)} ($85): Rang up twice.`;
  // Got it marks every unread notice read: the owner's others are put back.
  const { data: unread } = await admin.from("notifications").select("id").eq("staff_id", SEED.staff.owner).eq("channel", "app").is("read_at", null);
  await admin.from("notifications").insert({ business_id: SEED.business, location_id: SEED.location, staff_id: SEED.staff.owner, channel: "app", status: "sent", template: "alert_sale_voided", body });
  const page = await browser.newPage({ storageState: AUTH.owner });
  try {
    await page.goto("/dashboard");
    const card = ui(page).getByTestId("for-you");
    await expect(card).toContainText(body);
    await card.getByRole("button", { name: "Got it" }).click();
    await expect(card).toHaveCount(0);
    const { data } = await admin.from("notifications").select("read_at").eq("body", body).single();
    expect(data?.read_at).not.toBeNull();
  } finally {
    await admin.from("notifications").delete().eq("body", body);
    if (unread?.length) await admin.from("notifications").update({ read_at: null }).in("id", unread.map((n) => n.id));
    await page.close();
  }
});
