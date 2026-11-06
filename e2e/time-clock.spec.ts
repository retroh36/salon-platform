import { randomBytes, createHash } from "node:crypto";
import { formatDay } from "@/lib/schedule-format";
import { todayIn, toLocal } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const TZ = "America/Chicago";
const started = new Date().toISOString();

// The salon uses the time clock (the demo seed turns it on); each test
// clears the punches it makes.
test.beforeAll(async () => {
  await admin.from("businesses").update({ time_clock: true }).eq("id", B);
});

test.describe("a stylist on My day", () => {
  test.use({ storageState: AUTH.stylist });
  const clear = () => admin.from("time_clock_entries").delete().eq("staff_id", SEED.staff.bridget).gte("created_at", started);
  test.beforeEach(async () => {
    // No punch open from the demo's day.
    await admin.from("time_clock_entries").update({ clock_out: new Date().toISOString() }).eq("staff_id", SEED.staff.bridget).is("clock_out", null).eq("missed_out", false);
  });
  test.afterAll(clear);

  test("clocks in and out", async ({ page }) => {
    await page.goto("/my-day");
    const card = ui(page).getByTestId("time-clock");
    await waitForHydration(page, "[data-testid=time-clock] button");
    await expect(card.getByTestId("clock-status")).toHaveText("Not clocked in");
    await card.getByRole("button", { name: "Clock in" }).click();
    await expect(card.getByRole("status")).toHaveText(/^Clocked in at /);
    await expect(card.getByTestId("clock-status")).toHaveText(/^Clocked in since /);
    await card.getByRole("button", { name: "Clock out" }).click();
    await expect(card.getByRole("status")).toHaveText(/^Clocked out at /);
    const { data } = await admin.from("time_clock_entries").select("source, clock_out").eq("staff_id", SEED.staff.bridget).gte("created_at", started);
    expect(data).toEqual([{ source: "own", clock_out: expect.any(String) }]);
  });
});

test.describe("the shared front-desk iPad", () => {
  test("clocks someone in and out with their PIN, without signing them in", async ({ page, baseURL }) => {
    const token = randomBytes(32).toString("base64url");
    const { error } = await admin.from("shared_devices").insert({ business_id: B, location_id: SEED.location, name: "E2E clock iPad", token_hash: createHash("sha256").update(token).digest("hex") });
    if (error) throw error;
    await admin.from("time_clock_entries").update({ clock_out: new Date().toISOString() }).eq("staff_id", SEED.staff.bridget).is("clock_out", null).eq("missed_out", false);
    await page.context().addCookies([{ name: "maestra_device", value: token, url: baseURL! }]);
    try {
      await page.goto("/switch");
      await waitForHydration(page, "[data-testid=clock-mode]");
      for (const expected of [/^Bridget, you're clocked in at /, /^Bridget, you're clocked out at /]) {
        if (!(await page.getByText("Tap your name to clock in or out.").isVisible())) await page.getByTestId("clock-mode").click();
        await page.getByRole("button", { name: "Bridget C." }).click();
        for (const d of "5937") await page.getByRole("button", { name: d, exact: true }).click();
        await page.getByRole("button", { name: "Clock in or out" }).click();
        await expect(page.getByTestId("clock-done")).toHaveText(expected);
      }
      // Still the PIN screen: nobody was signed in.
      await expect(page).toHaveURL("/switch");
      const { data } = await admin.from("time_clock_entries").select("source, clock_out").eq("staff_id", SEED.staff.bridget).gte("created_at", started).eq("source", "front_desk");
      expect(data).toEqual([{ source: "front_desk", clock_out: expect.any(String) }]);
    } finally {
      await admin.from("shared_devices").delete().eq("name", "E2E clock iPad");
      await admin.from("time_clock_entries").delete().eq("staff_id", SEED.staff.bridget).gte("created_at", started);
    }
  });
});

test.describe("a manager", () => {
  test.use({ storageState: AUTH.manager });

  test("sees scheduled against clocked on someone's month and fixes a missed clock-out, logged", async ({ page }) => {
    // Jordan's last clock-out was missed in the demo seed.
    const { data: missed } = await admin.from("time_clock_entries").select("id, clock_in").eq("staff_id", SEED.staff.jordan).eq("missed_out", true).single();
    const day = toLocal(new Date(missed!.clock_in), TZ).date;
    try {
      await page.goto(`/scheduling/month?month=${day.slice(0, 7)}&staff=${SEED.staff.jordan}`);
      const month = ui(page).getByTestId("person-month");
      await expect(ui(page).getByTestId("person-month-totals")).toContainText("Clocked so far");
      await waitForHydration(page, "[data-testid=person-month] button[data-cell]");
      const cell = month.locator(`[data-date="${day}"]`);
      await expect(cell.getByTestId("clock-line")).toHaveText("No clock-out");

      await cell.click();
      const sheet = ui(page).getByRole("dialog", { name: `Jordan · ${formatDay(day)}` });
      await sheet.getByLabel("Reason for the change").fill("Forgot to clock out");
      await sheet.getByLabel("Punch 1 out").fill("17:00");
      await sheet.getByRole("button", { name: "Save change" }).click();
      await expect(ui(page).getByTestId("team-month")).toContainText("Hours changed.");
      await expect(cell.getByTestId("clock-line")).toHaveText(/^Clocked /);

      await page.goto(`/audit?type=clock&from=${todayIn(TZ)}&to=${todayIn(TZ)}`);
      await expect(ui(page).getByTestId("audit-table")).toContainText(/Hours changed for Jordan Pike on .*Forgot to clock out/);
    } finally {
      await admin.from("time_clock_entries").update({ clock_out: null, missed_out: true, edited: false, clock_in: missed!.clock_in }).eq("id", missed!.id);
      await admin.from("time_clock_events").delete().eq("staff_id", SEED.staff.jordan).gte("created_at", started);
    }
  });
});

test.describe("an owner", () => {
  test.use({ storageState: AUTH.owner });

  test("turns the time clock off and on", async ({ page }) => {
    await page.goto("/settings/devices");
    await waitForHydration(page, "input[type=checkbox]");
    const box = ui(page).getByRole("checkbox", { name: /The team clocks in and out/ });
    await expect(box).toBeChecked();
    try {
      await box.uncheck();
      await expect(ui(page).getByText("The time clock is off.")).toBeVisible();
      expect((await admin.from("businesses").select("time_clock").eq("id", B).single()).data!.time_clock).toBe(false);
      // My day has no clock while it's off.
      await page.goto("/my-day");
      await expect(ui(page).getByTestId("time-clock")).toHaveCount(0);
    } finally {
      await admin.from("businesses").update({ time_clock: true }).eq("id", B);
    }
  });
});
