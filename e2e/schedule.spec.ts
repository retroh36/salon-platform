import type { Page } from "@playwright/test";
import type { Json } from "@/lib/database.types";
import { formatDay } from "@/lib/schedule-format";
import { addDays, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const today = todayIn("America/Chicago");
const thisMonday = startOfWeek(today);
const nextMonday = addDays(thisMonday, 7);

function day(page: Page, date: string) {
  return ui(page).getByRole("list", { name: "Week" }).getByRole("listitem", { name: formatDay(date) });
}

// Each helper waits for its navigation to finish, so the next click uses the
// new page's links.
async function pickStaff(page: Page, firstName: string) {
  await ui(page).getByRole("navigation", { name: "Team" }).getByRole("link", { name: firstName }).click();
  await expect(ui(page).getByRole("heading", { level: 2, name: new RegExp(`^${firstName} `) })).toBeVisible();
}

async function nextWeek(page: Page, monday: string) {
  await ui(page).getByRole("link", { name: "Next →" }).click();
  await expect(ui(page).getByRole("heading", { name: `Week of ${formatDay(monday, true)}` })).toBeVisible();
}

async function openSchedule(page: Page, staffName?: string) {
  await page.goto("/schedule");
  if (staffName) await pickStaff(page, staffName);
}

async function savedWeek(staffId: string) {
  const { data } = await admin.from("staff_working_hours").select("weekday, start_minute, end_minute").eq("staff_id", staffId);
  return data!;
}

test.describe("managers", () => {
  test.use({ storageState: AUTH.owner });

  test("see a stylist's week with split shifts, one-off changes and time off", async ({ page }) => {
    await openSchedule(page, "Bridget");
    // Bridget works split shifts on Tuesdays.
    await expect(day(page, addDays(thisMonday, 1))).toContainText("9am–1pm, 2pm–6pm");
    await expect(day(page, thisMonday)).toContainText("Off");
    await expect(day(page, thisMonday)).toContainText("Salon closed");

    // Nola covers a late Friday next week.
    await pickStaff(page, "Nola");
    await nextWeek(page, nextMonday);
    await expect(day(page, addDays(nextMonday, 4))).toContainText("noon–8pm");
    await expect(day(page, addDays(nextMonday, 4))).toContainText("Changed hours");

    // Sandra is on vacation the week after.
    await pickStaff(page, "Sandra");
    await nextWeek(page, nextMonday);
    await nextWeek(page, addDays(nextMonday, 7));
    const tuesday = day(page, addDays(nextMonday, 8));
    await expect(tuesday).toContainText("Vacation");
    await expect(tuesday).toContainText("Approved");
    await expect(tuesday).toContainText("Bookable: none");
  });

  test("edit weekly hours, with a split shift and a validation error", async ({ page }) => {
    const before = await savedWeek(SEED.staff.hannah);
    try {
      await openSchedule(page, "Hannah");
      await waitForHydration(page, "form[aria-label='Weekly hours'] button");
      const form = ui(page).getByRole("form", { name: "Weekly hours" });

      // Wednesday is off; add 9-1, then an overlapping split.
      await form.getByRole("button", { name: "Add hours on Wednesday" }).click();
      await form.getByLabel("Wednesday shift 1 start").fill("09:00");
      await form.getByLabel("Wednesday shift 1 end").fill("13:00");
      await form.getByRole("button", { name: "Add a split shift on Wednesday" }).click();
      await form.getByLabel("Wednesday shift 2 start").fill("12:00");
      await form.getByLabel("Wednesday shift 2 end").fill("17:00");
      await form.getByRole("button", { name: "Save hours" }).click();

      await expect(form.getByRole("alert")).toHaveText("Fix the highlighted days.");
      await expect(form.getByRole("listitem", { name: "Wednesday" })).toContainText("Shifts can't overlap.");
      await expect(form.getByLabel("Wednesday shift 2 start")).toHaveValue("12:00");

      await form.getByLabel("Wednesday shift 2 start").fill("14:00");
      await form.getByRole("button", { name: "Save hours" }).click();
      await expect(form.getByRole("status")).toHaveText("Saved.");
      await expect(day(page, addDays(thisMonday, 2))).toContainText("9am–1pm, 2pm–5pm");
    } finally {
      await admin.rpc("set_staff_weekly_hours", { p_business_id: B, p_staff_id: SEED.staff.hannah, p_hours: before as Json });
    }
  });

  test("add and remove a one-off change", async ({ page }) => {
    const date = addDays(nextMonday, 2); // Gil normally works 10-7 on Wednesdays
    try {
      await openSchedule(page, "Gil");
      await waitForHydration(page, "form[aria-label='Change hours for one day'] button");
      const form = ui(page).getByRole("form", { name: "Change hours for one day" });
      await form.getByLabel("Date").fill(date);
      await form.getByLabel("From", { exact: true }).fill("13:00");
      await form.getByLabel("To", { exact: true }).fill("20:00");
      await form.getByRole("button", { name: "Save change" }).click();
      await expect(form.getByRole("status")).toHaveText("Saved.");

      const changes = ui(page).getByRole("list", { name: "Upcoming changes" });
      await expect(changes).toContainText(formatDay(date));
      await expect(changes).toContainText("1pm–8pm");

      await changes.getByRole("button", { name: `Remove change on ${formatDay(date)}` }).click();
      await expect(ui(page).getByText("No upcoming changes.")).toBeVisible();
    } finally {
      await admin.from("staff_schedule_overrides").delete().eq("staff_id", SEED.staff.gil).eq("on_date", date);
    }
  });

  test("approve a pending time off request", async ({ page }) => {
    const { data: request } = await admin.from("staff_time_off").select("id").eq("staff_id", SEED.staff.shae).eq("status", "requested").single();
    try {
      await page.goto("/schedule");
      const requests = ui(page).getByRole("region", { name: /Time off requests/ });
      await expect(requests).toContainText("Shae Morgan");
      await expect(requests).toContainText("Sister's graduation");
      await requests.getByRole("button", { name: "Approve" }).click();
      await expect(ui(page).getByRole("region", { name: /Time off requests/ })).toHaveCount(0);

      await pickStaff(page, "Shae");
      const entry = ui(page).getByRole("list", { name: "Time off" }).getByRole("listitem").filter({ hasText: "Sister's graduation" });
      await expect(entry).toContainText("Approved");
    } finally {
      await admin.from("staff_time_off").update({ status: "requested", decided_by: null, decided_at: null }).eq("id", request!.id);
    }
  });

  test("add part-day time off for a stylist, then remove it", async ({ page }) => {
    const date = addDays(nextMonday, 1); // Bridget works Tuesdays
    try {
      await openSchedule(page, "Bridget");
      await waitForHydration(page, "form[aria-label='Add time off'] input[name=part_day]");
      const form = ui(page).getByRole("form", { name: "Add time off" });
      await form.getByLabel("First day").fill(date);
      await form.getByLabel("Part of the day").check();
      await form.getByLabel("From").fill("10:00");
      await form.getByLabel("To").fill("12:00");
      await form.getByLabel("Reason").selectOption("personal");
      await form.getByLabel("Note (optional)").fill("Parent-teacher meeting");
      await form.getByRole("button", { name: "Add time off" }).click();
      await expect(form.getByRole("status")).toHaveText("Time off added.");

      const entry = ui(page).getByRole("list", { name: "Time off" }).getByRole("listitem").filter({ hasText: "Parent-teacher meeting" });
      await expect(entry).toContainText(`Personal · ${formatDay(date)}, 10am–noon`);
      await expect(entry).toContainText("Approved");

      await nextWeek(page, nextMonday);
      await expect(day(page, date)).toContainText("Bookable: 9am–10am, noon–1pm, 2pm–6pm");

      await entry.getByRole("button", { name: "Remove" }).click();
      await expect(ui(page).getByText("Parent-teacher meeting")).toHaveCount(0);
    } finally {
      await admin.from("staff_time_off").delete().eq("staff_id", SEED.staff.bridget).eq("note", "Parent-teacher meeting");
    }
  });

  test("change a stylist's level and commission", async ({ page }) => {
    try {
      await openSchedule(page, "Shae");
      await waitForHydration(page, "form[aria-label='Level and commission'] select");
      const form = ui(page).getByRole("form", { name: "Level and commission" });
      await expect(form.getByLabel("Service commission (%)")).toHaveValue("35");

      await form.getByLabel("Service commission (%)").fill("150");
      await form.getByRole("button", { name: "Save" }).click();
      await expect(form.getByText("Enter a percentage from 0 to 100.")).toBeVisible();

      await form.getByLabel("Level").selectOption("senior");
      await form.getByLabel("Service commission (%)").fill("42.5");
      await form.getByRole("button", { name: "Save" }).click();
      await expect(form.getByRole("status")).toHaveText("Saved.");
      await expect(ui(page).getByText("Stylist · Senior")).toBeVisible();

      await page.reload();
      await expect(ui(page).getByRole("form", { name: "Level and commission" }).getByLabel("Service commission (%)")).toHaveValue("42.5");
    } finally {
      await admin.from("staff").update({ level: "artisan" }).eq("id", SEED.staff.shae);
      await admin.from("staff_compensation").update({ service_commission_pct: 35 }).eq("staff_id", SEED.staff.shae);
    }
  });

  test("edit opening hours", async ({ page }) => {
    const { data: before } = await admin.from("location_hours").select("weekday, start_minute, end_minute").eq("location_id", SEED.location);
    try {
      await page.goto("/schedule");
      await ui(page).getByRole("link", { name: "Opening hours" }).click();
      await waitForHydration(page, "form[aria-label='Opening hours'] button");
      const form = ui(page).getByRole("form", { name: "Opening hours" });
      await form.getByRole("button", { name: "Add hours on Monday" }).click();
      await form.getByLabel("Monday shift 1 start").fill("10:00");
      await form.getByLabel("Monday shift 1 end").fill("16:00");
      await form.getByRole("button", { name: "Save hours" }).click();
      await expect(form.getByRole("status")).toHaveText("Saved.");

      const { data } = await admin.from("location_hours").select("start_minute, end_minute").eq("location_id", SEED.location).eq("weekday", 1);
      expect(data).toEqual([{ start_minute: 600, end_minute: 960 }]);
    } finally {
      await admin.rpc("set_location_hours", { p_business_id: B, p_location_id: SEED.location, p_hours: before as Json });
    }
  });
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("see only their own schedule, read-only, with their own commission", async ({ page }) => {
    await page.goto(`/schedule?staff=${SEED.staff.sandra}`);
    // Asking for someone else's schedule still shows their own.
    await expect(ui(page).getByRole("heading", { level: 2 })).toHaveText("Bridget Callahan(you)");
    await expect(ui(page).getByRole("navigation", { name: "Team" })).toHaveCount(0);
    await expect(ui(page).getByRole("button", { name: "Save hours" })).toHaveCount(0);
    await expect(ui(page).getByRole("region", { name: "Weekly hours" })).toContainText("Tuesday9am–1pm, 2pm–6pm");
    await expect(ui(page).getByRole("region", { name: "Level and commission" })).toContainText("Service commission50%");
    // Her declined request is shown to her.
    await expect(ui(page).getByRole("list", { name: "Time off" })).toContainText("Declined");
  });

  test("request time off, which a manager then sees, and withdraw it", async ({ page, browser }) => {
    const date = addDays(nextMonday, 15);
    try {
      await page.goto("/schedule");
      await waitForHydration(page, "form[aria-label='Request time off'] select");
      const form = ui(page).getByRole("form", { name: "Request time off" });
      await form.getByLabel("First day").fill(date);
      await form.getByLabel("Reason").selectOption("personal");
      await form.getByLabel("Note (optional)").fill("Moving house");
      await form.getByRole("button", { name: "Request time off" }).click();
      await expect(form.getByRole("status")).toHaveText("Request sent.");

      const entry = ui(page).getByRole("list", { name: "Time off" }).getByRole("listitem").filter({ hasText: "Moving house" });
      await expect(entry).toContainText("Pending");

      // The owner sees it waiting.
      const ownerContext = await browser.newContext({ storageState: AUTH.owner });
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto("/schedule");
      await expect(ui(ownerPage).getByRole("region", { name: /Time off requests/ })).toContainText("Moving house");
      await ownerContext.close();

      await entry.getByRole("button", { name: "Withdraw" }).click();
      await expect(ui(page).getByText("Moving house")).toHaveCount(0);
    } finally {
      await admin.from("staff_time_off").delete().eq("staff_id", SEED.staff.bridget).eq("note", "Moving house");
    }
  });

  test("can't request time off in the past", async ({ page }) => {
    await page.goto("/schedule");
    await waitForHydration(page, "form[aria-label='Request time off'] select");
    const form = ui(page).getByRole("form", { name: "Request time off" });
    await form.getByLabel("First day").fill(addDays(today, -3));
    await form.getByRole("button", { name: "Request time off" }).click();
    await expect(form.getByText("Time off can't start in the past.")).toBeVisible();
  });
});
