import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, setAsideDay, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET } = SEED.staff;
// A Tuesday well past the demo's visits: Bridget works 9-1.
const DAY = addDays(startOfWeek(todayIn(TZ)), 106);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const PREFIX = `Stp${Date.now().toString(36)}`;
const STEPS = [
  { name: "Highlight", minutes: 60, processing: false },
  { name: "Processing", minutes: 30, processing: true },
  { name: "Gloss", minutes: 15, processing: false },
  { name: "Processing", minutes: 20, processing: true },
  { name: "Cut", minutes: 45, processing: false },
];

let putBackDay = async () => {};
let serviceId: string;
let clientId: string;
let itemId: string;

test.beforeAll(async () => {
  putBackDay = await setAsideDay([BRIDGET], DAY, TZ);
  const { data: s } = await admin.from("services").insert({ business_id: B, name: `${PREFIX} Color and cut`, category: "Color", active_minutes: 5, price_cents: 20000, steps: STEPS }).select("id").single();
  serviceId = s!.id;
  await admin.from("staff_services").insert({ business_id: B, staff_id: BRIDGET, service_id: serviceId });
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Ava`, last_name: "Test" }).select("id").single();
  clientId = c!.id;
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: at(9).toISOString(), ends_at: at(11, 50).toISOString() }).select("id").single();
  const { data: i } = await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: serviceId, staff_id: BRIDGET, starts_at: at(9).toISOString(), ends_at: at(11, 50).toISOString(), active_minutes: 60, processing_minutes: 50, finishing_minutes: 60, price_cents: 20000 })
    .select("id")
    .single();
  itemId = i!.id;
});

test.afterAll(async () => {
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("staff_services").delete().eq("service_id", serviceId);
  await admin.from("services").delete().eq("id", serviceId);
  await putBackDay();
});

const panel = (page: Page) => page.getByRole("complementary", { name: "Booking details" });

test.use({ viewport: { width: 1920, height: 1500 }, storageState: AUTH.frontDesk });

test("a visit's steps show on the block and in booking details, and change for that visit", async ({ page }) => {
  await page.goto(`/calendar?date=${DAY}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
  await waitForHydration(page, "section[data-staff-id]");
  // Both processing steps are free time on the block.
  const block = ui(page).getByRole("region", { name: "Bridget Callahan" }).getByRole("button", { name: new RegExp(`^9am–11:50am, ${PREFIX}Ava Test`) });
  await expect(block).toHaveAccessibleName(/processing 10am–10:30am and 10:45am–11:05am/);
  await block.click();

  const steps = panel(page).getByTestId("item-steps");
  await expect(steps).toHaveText("Highlight 9am–10am · Processing 10am–10:30am · Gloss 10:30am–10:45am · Processing 10:45am–11:05am · Cut 11:05am–11:50am");
  await panel(page).getByRole("button", { name: "Edit steps" }).click();
  const editor = panel(page).getByRole("form", { name: "Edit steps" });
  await editor.getByLabel("Step 2 minutes").fill("45");
  await editor.getByRole("button", { name: "Save steps" }).click();
  await expect(steps).toHaveText("Highlight 9am–10am · Processing 10am–10:45am · Gloss 10:45am–11am · Processing 11am–11:20am · Cut 11:20am–12:05pm");
  await expect(panel(page).getByTestId("visit-when")).toContainText("9am–12:05pm");

  const { data } = await admin.from("appointment_items").select("steps, processing_minutes, ends_at").eq("id", itemId).single();
  expect((data!.steps as unknown[])[1]).toEqual({ name: "Processing", minutes: 45, processing: true });
  expect(data!.processing_minutes).toBe(65);
  expect(new Date(data!.ends_at).getTime()).toBe(at(12, 5).getTime());
});
