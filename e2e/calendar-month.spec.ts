// The calendar's month: from the day's View switch, each day's visits as the
// database has them, the closed days, and a day opening it on the calendar.
import { admin, busyDay, SEED } from "../tests/db/helpers";
import { addDays, fromLocal } from "../lib/scheduling/time";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const TZ = "America/Chicago";

test.use({ storageState: AUTH.frontDesk });

test("shows the month's days and opens one", async ({ page }) => {
  const { date } = await busyDay();
  const { count } = await admin
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("location_id", SEED.location)
    .not("status", "in", "(canceled,no_show)")
    .gte("starts_at", fromLocal(date, 0, TZ)!.toISOString())
    .lt("starts_at", fromLocal(addDays(date, 1), 0, TZ)!.toISOString());

  await page.goto(`/calendar?date=${date}`);
  await waitForHydration(page, "[role=radiogroup][aria-label=View]");
  await ui(page).getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "Month" }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar/month\\?month=${date.slice(0, 7)}$`));

  const day = ui(page).getByTestId("month-grid").locator(`a[data-date="${date}"]`);
  await expect(day.getByTestId("month-visits")).toHaveText(`${count} ${count === 1 ? "visit" : "visits"}`);
  // Maple & Ash is closed on Sundays.
  const sunday = await ui(page).getByTestId("month-grid").locator("a[data-date]").evaluateAll((links) =>
    links.map((l) => l.getAttribute("data-date")!).find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0),
  );
  await expect(ui(page).getByTestId("month-grid").locator(`a[data-date="${sunday}"]`)).toContainText("Closed");

  await day.click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?date=${date}$`));
});
