import type { Page } from "@playwright/test";
import { formatDay } from "@/lib/schedule-format";
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

function at(date: string, hour: number, minute = 0) {
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
  status: "booked" | "canceled" = "booked",
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
  await expect(ui(page).getByRole("heading", { level: 1, name: formatDay(date, true) })).toBeVisible();
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
    await expect(color).toHaveAccessibleName(/processing 10:45am–11:20am, with Ethan, Chair 1$/);
    await expect(color).toContainText(`${PREFIX}Ava Test`);
    await expect(color).toHaveAttribute("data-category", "Color");

    // 45 minutes applying, 35 processing, 25 finishing.
    const heights = await Promise.all(
      ["active", "processing", "finishing"].map(async (kind) => (await color.locator(`[data-segment=${kind}]`).boundingBox())!.height),
    );
    expect(heights[0] / heights[2]).toBeCloseTo(45 / 25, 1);
    expect(heights[1] / heights[2]).toBeCloseTo(35 / 25, 1);
    const background = (kind: string) => color.locator(`[data-segment=${kind}]`).evaluate((el) => getComputedStyle(el).backgroundColor);
    const alpha = (rgba: string) => Number(/rgba?\([^)]*,\s*([\d.]+)\)$/.exec(rgba)?.[1] ?? 1);
    expect(alpha(await background("processing"))).toBeLessThan(alpha(await background("active")));

    // The color matches its category in the legend, and differs from Cuts.
    const legendColor = await ui(page)
      .getByRole("list", { name: "Service categories" })
      .getByRole("listitem")
      .filter({ hasText: /^Color$/ })
      .locator("span")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await color.evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe(legendColor);
    const trim = priya.getByRole("button", { name: new RegExp(`^10:45am–11am, ${PREFIX}Ben Test, Bang Trim`) });
    expect(await trim.evaluate((el) => getComputedStyle(el).borderLeftColor)).not.toBe(legendColor);

    // Ben's trim sits inside Ava's processing gap, indented so both show.
    const colorBox = (await color.boundingBox())!;
    const trimBox = (await trim.boundingBox())!;
    expect(trimBox.x).toBeGreaterThan(colorBox.x + 20);
    expect(trimBox.y).toBeCloseTo(colorBox.y + heights[0], 0);

    // The second stylist on Ava's visit.
    await expect(column(page, "Ethan Brooks").getByRole("button", { name: /^11:45am–12:30pm, .*Ava Test, Blowout, with Priya/ })).toBeVisible();
    // Canceled visits aren't shown.
    await expect(ui(page).getByText(`${PREFIX}Cara`)).toHaveCount(0);

    // A block opens the visit, and from there the client.
    await waitForHydration(page, "[data-block]");
    // (Its middle is under Ben's trim.)
    await color.click({ position: { x: 10, y: 5 } });
    const panel = page.getByRole("dialog", { name: `${PREFIX}Ava Test` });
    await expect(panel).toContainText("All-Over Color");
    await panel.getByRole("link", { name: "Open client profile" }).click();
    await expect(ui(page).getByRole("heading", { level: 1, name: `${PREFIX}Ava Test` })).toBeVisible();
  });

  test("greys out off hours and time off", async ({ page }) => {
    await openDay(page, QUIET_TUESDAY);
    // Priya: 1-2pm lunch and after 6pm, in a 9am-7pm day.
    await expect(column(page, "Priya Shah").locator("[data-off-hours]")).toHaveCount(2);
    // Hannah doesn't work Tuesdays.
    await expect(column(page, "Hannah Novak").locator("[data-off-hours]")).toHaveCount(1);
    await expect(column(page, "Hannah Novak").getByRole("list")).toBeEmpty();

    // Hannah's dentist appointment next Thursday afternoon.
    await openDay(page, addDays(nextMonday, 3));
    await expect(column(page, "Hannah Novak").getByText("Time off: Personal · Dentist")).toBeVisible();

    // Mondays the salon is closed.
    await openDay(page, nextMonday);
    await expect(ui(page).getByText("Salon closed")).toBeVisible();
    await expect(ui(page).getByText("Not working")).toHaveCount(6);
  });

  test("moves between days", async ({ page }) => {
    await openDay(page, today);
    await expect(ui(page).getByText("Today", { exact: false }).first()).toBeVisible();
    await waitForHydration(page, "input[name=date]");

    await ui(page).getByRole("link", { name: "Next day →" }).click();
    await expect(page).toHaveURL(`/calendar?date=${addDays(today, 1)}`);
    await expect(ui(page).getByRole("heading", { level: 1, name: formatDay(addDays(today, 1), true) })).toBeVisible();

    await ui(page).getByRole("link", { name: "← Previous day" }).click();
    await expect(ui(page).getByRole("heading", { level: 1, name: formatDay(today, true) })).toBeVisible();
    await ui(page).getByRole("link", { name: "← Previous day" }).click();
    await expect(ui(page).getByRole("heading", { level: 1, name: formatDay(addDays(today, -1), true) })).toBeVisible();

    await ui(page).getByRole("link", { name: "Today" }).click();
    await expect(page).toHaveURL("/calendar");

    await waitForHydration(page, "input[name=date]");
    await ui(page).getByLabel("Go to date").fill(QUIET_TUESDAY);
    await ui(page).getByRole("button", { name: "Go", exact: true }).click();
    await expect(page).toHaveURL(`/calendar?date=${QUIET_TUESDAY}`);
    await expect(ui(page).getByRole("heading", { level: 1, name: formatDay(QUIET_TUESDAY, true) })).toBeVisible();
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
    await expect(ui(page).getByRole("heading", { level: 1, name: formatDay(today, true) })).toBeVisible();
  });
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("see the whole team's day", async ({ page }) => {
    await openDay(page, QUIET_TUESDAY);
    await expect(column(page, "Ethan Brooks").getByRole("button", { name: /Ava Test, Blowout/ })).toBeVisible();
    await expect(column(page, "Priya Shah").getByRole("button", { name: /Ava Test, All-Over Color/ })).toBeVisible();
  });
});
