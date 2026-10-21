import type { Locator, Page } from "@playwright/test";
import { formatDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { priya: PRIYA, ethan: ETHAN, frontDesk: FRONT_DESK, sofia: SOFIA } = SEED.staff;
const PX_PER_MINUTE = 1.6;

// A Tuesday clear of the seeded month and of the calendar tests' day.
// Priya works 9-1 and 2-6, Ethan 9-1 and 1:30-5:30, Jamal 9-5 (no blowouts).
const DAY = addDays(startOfWeek(todayIn(TZ)), 36);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;

const PREFIX = `Bk${Date.now().toString(36)}`;

async function clearDay() {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
}

test.beforeEach(clearDay);
test.afterAll(async () => {
  await clearDay();
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

async function newClient(firstName: string) {
  const { data } = await admin
    .from("clients")
    .insert({ business_id: B, first_name: `${PREFIX}${firstName}`, last_name: "Test", phone: "(312) 555-0199" })
    .select("id")
    .single();
  return data!.id;
}

async function service(name: string) {
  const { data } = await admin.from("services").select("id, active_minutes, processing_minutes, finishing_minutes, duration_minutes, price_cents").eq("business_id", B).eq("name", name).single();
  return data!;
}

// Straight into the database, for tests about changing existing visits.
async function seedVisit(clientId: string, items: { service: string; staff: string; start: Date; resource?: string }[]) {
  const rows = await Promise.all(items.map(async (i) => ({ ...i, s: await service(i.service) })));
  const end = Math.max(...rows.map((r) => r.start.getTime() + r.s.duration_minutes! * 60_000));
  const { data: a } = await admin
    .from("appointments")
    .insert({ business_id: B, location_id: L, client_id: clientId, starts_at: rows[0].start.toISOString(), ends_at: new Date(end).toISOString(), created_by: FRONT_DESK })
    .select("id")
    .single();
  await admin.from("appointment_items").insert(
    rows.map((r) => ({
      business_id: B,
      location_id: L,
      appointment_id: a!.id,
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
  return a!.id;
}

async function appointment(id: string) {
  const { data } = await admin
    .from("appointments")
    .select("status, notes, cancel_reason, created_by, updated_by, appointment_items(service_id, staff_id, starts_at, price_cents)")
    .eq("id", id)
    .single();
  return data!;
}

async function openDay(page: Page) {
  await page.goto(`/calendar?date=${DAY}`);
  await expect(ui(page).getByRole("heading", { level: 1, name: formatDay(DAY, true) })).toBeVisible();
  await waitForHydration(page, "section[data-staff-id]");
}

function column(page: Page, name: string) {
  return ui(page).getByRole("region", { name });
}

async function clickSlot(page: Page, stylist: string, hour: number, minute = 0) {
  const box = (await column(page, stylist).boundingBox())!;
  const start = Number(await ui(page).locator("[data-range-start]").getAttribute("data-range-start"));
  await page.mouse.click(box.x + box.width - 15, box.y + (hour * 60 + minute - start) * PX_PER_MINUTE + 3);
}

async function drag(page: Page, block: Locator, toStylist: string, minutes: number) {
  const from = (await block.boundingBox())!;
  const to = (await column(page, toStylist).boundingBox())!;
  await page.mouse.move(from.x + 15, from.y + 8);
  await page.mouse.down();
  await page.mouse.move(to.x + 30, from.y + 8 + minutes * PX_PER_MINUTE, { steps: 10 });
  await page.mouse.up();
}

const panel = (page: Page) => page.getByRole("dialog");

// Tall enough to click any time of day without scrolling.
test.use({ viewport: { width: 1440, height: 1500 } });

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("books a visit with two stylists from an empty slot", async ({ page }) => {
    await newClient("Ava");
    await openDay(page);
    await clickSlot(page, "Priya Shah", 10);

    const form = panel(page).getByRole("form", { name: "New appointment" });
    await expect(form.getByRole("group", { name: "Service 1" }).getByLabel("Stylist")).toHaveValue(PRIYA);
    await expect(form.getByRole("group", { name: "Service 1" }).getByLabel("Starts")).toHaveValue("10:00");

    await form.getByLabel("Find a client").fill(`${PREFIX}ava`);
    await form.getByRole("list", { name: "Matching clients" }).getByRole("button", { name: new RegExp(`${PREFIX}Ava Test`) }).click();
    await expect(form.getByRole("region", { name: "Client" })).toContainText(`${PREFIX}Ava Test`);

    const first = form.getByRole("group", { name: "Service 1" });
    await first.getByLabel("Service").selectOption({ label: "All-Over Color" });
    // Priya's color price, not the $130 menu price.
    await expect(first.getByTestId("line-summary")).toHaveText("10am–11:45am · 1h 45m · $150");

    await form.getByRole("button", { name: "Add another service" }).click();
    const second = form.getByRole("group", { name: "Service 2" });
    await expect(second.getByLabel("Starts")).toHaveValue("11:45"); // straight after
    await second.getByLabel("Stylist").selectOption({ label: "Ethan Brooks" });
    await second.getByLabel("Service").selectOption({ label: "Blowout" });
    await expect(second.getByTestId("line-summary")).toHaveText("11:45am–12:30pm · 45m · $45");
    await expect(form.getByTestId("visit-total")).toHaveText("10am–12:30pm · 2h 30m$195");

    await form.getByRole("button", { name: "Book appointment" }).click();
    await expect(panel(page)).toHaveCount(0);

    const color = column(page, "Priya Shah").getByRole("button", { name: new RegExp(`^10am–11:45am, ${PREFIX}Ava Test, All-Over Color, .*with Ethan, Chair 1`) });
    await expect(color).toBeVisible();
    await expect(column(page, "Ethan Brooks").getByRole("button", { name: new RegExp(`^11:45am–12:30pm, ${PREFIX}Ava Test, Blowout, with Priya`) })).toBeVisible();

    const { data } = await admin.from("appointments").select("id, created_by, updated_by").eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
    expect(data).toEqual([expect.objectContaining({ created_by: FRONT_DESK, updated_by: FRONT_DESK })]);
  });

  test("adds a new client while booking", async ({ page }) => {
    await openDay(page);
    await clickSlot(page, "Ethan Brooks", 14);
    const form = panel(page).getByRole("form", { name: "New appointment" });
    await form.getByLabel("Find a client").fill(`${PREFIX}Zed Newcomer`);
    await form.getByRole("button", { name: "New client" }).click();

    const fields = form.getByRole("region", { name: "New client" });
    await expect(fields.getByLabel("First name")).toHaveValue(`${PREFIX}Zed`);
    await expect(fields.getByLabel("Last name")).toHaveValue("Newcomer");
    await fields.getByRole("button", { name: "Add client" }).click();
    await expect(fields.getByText("Enter a 10-digit phone number.")).toBeVisible();
    await fields.getByLabel("Phone").fill("312 555 0188");
    await fields.getByRole("button", { name: "Add client" }).click();
    await expect(form.getByRole("region", { name: "Client" })).toContainText("(312) 555-0188");

    await form.getByLabel("Service").selectOption({ label: "Men's Cut" });
    await form.getByRole("button", { name: "Book appointment" }).click();
    await expect(column(page, "Ethan Brooks").getByRole("button", { name: new RegExp(`^2pm–2:30pm, ${PREFIX}Zed Newcomer, Men's Cut`) })).toBeVisible();

    const { data } = await admin.from("clients").select("phone").eq("first_name", `${PREFIX}Zed`).single();
    expect(data!.phone).toBe("(312) 555-0188");
  });

  test("explains why a booking breaks the rules, and saves nothing", async ({ page }) => {
    const ben = await newClient("Ben");
    await seedVisit(ben, [{ service: "Women's Cut & Style", staff: PRIYA, start: at(10) }]);
    await openDay(page);

    // 10:30 is under Ben's block, so book it from the button.
    await ui(page).getByRole("button", { name: "New appointment" }).click();
    const form = panel(page).getByRole("form", { name: "New appointment" });
    await form.getByLabel("Find a client").fill(`${PREFIX}ben`);
    await form.getByRole("list", { name: "Matching clients" }).getByRole("button").first().click();
    const first = form.getByRole("group", { name: "Service 1" });
    await first.getByLabel("Stylist").selectOption({ label: "Priya Shah" });
    await first.getByLabel("Starts").fill("10:30");
    await first.getByLabel("Service").selectOption({ label: "Women's Cut & Style" });
    await form.getByRole("button", { name: "Add another service" }).click();
    const second = form.getByRole("group", { name: "Service 2" });
    await second.getByLabel("Service").selectOption({ label: "Blowout" });
    await second.getByLabel("Starts").fill("12:30"); // into Priya's lunch break
    await form.getByRole("button", { name: "Book appointment" }).click();

    await expect(form.getByRole("alert")).toHaveText("This can't be booked as it is. See the highlighted services.");
    await expect(form.getByRole("group", { name: "Service 1" })).toContainText("The stylist already has a client then.");
    await expect(second).toContainText("The stylist isn't working for all of this time.");

    const { count } = await admin.from("appointments").select("id", { count: "exact", head: true }).eq("client_id", ben);
    expect(count).toBe(1);
  });

  test("checks in, checks out, and shows who did it", async ({ page }) => {
    const id = await seedVisit(await newClient("Cara"), [{ service: "Women's Cut & Style", staff: PRIYA, start: at(10) }]);
    await openDay(page);
    await column(page, "Priya Shah").getByRole("button", { name: new RegExp(`${PREFIX}Cara Test`) }).click();

    const detail = panel(page);
    await expect(detail).toContainText("Booked by Sam Rivera");
    await detail.getByRole("button", { name: "Check in" }).click();
    await expect(detail.locator("[data-status]")).toHaveText("Checked in");
    await expect(detail.getByRole("button", { name: "No-show" })).toHaveCount(0);
    await detail.getByRole("button", { name: "Check out" }).click();
    await expect(detail.locator("[data-status]")).toHaveText("Checked out");
    await expect(detail.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(detail).toContainText("Last changed by Sam Rivera");
    expect(await appointment(id)).toMatchObject({ status: "completed", updated_by: FRONT_DESK });
  });

  test("cancels with a reason, taking the visit off the calendar", async ({ page }) => {
    const id = await seedVisit(await newClient("Dee"), [{ service: "Women's Cut & Style", staff: PRIYA, start: at(10) }]);
    await openDay(page);
    const block = column(page, "Priya Shah").getByRole("button", { name: new RegExp(`${PREFIX}Dee Test`) });
    await block.click();

    const detail = panel(page);
    await detail.getByRole("button", { name: "Cancel appointment" }).click();
    const form = detail.getByRole("form", { name: "Cancel appointment" });
    await form.getByLabel("Reason").selectOption("Other");
    await form.getByRole("button", { name: "Cancel appointment" }).click();
    await expect(detail.getByRole("alert")).toHaveText("Say why it was canceled.");
    await form.getByLabel("Reason").selectOption("Client is sick");
    await form.getByLabel("Details").fill("Will call to rebook");
    await form.getByRole("button", { name: "Cancel appointment" }).click();

    await expect(panel(page)).toHaveCount(0);
    await expect(block).toHaveCount(0);
    expect(await appointment(id)).toMatchObject({ status: "canceled", cancel_reason: "Client is sick: Will call to rebook" });
  });

  test("marks a no-show", async ({ page }) => {
    const id = await seedVisit(await newClient("Eli"), [{ service: "Men's Cut", staff: ETHAN, start: at(9) }]);
    await openDay(page);
    await column(page, "Ethan Brooks").getByRole("button", { name: new RegExp(`${PREFIX}Eli Test`) }).click();
    await panel(page).getByRole("button", { name: "No-show" }).click();
    await expect(panel(page).locator("[data-status]")).toHaveText("No-show");
    await expect(column(page, "Ethan Brooks").getByRole("button", { name: new RegExp(`${PREFIX}Eli Test.*No-show$`) })).toBeVisible();
    expect((await appointment(id)).status).toBe("no_show");
  });

  test("edits a visit's services and notes", async ({ page }) => {
    const id = await seedVisit(await newClient("Fay"), [{ service: "Women's Cut & Style", staff: PRIYA, start: at(10), resource: "f0000000-0000-4000-8000-000000000001" }]);
    await openDay(page);
    await column(page, "Priya Shah").getByRole("button", { name: new RegExp(`${PREFIX}Fay Test`) }).click();
    await panel(page).getByRole("button", { name: "Edit" }).click();

    const form = panel(page).getByRole("form", { name: "Edit appointment" });
    await expect(form.getByRole("region", { name: "Client" })).toContainText(`${PREFIX}Fay Test`);
    await form.getByLabel("Service").selectOption({ label: "Curly Cut" });
    await form.getByLabel("Notes").fill("Bring curl cream");
    await form.getByRole("button", { name: "Save changes" }).click();

    // Back on the visit, updated.
    await expect(panel(page).getByRole("region", { name: "Services" })).toContainText("Curly Cut");
    await expect(column(page, "Priya Shah").getByRole("button", { name: new RegExp(`^10am–11:15am, ${PREFIX}Fay Test, Curly Cut`) })).toBeVisible();
    const saved = await appointment(id);
    expect(saved).toMatchObject({ notes: "Bring curl cream", updated_by: FRONT_DESK });
    expect(saved.appointment_items).toEqual([expect.objectContaining({ service_id: (await service("Curly Cut")).id })]);
  });

  test("drags a visit to a new time and stylist", async ({ page }) => {
    const id = await seedVisit(await newClient("Gus"), [{ service: "Blowout", staff: PRIYA, start: at(10) }]);
    await openDay(page);
    const block = (stylist: string) => column(page, stylist).getByRole("button", { name: new RegExp(`${PREFIX}Gus Test`) });

    await drag(page, block("Priya Shah"), "Ethan Brooks", 60);
    await expect(block("Ethan Brooks")).toHaveAccessibleName(new RegExp(`^11am–11:45am, ${PREFIX}Gus Test`));
    await expect(block("Priya Shah")).toHaveCount(0);
    // The block moves straight away; the save follows.
    await expect.poll(async () => (await appointment(id)).appointment_items[0].staff_id).toBe(ETHAN);
    const moved = await appointment(id);
    expect(moved.appointment_items[0].starts_at).toBe(at(11).toISOString().replace(".000Z", "+00:00"));
    expect(moved.updated_by).toBe(FRONT_DESK);
  });

  test("snaps a move back and says why when it breaks a rule", async ({ page }) => {
    await seedVisit(await newClient("Hal"), [{ service: "Blowout", staff: ETHAN, start: at(10) }]);
    await seedVisit(await newClient("Ivy"), [{ service: "Men's Cut", staff: ETHAN, start: at(11) }]);
    await openDay(page);
    const hal = (stylist: string) => column(page, stylist).getByRole("button", { name: new RegExp(`${PREFIX}Hal Test`) });

    // Jamal doesn't do blowouts.
    await drag(page, hal("Ethan Brooks"), "Jamal Carter", 0);
    await expect(ui(page).getByRole("alert")).toHaveText(`Couldn't move ${PREFIX}Hal Test's Blowout: The stylist doesn't offer this service.×`);
    await expect(hal("Ethan Brooks")).toHaveAccessibleName(new RegExp("^10am–10:45am"));

    // Onto Ivy's cut.
    await drag(page, hal("Ethan Brooks"), "Ethan Brooks", 45);
    await expect(ui(page).getByRole("alert")).toContainText("The stylist already has a client then.");
    await expect(hal("Ethan Brooks")).toHaveAccessibleName(new RegExp("^10am–10:45am"));
  });
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("view everything but only edit notes on their own visits", async ({ page }) => {
    const mine = await seedVisit(await newClient("Jo"), [{ service: "Women's Cut & Style", staff: PRIYA, start: at(10) }]);
    await seedVisit(await newClient("Kit"), [{ service: "All-Over Color", staff: SOFIA, start: at(10) }]);
    await openDay(page);

    await expect(ui(page).getByRole("button", { name: "New appointment" })).toHaveCount(0);
    await clickSlot(page, "Priya Shah", 14);
    await expect(panel(page)).toHaveCount(0);

    // Someone else's visit: read only.
    await column(page, "Sofia Moreno").getByRole("button", { name: new RegExp(`${PREFIX}Kit Test`) }).click();
    await expect(panel(page).getByRole("region", { name: "Notes" })).toContainText("No notes.");
    await expect(panel(page).getByRole("button", { name: /Edit|Check in|Cancel/ })).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Close" }).click();

    // Their own: notes only.
    const block = column(page, "Priya Shah").getByRole("button", { name: new RegExp(`${PREFIX}Jo Test`) });
    await block.click();
    const notes = panel(page).getByRole("form", { name: "Notes" });
    await notes.getByLabel("Notes").fill("Wants a fringe");
    await notes.getByRole("button", { name: "Save notes" }).click();
    await expect(notes.getByRole("status")).toHaveText("Notes saved.");
    await expect(panel(page).getByRole("button", { name: /Edit|Check in|Cancel/ })).toHaveCount(0);
    expect(await appointment(mine)).toMatchObject({ notes: "Wants a fringe", updated_by: PRIYA });
    await panel(page).getByRole("button", { name: "Close" }).click();

    // Dragging does nothing.
    await drag(page, block, "Priya Shah", 60);
    await expect(block).toHaveAccessibleName(/^10am–11am/);
    expect((await appointment(mine)).appointment_items[0].starts_at).toBe(at(10).toISOString().replace(".000Z", "+00:00"));
  });
});
