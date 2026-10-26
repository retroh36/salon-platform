// Phone booking on the calendar: the panel (P or the button), the client's
// alerts, the three best times from the booking rules, one-tap booking,
// Adjust, and what's offered when nothing fits. The test server has no
// Claude key, so the panel asks for the fields (Denise's reading is tested
// with Claude mocked in tests/unit/phone-booking.test.ts).
import type { Page } from "@playwright/test";
import { addDays, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const TZ = "America/Chicago";
// A Tuesday past the seeded nine days ahead, so Bridget's afternoon is
// clear (she works 2–6), and the Sunday that week (the salon is closed).
const MONDAY = startOfWeek(todayIn(TZ));
const DAY = addDays(MONDAY, 36);
const SUNDAY = addDays(MONDAY, 41);
const PREFIX = `Ph${Date.now().toString(36)}`;

let clientId: string;
const serviceId = async (name: string) => (await admin.from("services").select("id").eq("business_id", B).eq("name", name).single()).data!.id;

test.beforeAll(async () => {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Pat`, last_name: "Test", phone: "(312) 555-0198" }).select("id").single();
  clientId = data!.id;
});

test.afterAll(async () => {
  await admin.from("waitlist_entries").delete().eq("client_id", clientId);
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
});

test.use({ storageState: AUTH.frontDesk });

async function openPanel(page: Page) {
  await page.goto(`/calendar?date=${DAY}`);
  await waitForHydration(page, "section[data-staff-id]");
  await page.locator("body").press("p");
  const panel = page.getByTestId("phone-panel");
  await expect(panel).toBeVisible();
  return panel;
}

async function chooseClient(panel: ReturnType<Page["getByTestId"]>, name: string) {
  await panel.getByLabel("Find a client").fill(name);
  await panel.getByRole("list", { name: "Matching clients" }).getByRole("button", { name: new RegExp(name) }).first().click();
}

test("P opens Phone booking; the three best times book in one tap", async ({ page }) => {
  const panel = await openPanel(page);
  // No Claude key on the test server: the fields straight away.
  await expect(panel.getByTestId("phone-note")).toContainText("Fill in what the client wants");
  await chooseClient(panel, `${PREFIX}Pat`);
  await expect(panel.getByTestId("phone-alerts")).toContainText("No card on file");

  await panel.getByLabel("Service").selectOption(await serviceId("Women's Cut & Style"));
  await panel.getByLabel("Stylist").selectOption(SEED.staff.bridget);
  await panel.getByLabel("From").fill(DAY);
  await panel.getByLabel("To", { exact: true }).fill(DAY);
  await panel.getByRole("radio", { name: "Afternoon" }).click();
  await panel.getByRole("button", { name: "Show times" }).click();

  const options = panel.getByTestId("phone-option");
  await expect(options).toHaveCount(3);
  // Each a different time, with a reason, Bridget's afternoon only.
  const whens = await options.locator("p").first().allTextContents();
  expect(new Set(whens).size).toBe(whens.length);
  for (const o of await options.all()) {
    await expect(o).toContainText("with Bridget");
    await expect(o.locator("p").nth(2)).not.toBeEmpty();
  }
  const first = (await options.first().locator("p").first().textContent())!;
  expect(first).toMatch(/· (noon|(1|2|3|4|5)(:\d\d)?pm)–/);

  await options.first().getByRole("button", { name: "Book" }).click();
  // The visit opens, as after any booking.
  await expect(page.getByRole("tabpanel", { name: "Booking details" })).toContainText(`${PREFIX}Pat Test`);
  await expect(ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Pat`) })).toBeVisible();

  const { data: visits } = await admin.from("appointments").select("id, appointment_items(staff_id)").eq("client_id", clientId).eq("status", "booked");
  expect(visits).toHaveLength(1);
  expect(visits![0].appointment_items[0].staff_id).toBe(SEED.staff.bridget);
});

test("shows the client's alerts, and fills in the same as last time", async ({ page }) => {
  const panel = await openPanel(page);
  await chooseClient(panel, "Maria Lopez");
  const alerts = panel.getByTestId("phone-alerts");
  await expect(alerts).toContainText("Card on file");
  await expect(panel.getByText("Latex allergy")).toBeVisible();
  await expect(alerts).toContainText("Last visit:");
  await alerts.getByRole("button", { name: "Same as last time" }).click();
  await expect(panel.getByLabel("Service")).not.toHaveValue("");
  await expect(panel.getByLabel("Stylist")).not.toHaveValue("anyone");
});

test("Adjust opens the booking form filled in", async ({ page }) => {
  const panel = await openPanel(page);
  await chooseClient(panel, `${PREFIX}Pat`);
  await panel.getByLabel("Service").selectOption(await serviceId("Blowout"));
  await panel.getByLabel("Stylist").selectOption(SEED.staff.shae);
  await panel.getByLabel("From").fill(DAY);
  await panel.getByLabel("To", { exact: true }).fill(DAY);
  await panel.getByRole("button", { name: "Show times" }).click();
  await panel.getByTestId("phone-option").first().getByRole("button", { name: "Adjust" }).click();

  const form = page.getByRole("form", { name: "New booking" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Date")).toHaveValue(DAY);
  await expect(form.getByText(`${PREFIX}Pat Test`)).toBeVisible();
});

test("when nothing fits, offers another day and the waitlist", async ({ page }) => {
  const panel = await openPanel(page);
  await chooseClient(panel, `${PREFIX}Pat`);
  await panel.getByLabel("Service").selectOption(await serviceId("Women's Cut & Style"));
  await panel.getByLabel("Stylist").selectOption(SEED.staff.bridget);
  await panel.getByLabel("From").fill(SUNDAY);
  await panel.getByLabel("To", { exact: true }).fill(SUNDAY);
  await panel.getByRole("button", { name: "Show times" }).click();

  await expect(panel.getByTestId("phone-nothing")).toContainText("Nothing fits");
  await expect(panel.getByRole("heading", { name: "Another day" })).toBeVisible();
  await expect(panel.getByTestId("phone-option").first()).toContainText("with Bridget");
  await panel.getByRole("button", { name: "Add to waitlist" }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByText(`${PREFIX}Pat is on the waitlist.`)).toBeVisible();
  const { data: waiting } = await admin.from("waitlist_entries").select("staff_ids, from_date").eq("client_id", clientId);
  expect(waiting).toEqual([{ staff_ids: [SEED.staff.bridget], from_date: SUNDAY }]);
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("don't take phone bookings", async ({ page }) => {
    await page.goto(`/calendar?date=${DAY}`);
    await waitForHydration(page, "section[data-staff-id]");
    await expect(page.getByRole("button", { name: "Phone booking" })).toHaveCount(0);
    await page.locator("body").press("p");
    await expect(page.getByTestId("phone-panel")).toHaveCount(0);
  });
});
