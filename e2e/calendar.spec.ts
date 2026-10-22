import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { priya: PRIYA, ethan: ETHAN } = SEED.staff;
const CHAIR_1 = "f0000000-0000-4000-8000-000000000001";
const CHAIR_6 = "f0000000-0000-4000-8000-000000000006";

const today = todayIn(TZ);
const thisMonday = startOfWeek(today);
const nextMonday = addDays(thisMonday, 7);
// A Tuesday past the seeded appointments and seeded time off.
const QUIET_TUESDAY = addDays(thisMonday, 29);

// Unique per run; afterAll deletes these clients and their appointments.
const PREFIX = `Cal${Date.now().toString(36)}`;
const appointmentIds: string[] = [];

function at(date: string, hour: number, minute = 0): Date {
  return fromLocal(date, hour * 60 + minute, TZ)!;
}

async function service(name: string) {
  const { data } = await admin
    .from("services")
    .select("id, active_minutes, processing_minutes, finishing_minutes, duration_minutes, price_cents")
    .eq("business_id", B)
    .eq("name", name)
    .single();
  return data!;
}

async function client(firstName: string) {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}${firstName}`, last_name: "Test" }).select("id").single();
  return data!.id;
}

// An appointment with its items, straight into the database (booking from
// the calendar comes next slice).
async function book(
  clientId: string,
  items: { service: string; staff: string; start: Date; resource?: string }[],
  status: "booked" | "confirmed" | "checked_in" | "completed" | "canceled" = "booked",
) {
  const rows = await Promise.all(items.map(async (i) => ({ ...i, s: await service(i.service) })));
  const end = Math.max(...rows.map((r) => r.start.getTime() + r.s.duration_minutes! * 60_000));
  const { data: appointment, error } = await admin
    .from("appointments")
    .insert({
      business_id: B,
      location_id: L,
      client_id: clientId,
      starts_at: rows[0].start.toISOString(),
      ends_at: new Date(end).toISOString(),
      status,
      canceled_at: status === "canceled" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) throw error;
  appointmentIds.push(appointment.id);
  const { error: itemError } = await admin.from("appointment_items").insert(
    rows.map((r) => ({
      business_id: B,
      location_id: L,
      appointment_id: appointment.id,
      service_id: r.s.id,
      staff_id: r.staff,
      resource_id: r.resource ?? null,
      starts_at: r.start.toISOString(),
      ends_at: new Date(r.start.getTime() + r.s.duration_minutes! * 60_000).toISOString(),
      active_minutes: r.s.active_minutes,
      processing_minutes: r.s.processing_minutes,
      finishing_minutes: r.s.finishing_minutes,
      price_cents: r.s.price_cents,
    })),
  );
  if (itemError) throw itemError;
}

function column(page: Page, name: string) {
  return ui(page).getByRole("region", { name });
}

async function openDay(page: Page, date: string) {
  await page.goto(date === today ? "/calendar" : `/calendar?date=${date}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(date));
}

test.beforeAll(async () => {
  const [ava, ben, cara] = await Promise.all([client("Ava"), client("Ben"), client("Cara")]);
  // Ava: color with Priya, then a blowout with Ethan.
  await book(ava, [
    { service: "All-Over Color", staff: PRIYA, start: at(QUIET_TUESDAY, 10), resource: CHAIR_1 },
    { service: "Blowout", staff: ETHAN, start: at(QUIET_TUESDAY, 11, 45), resource: CHAIR_1 },
  ]);
  // Ben: a bang trim while Ava's color processes.
  await book(ben, [{ service: "Bang Trim", staff: PRIYA, start: at(QUIET_TUESDAY, 10, 45), resource: CHAIR_6 }]);
  // Cara canceled; she shouldn't show.
  await book(cara, [{ service: "Men's Cut", staff: ETHAN, start: at(QUIET_TUESDAY, 14) }], "canceled");
});

