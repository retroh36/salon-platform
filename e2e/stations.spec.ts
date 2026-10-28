import { addDays, startOfWeek, todayIn, weekdayOf } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const L = SEED.location;
const CHAIR4 = "f0000000-0000-4000-8000-000000000004";
const started = new Date().toISOString();
const today = todayIn("America/Chicago");
// A Saturday two weeks or more out: Sandra (Chair 4) is off, Gil works.
let saturday = addDays(today, 14);
while (weekdayOf(saturday) !== 6) saturday = addDays(saturday, 1);
const PREFIX = "E2E stations ";

async function putBack() {
  await admin.from("station_assignments").delete().eq("location_id", L).gte("created_at", started);
  const { data } = await admin.from("resources").select("id").eq("location_id", L).like("name", `${PREFIX}%`);
  if (data?.length) {
    await admin.from("staff").update({ home_resource_id: null }).in("home_resource_id", data.map((r) => r.id));
    await admin.from("resources").delete().in("id", data.map((r) => r.id));
  }
}

test.describe("owners and managers", () => {
  test.use({ storageState: AUTH.owner });
  test.beforeAll(putBack);
  test.afterAll(putBack);

  test("add a shampoo bowl and see the home chairs", async ({ page }) => {
    await page.goto("/settings/stations");
    await waitForHydration(page, "main button");
    const chairs = ui(page).getByRole("table", { name: "Chairs" });
    await expect(chairs.getByRole("row").filter({ hasText: "Chair 4" })).toContainText("Sandra Whitfield");
    await expect(chairs.getByRole("row").filter({ hasText: "Chair 6" })).toContainText("Nobody");

    await ui(page).getByRole("button", { name: "Add station" }).click();
    const sheet = ui(page).getByRole("dialog", { name: "Add station" });
    await sheet.getByLabel("Name").fill(`${PREFIX}Bowl 1`);
    await sheet.getByLabel("Type").selectOption("shampoo");
    await sheet.getByLabel("Where it is (optional)").fill("Back room");
    await expect(sheet.getByLabel("Home of")).toHaveCount(0);
    await sheet.getByRole("button", { name: "Add station" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(ui(page).getByRole("table", { name: "Shampoo bowls" })).toContainText(`${PREFIX}Bowl 1`);
    await expect(ui(page).getByRole("table", { name: "Shampoo bowls" })).toContainText("Back room");
  });

  test("lend Sandra's chair on her day off, see it on the schedule and calendar, then give it back", async ({ page }) => {
    await page.goto(`/scheduling/floor?date=${saturday}`);
    await waitForHydration(page, "[data-testid=floor] a");
    const chair = ui(page).locator('[data-station="Chair 4"]');
    await expect(chair).toContainText("Its stylist is off today.");
    // Gil's chair is his while he works: it can't be lent.
    await expect(ui(page).locator('[data-station="Chair 2"]').getByRole("button", { name: /Lend/ })).toHaveCount(0);

    await chair.getByRole("button", { name: "Lend Chair 4…" }).click();
    const sheet = ui(page).getByRole("dialog", { name: "Lend Chair 4" });
    await sheet.getByLabel(/Who.s using it/).selectOption({ label: "Gil Navarro" });
    await sheet.getByRole("button", { name: "Lend it" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(chair.getByTestId("station-uses")).toContainText("Gil is using it");
    const { data } = await admin.from("station_assignments").select("staff_id").eq("resource_id", CHAIR4).eq("on_date", saturday);
    expect(data).toEqual([{ staff_id: SEED.staff.gil }]);

    await page.goto(`/scheduling?week=${startOfWeek(saturday)}`);
    await expect(ui(page).getByTestId("team-schedule").locator(`[data-staff="${SEED.staff.gil}"][data-date="${saturday}"]`).getByTestId("lent-chair")).toHaveText("Chair 4");
    await expect(ui(page).getByTestId("team-schedule").locator(`[data-person="${SEED.staff.sandra}"]`).getByTestId("home-chair")).toContainText("Chair 4");

    await page.goto(`/calendar?date=${saturday}`);
    await waitForHydration(page, "section[data-staff-id]");
    await expect(ui(page).locator("[data-column-header]").filter({ hasText: "Gil" }).getByTestId("column-chair")).toHaveText(" · Chair 4");

    await page.goto(`/scheduling/floor?date=${saturday}`);
    await waitForHydration(page, "[data-testid=floor] a");
    await ui(page).getByRole("button", { name: "Give Chair 4 back from Gil" }).click();
    await expect(chair).toContainText("Its stylist is off today.");
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("sees the floor, read-only, with clients in rooms", async ({ page }) => {
    await page.goto(`/scheduling/floor?date=${today}`);
    await expect(ui(page).getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(ui(page).getByRole("heading", { name: "Rooms" })).toBeVisible();
    await expect(ui(page).getByRole("button", { name: /^Lend/ })).toHaveCount(0);
  });
});
