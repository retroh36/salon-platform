import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// A stylist's own service times on Team: copied from another stylist,
// adjusted, saved, and one put back to the menu's. Its own two stylists.

const B = SEED.business;
const PREFIX = `St${Date.now().toString(36).replace(/\d/g, (d) => "abcdefghij"[Number(d)])}`;
let source: string;
let target: string;
let cut: string;
let color: string;

test.use({ storageState: AUTH.manager });

test.beforeAll(async () => {
  const { data: staff } = await admin
    .from("staff")
    .insert([
      { business_id: B, location_id: SEED.location, first_name: `${PREFIX}Ada`, last_name: "Source", role: "stylist" },
      { business_id: B, location_id: SEED.location, first_name: `${PREFIX}Bo`, last_name: "Target", role: "stylist" },
    ])
    .select("id");
  [source, target] = staff!.map((s) => s.id);
  const { data: services } = await admin.from("services").select("id, name").eq("business_id", B).in("name", ["Women's Cut & Style", "All-Over Color"]);
  cut = services!.find((s) => s.name === "Women's Cut & Style")!.id;
  color = services!.find((s) => s.name === "All-Over Color")!.id;
  await admin.from("staff_services").insert([
    { business_id: B, staff_id: source, service_id: cut, active_minutes: 50, processing_minutes: 0, finishing_minutes: 0 },
    { business_id: B, staff_id: target, service_id: cut },
    { business_id: B, staff_id: target, service_id: color, active_minutes: 60, processing_minutes: 30, finishing_minutes: 10 },
  ]);
});

test.afterAll(async () => {
  await admin.from("staff_services").delete().in("staff_id", [source, target]);
  await admin.from("staff").delete().in("id", [source, target]);
});

test("copies another stylist's times, adjusts one and saves", async ({ page }) => {
  await page.goto(`/team/${target}`);
  await ui(page).getByRole("link", { name: "Service times" }).click();
  await waitForHydration(page, "[data-testid=service-times] input");
  await expect(ui(page).getByRole("heading", { name: `${PREFIX}Bo's service times` })).toBeVisible();
  const table = ui(page).getByTestId("service-times");
  const row = (name: string) => table.locator(`tr[data-service="${name}"]`);
  await expect(row("All-Over Color")).toContainText("Their own");

  await ui(page).getByLabel("Copy from").selectOption({ label: `${PREFIX}Ada Source` });
  await ui(page).getByRole("button", { name: "Copy their times" }).click();
  await expect(ui(page).getByText(`Copied 1 time from ${PREFIX}Ada Source (1 service they don't do stayed as it was). Check them, then Save.`)).toBeVisible();
  await expect(row("Women's Cut & Style").getByLabel("Women's Cut & Style active minutes")).toHaveValue("50");
  // Only Bo does color: it stays as it was, then goes back to the menu's.
  await expect(row("All-Over Color").getByLabel("All-Over Color active minutes")).toHaveValue("60");
  await row("All-Over Color").getByRole("button", { name: "Use menu time" }).click();
  await expect(row("All-Over Color")).toContainText("Menu time");

  // A time that breaks the rules can't be saved.
  await row("Women's Cut & Style").getByLabel("Women's Cut & Style active minutes").fill("52");
  await expect(row("Women's Cut & Style")).toContainText("Use steps of 5 minutes.");
  await expect(ui(page).getByRole("button", { name: "Save" })).toBeDisabled();
  await row("Women's Cut & Style").getByLabel("Women's Cut & Style active minutes").fill("55");
  await ui(page).getByRole("button", { name: "Save" }).click();
  await expect(ui(page).getByText("Saved 2 times. New bookings use them; visits already booked keep theirs.")).toBeVisible();
  await expect(ui(page).getByText("Everything is saved.")).toBeVisible();

  const { data } = await admin.from("staff_services").select("service_id, active_minutes, processing_minutes, finishing_minutes").eq("staff_id", target);
  expect(Object.fromEntries(data!.map((r) => [r.service_id, r.active_minutes === null ? null : [r.active_minutes, r.processing_minutes, r.finishing_minutes]]))).toEqual({ [cut]: [55, 0, 0], [color]: null });
});