test.afterAll(async () => {
  if (appointmentIds.length) await admin.from("appointments").delete().in("id", appointmentIds);
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("sees a column per stylist with their hours", async ({ page }) => {
    await openDay(page, QUIET_TUESDAY);
    const headers = ["Ethan Brooks", "Hannah Novak", "Jamal Carter", "Marcus Lee", "Priya Shah", "Sofia Moreno"];
    for (const name of headers) await expect(column(page, name)).toBeVisible();
    // Owner, manager and front desk don't take clients.
    await expect(column(page, "Olivia Bennett")).toHaveCount(0);
    await expect(column(page, "Sam Rivera")).toHaveCount(0);
    await expect(ui(page).getByText("9am–1pm, 2pm–6pm")).toBeVisible(); // Priya's split shift
    await expect(ui(page).getByText("Open 9am–7pm")).toBeVisible();
  });

  test("shows appointments as blocks with the processing gap lighter", async ({ page }) => {
    await openDay(page, QUIET_TUESDAY);
    const priya = column(page, "Priya Shah");

    const color = priya.getByRole("button", { name: new RegExp(`^10am–11:45am, ${PREFIX}Ava Test, All-Over Color`) });
    await expect(color).toHaveAccessibleName(/processing 10:45am–11:20am, with Ethan, Chair 1, Booked$/);
    // (Test names are long, so the block may show a shorter form; the full
    // name is in its label.)
    await expect(color).toHaveAttribute("data-family", "color");
    // Booked needs no attention, so no chip.
    await expect(color.locator("[data-attention]")).toHaveCount(0);

    // 45 minutes applying, 35 processing, 25 finishing.
    const heights = await Promise.all(
      ["active", "processing", "finishing"].map(async (kind) => (await color.locator(`[data-segment=${kind}]`).boundingBox())!.height),
    );
    expect(heights[0] / heights[2]).toBeCloseTo(45 / 25, 1);
    expect(heights[1] / heights[2]).toBeCloseTo(35 / 25, 1);
    // Processing is drawn lighter than the busy parts.
    const lightness = (kind: string) =>
      color.locator(`[data-segment=${kind}]`).evaluate((el) => {
        // Let the browser resolve color-mix() to RGB.
        const canvas = document.createElement("canvas").getContext("2d")!;
        canvas.fillStyle = getComputedStyle(el).backgroundColor;
        canvas.fillRect(0, 0, 1, 1);
        const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
        return r + g + b;
      });
    expect(await lightness("processing")).toBeGreaterThan(await lightness("active"));

    // The color matches its family in the legend, and differs from Cuts.
    const legendColor = await ui(page)
      .getByRole("list", { name: "Service families" })
      .getByRole("listitem")
      .filter({ hasText: /^Color$/ })
      .locator("span")
      .evaluate((el) => getComputedStyle(el).borderLeftColor);
    expect(await color.evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe(legendColor);
    const trim = priya.getByRole("button", { name: new RegExp(`^10:45am–11am, ${PREFIX}Ben Test, Bang Trim`) });
    expect(await trim.evaluate((el) => getComputedStyle(el).borderLeftColor)).not.toBe(legendColor);

    // Ben's trim sits in Ava's processing gap, in its own lane on the right:
    // side by side, not on top.
    const colorBox = (await color.boundingBox())!;
    const trimBox = (await trim.boundingBox())!;
    expect(trimBox.x).toBeGreaterThanOrEqual(colorBox.x + colorBox.width - 1);
    expect(trimBox.y).toBeCloseTo(colorBox.y + heights[0], 0);
    // Its text fits its lane rather than being cut off.
    expect(await trim.evaluate((el) => [...el.querySelectorAll(".truncate")].every((t) => t.scrollWidth <= t.clientWidth + 0.5))).toBe(true);

    // The second stylist on Ava's visit.
    await expect(column(page, "Ethan Brooks").getByRole("button", { name: /^11:45am–12:30pm, .*Ava Test, Blowout, with Priya/ })).toBeVisible();
    // Canceled visits aren't shown.
    await expect(ui(page).getByText(`${PREFIX}Cara`)).toHaveCount(0);

    // A block opens the visit, and from there the client.
    await waitForHydration(page, "[data-block]");
    // (Its middle is under Ben's trim.)
    await color.click({ position: { x: 10, y: 5 } });
    const panel = page.getByRole("tabpanel", { name: "Booking details" });
    await expect(panel.getByTestId("client-name")).toHaveText(`${PREFIX}Ava Test`);
    await expect(panel).toContainText("All-Over Color");
    await expect(color).toHaveAttribute("aria-pressed", "true");
    await panel.getByRole("link", { name: "View client profile" }).click();
    await expect(ui(page).getByRole("heading", { level: 1, name: `${PREFIX}Ava Test` })).toBeVisible();
  });

  test("greys out off hours and time off", async ({ page }) => {
    await openDay(page, QUIET_TUESDAY);
    // Priya: 1-2pm lunch and after 6pm, in a 9am-7pm day.
    await expect(column(page, "Priya Shah").locator("[data-off-hours]")).toHaveCount(2);
    // Hannah doesn't work Tuesdays: her column folds to her initials until opened.
    await expect(column(page, "Hannah Novak")).toHaveAttribute("data-collapsed");
    await waitForHydration(page, "[data-block]");
    await ui(page).getByRole("button", { name: "Show Hannah Novak (not working)" }).click();
    await expect(column(page, "Hannah Novak").locator("[data-off-hours]")).toHaveCount(1);
    await expect(column(page, "Hannah Novak").getByRole("list")).toBeEmpty();
    await ui(page).getByRole("button", { name: "Hide Hannah Novak" }).click();
    await expect(column(page, "Hannah Novak")).toHaveAttribute("data-collapsed");

    // Hannah's dentist appointment next Thursday afternoon.
    await openDay(page, addDays(nextMonday, 3));
    await expect(column(page, "Hannah Novak").getByText("Time off: Personal · Dentist")).toBeVisible();

    // Mondays the salon is closed.
    await openDay(page, nextMonday);
    await expect(ui(page).getByText("Salon closed")).toBeVisible();
    await expect(ui(page).getByRole("button", { name: /^Show .* \(not working\)$/ })).toHaveCount(6);
  });

  test("moves between days", async ({ page }) => {
    await openDay(page, today);
    await expect(ui(page).getByText("Today", { exact: false }).first()).toBeVisible();
    await waitForHydration(page, "[aria-haspopup=dialog]");

    await ui(page).getByRole("link", { name: "Next day" }).click();
    await expect(page).toHaveURL(`/calendar?date=${addDays(today, 1)}`);
    await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(addDays(today, 1)));

    await ui(page).getByRole("link", { name: "Previous day" }).click();
    await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(today));
    await ui(page).getByRole("link", { name: "Previous day" }).click();
    await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(addDays(today, -1)));

    await ui(page).getByRole("link", { name: "Today" }).click();
    await expect(page).toHaveURL("/calendar");

    // The date opens a small calendar.
    await waitForHydration(page, "[aria-haspopup=dialog]");
    await ui(page).getByRole("button", { name: /^Go to date: / }).click();
    const picker = ui(page).getByRole("dialog", { name: "Go to date" });
    await expect(picker.getByRole("button", { name: formatLongDay(today) })).toHaveAttribute("aria-current", "date");
    for (let i = 0; i < 2 && !(await picker.getByRole("button", { name: formatLongDay(QUIET_TUESDAY) }).count()); i++) {
      await picker.getByRole("button", { name: "Next month" }).click();
    }
    await picker.getByRole("button", { name: formatLongDay(QUIET_TUESDAY) }).click();
    await expect(page).toHaveURL(`/calendar?date=${QUIET_TUESDAY}`);
    await expect(picker).toHaveCount(0);
    await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(QUIET_TUESDAY));
  });

  test("shows a line at the current time, today only", async ({ page }) => {
    await page.clock.setFixedTime(at(today, 11));
    await openDay(page, today);
    await expect(ui(page).getByRole("img", { name: "Now, 11am" })).toBeVisible();

    await openDay(page, addDays(today, 1));
    await expect(ui(page).getByRole("img", { name: /^Now/ })).toHaveCount(0);
  });

  test("ignores a bad date", async ({ page }) => {
    await page.goto("/calendar?date=2026-02-30");
    await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(today));
  });
});

