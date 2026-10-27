import { todayIn } from "@/lib/scheduling/time";
import { admin, makeRoom, SEED } from "../tests/db/helpers";
import { AUTH, checkIn, expect, putBackSales, test, ui, waitForHydration } from "./fixtures";

// Stock and sales this file uses are put back afterwards.
putBackSales();

const B = SEED.business;
const L = SEED.location;
const PREFIX = `At${Date.now().toString(36)}`;
let appointmentId: string;
let putBack: () => Promise<void> = async () => {};

// A visit with Bridget that started a few minutes ago: a color with a
// processing gap.
test.beforeAll(async () => {
  const { data: client } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Tap`, last_name: "Client" }).select("id").single();
  const { data: service } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Root Touch-Up").single();
  const start = new Date(Math.floor(Date.now() / 300_000) * 300_000 - 5 * 60_000);
  const end = new Date(start.getTime() + 85 * 60_000);
  // The demo calendar may have Bridget busy now; the database refuses a double-booking.
  putBack = await makeRoom(SEED.staff.bridget, start, end);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: client!.id, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "confirmed" }).select("id").single();
  appointmentId = a!.id;
  const { error } = await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: appointmentId, service_id: service!.id, staff_id: SEED.staff.bridget, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 30, processing_minutes: 35, finishing_minutes: 20, price_cents: 9500 });
  if (error) throw error;
});

test.afterAll(async () => {
  await admin.from("appointments").delete().eq("id", appointmentId);
  await putBack();
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

test.describe("a stylist on their phone", () => {
  test.use({ storageState: AUTH.stylist, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("taps Start service, Processing, Back in chair and Finish service on My day", async ({ page }) => {
    await page.goto("/my-day");
    const card = ui(page).getByRole("listitem").filter({ hasText: `${PREFIX}Tap C.` });
    await waitForHydration(page, "[data-testid=service-timer] button");
    const timer = card.getByTestId("service-timer");
    await expect(timer).toHaveAttribute("data-state", "waiting");
    // Optional, and said so.
    await expect(ui(page).getByTestId("taps-optional")).toContainText("Tapping your times is optional");

    for (const [tap, state] of [["Start service", "in_chair"], ["Processing", "processing"], ["Back in chair", "finishing"], ["Finish service", "done"]] as const) {
      const button = timer.getByRole("button", { name: tap });
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await button.click();
      await expect(timer).toHaveAttribute("data-state", state);
    }
    await expect(timer).toContainText(/Finished at \d/);
    // Starting checked the client in.
    await expect(card).toContainText("Checked in");

    await timer.getByRole("button", { name: "Undo last tap" }).click();
    await expect(timer).toHaveAttribute("data-state", "finishing");
    const { data } = await admin.from("appointment_items").select("started_at, processing_started_at, processing_ended_at, finished_at").eq("appointment_id", appointmentId).single();
    expect(data).toMatchObject({ started_at: expect.any(String), processing_started_at: expect.any(String), processing_ended_at: expect.any(String), finished_at: null });
  });
});

test.describe("the front desk", () => {
  test.use({ storageState: AUTH.frontDesk, viewport: { width: 1440, height: 1000 } });

  test("only checks in and out in booking details: the timing taps are the stylist's, on My day", async ({ page }) => {
    await page.goto(`/calendar?date=${todayIn("America/Chicago")}`);
    await waitForHydration(page, "section[data-staff-id]");
    await ui(page).getByRole("region", { name: "Bridget Callahan", exact: true }).getByRole("button", { name: new RegExp(`${PREFIX}Tap`) }).click({ position: { x: 10, y: 5 } });
    const details = page.getByRole("tabpanel", { name: "Booking details" });
    // Check in, then Check out: nothing in between.
    if ((await details.getByTestId("primary-action").textContent()) === "Check in") await checkIn(details);
    await expect(details.getByTestId("primary-action")).toHaveText("Check out");
    const taps = /^(Start service|Processing|Back in chair|Finish service|Undo last tap)/;
    await expect(details.getByRole("button", { name: taps })).toHaveCount(0);
    await details.getByRole("button", { name: "More actions" }).click();
    const menu = details.getByRole("menu", { name: "More actions" });
    await expect(menu.getByRole("menuitem").first()).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: taps })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Check out early" })).toHaveCount(0);
    // What the stylist tapped on My day still shows, as words.
    await expect(details.getByTestId("visit-status")).toHaveText(/^(Checked in at|In service since|Processing since|Back in the chair since|Finished at) \d/);
  });
});