test.describe("design", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("filters stylists by department", async ({ page }) => {
    await openDay(page, QUIET_TUESDAY);
    await waitForHydration(page, "[aria-haspopup=listbox]");
    const department = ui(page).getByRole("button", { name: /^Department/ });
    await expect(department).toHaveAccessibleName("Department All departments");
    await department.click();
    await ui(page).getByRole("listbox", { name: "Department" }).getByRole("option", { name: "Color" }).click();
    await expect(department).toHaveAccessibleName("Department Color");
    for (const name of ["Jamal Carter", "Marcus Lee", "Priya Shah", "Sofia Moreno"]) await expect(column(page, name)).toBeVisible();
    await expect(column(page, "Hannah Novak")).toHaveCount(0);
    await expect(column(page, "Ethan Brooks")).toHaveCount(0);
    // By keyboard too.
    await department.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(department).toHaveAccessibleName("Department All departments");
    await expect(column(page, "Ethan Brooks")).toBeVisible();
  });

  test("fits every working stylist on screen at 1440px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDay(page, QUIET_TUESDAY);
    const grid = ui(page).getByTestId("calendar-grid");
    expect(await grid.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    // The header row and time column stay put when the grid scrolls.
    await grid.evaluate((el) => (el.scrollTop = 400));
    await expect(column(page, "Priya Shah")).toBeVisible();
    const headerTop = await ui(page).getByText("Master stylist").evaluate((el) => el.getBoundingClientRect().top);
    const gridTop = await grid.evaluate((el) => el.getBoundingClientRect().top);
    expect(headerTop - gridTop).toBeLessThan(40);
  });

  test("shows chips only for states that need attention, and fades checked-out visits", async ({ page }) => {
    // Browser clock: 10:30 on the quiet Tuesday, so a 10:00 booking that
    // hasn't checked in is running late.
    await page.clock.setFixedTime(at(QUIET_TUESDAY, 10, 30));
    const [late, done, ready, here] = await Promise.all(["Lou", "Dot", "Rey", "Ida"].map(client));
    await book(late, [{ service: "Men's Cut", staff: SEED.staff.jamal, start: at(QUIET_TUESDAY, 10) }]);
    await book(done, [{ service: "Men's Cut", staff: SEED.staff.jamal, start: at(QUIET_TUESDAY, 9) }], "completed");
    await book(ready, [{ service: "Men's Cut", staff: SEED.staff.jamal, start: at(QUIET_TUESDAY, 13) }], "confirmed");
    await book(here, [{ service: "Skin Fade", staff: SEED.staff.jamal, start: at(QUIET_TUESDAY, 15) }], "checked_in");

    await openDay(page, QUIET_TUESDAY);
    const jamal = column(page, "Jamal Carter");
    const block = (name: string) => jamal.getByRole("button", { name: new RegExp(`${PREFIX}${name}`) });
    await expect(block("Lou").locator("[data-attention]")).toHaveAttribute("data-attention", "late");
    await expect(block("Lou")).toHaveAccessibleName(/running late$/);
    await expect(block("Rey").locator("[data-attention]")).toHaveAttribute("data-attention", "confirmed");
    await expect(block("Ida").locator("[data-attention]")).toHaveAttribute("data-attention", "checked_in");
    await expect(block("Dot")).toHaveAttribute("data-faded", "true");
    await expect(block("Dot").locator("[data-attention]")).toHaveCount(0);
  });

  test("shows the week view as coming soon", async ({ page }) => {
    await openDay(page, QUIET_TUESDAY);
    const view = ui(page).getByRole("radiogroup", { name: "View" });
    await expect(view.getByRole("radio", { name: "Day" })).toHaveAttribute("aria-checked", "true");
    await expect(view.getByRole("radio", { name: "Week" })).toBeDisabled();
  });

  test("animates quickly, and not at all with reduce motion", async ({ page }) => {
    await openDay(page, QUIET_TUESDAY);
    const block = column(page, "Priya Shah").getByRole("button", { name: /Ava Test/ });
    const duration = () => block.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    const seconds = await duration();
    expect(seconds).toBeGreaterThanOrEqual(0.15);
    expect(seconds).toBeLessThanOrEqual(0.25);

    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await duration()).toBeLessThan(0.001);
  });

  for (const width of [1100, 1920]) {
    test(`keeps the panel closed until something opens it (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openDay(page, QUIET_TUESDAY);
      const aside = page.getByRole("complementary", { name: "Assistant and booking details" });
      await expect(aside).toBeHidden();
      // The calendar uses the full width.
      const grid = await ui(page).getByTestId("calendar-grid").boundingBox();
      expect(grid!.x + grid!.width).toBeGreaterThan(width - 40);

      // Denise's face opens her panel; the X and Escape close it.
      await waitForHydration(page, "[data-block]");
      await page.getByTestId("denise-launcher").click();
      await expect(aside).toBeVisible();
      await expect(aside.getByRole("tab", { name: /Denise/ })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("denise-launcher")).toHaveCount(0);
      await aside.getByRole("button", { name: "Close panel" }).click();
      await expect(aside).toBeHidden();
      await page.getByTestId("denise-launcher").click();
      await expect(aside).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(aside).toBeHidden();

      // An appointment opens its details; empty calendar space closes them
      // without starting a booking.
      await column(page, "Priya Shah").getByRole("button", { name: /Ava Test/ }).click({ position: { x: 10, y: 5 } });
      await expect(aside.getByRole("tabpanel", { name: "Booking details" })).toContainText("All-Over Color");
      const box = (await column(page, "Ethan Brooks").boundingBox())!;
      await column(page, "Ethan Brooks").click({ position: { x: 20, y: box.height - 20 } });
      await expect(aside).toBeHidden();
      await expect(aside.getByRole("form", { name: "New booking" })).toHaveCount(0);
    });
  }
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("see the whole team's day", async ({ page }) => {
    await openDay(page, QUIET_TUESDAY);
    await expect(column(page, "Ethan Brooks").getByRole("button", { name: /Ava Test, Blowout/ })).toBeVisible();
    await expect(column(page, "Priya Shah").getByRole("button", { name: /Ava Test, All-Over Color/ })).toBeVisible();
  });
});
