import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration, pxPerMinute, slotAt, moreAction } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET } = SEED.staff;
// Tuesdays clear of the seeded month and the other tests' days.
const DAY = addDays(startOfWeek(todayIn(TZ)), 64);
const DATES = [0, 14, 28, 42].map((d) => addDays(DAY, d));
const at = (date: string, hour: number, minute = 0) => fromLocal(date, hour * 60 + minute, TZ)!;
const PREFIX = `Se${Date.now().toString(36)}`;

async function clear() {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(DAY, 0).toISOString()).lt("starts_at", at(addDays(DAY, 50), 0).toISOString());
}
test.beforeEach(clear);
test.afterAll(async () => {
  await clear();
  await admin.from("appointment_series").delete().eq("location_id", L).is("client_id", null);
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

async function newClient(first: string) {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}${first}`, last_name: "Test", phone: "(312) 555-0197" }).select("id").single();
  return data!.id;
}

async function openDay(page: Page, date = DAY) {
  await page.goto(`/calendar?date=${date}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(date));
  await waitForHydration(page, "section[data-staff-id]");
}

const column = (page: Page, name: string) => ui(page).getByRole("region", { name, exact: true });

async function clickSlot(page: Page, stylist: string, hour: number) {
  const { box, y } = await slotAt(page, column(page, stylist), hour * 60);
  await page.mouse.click(box.x + box.width - 15, y);
}

test.use({ viewport: { width: 1920, height: 1500 }, storageState: AUTH.frontDesk });

test("books a series, with Denise's suggestion for a date that doesn't fit", async ({ page }) => {
  await newClient("Mae");
  // Bridget's already taken at 10 on the third date.
  const other = await newClient("Taken");
  const { data: s } = await admin.from("services").select("id, duration_minutes, active_minutes, price_cents").eq("name", "Women's Cut & Style").single();
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: other, starts_at: at(DATES[2], 10).toISOString(), ends_at: at(DATES[2], 11).toISOString() }).select("id").single();
  await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: s!.id, staff_id: BRIDGET, starts_at: at(DATES[2], 10).toISOString(), ends_at: at(DATES[2], 11).toISOString(), active_minutes: 60, price_cents: 0 });

  await openDay(page);
  await clickSlot(page, "Bridget Callahan", 10);
  const form = page.getByRole("form", { name: "New booking" });
  await form.getByLabel("Find a client").fill(`${PREFIX}mae`);
  await form.getByRole("list", { name: "Matching clients" }).getByRole("button", { name: new RegExp(`${PREFIX}Mae Test`) }).click();
  await form.getByRole("group", { name: "Service 1" }).getByLabel("Service").selectOption({ label: "Women's Cut & Style" });
  await form.getByLabel("Repeat this visit").check();
  await form.getByLabel("Weeks between visits").fill("2");
  await form.getByLabel("Number of visits").fill("4");
  await form.getByRole("button", { name: "Check dates" }).click();

  const visits = form.getByRole("region", { name: "Visits in the series" });
  await expect(visits.getByTestId("series-summary")).toContainText("3 of 4 visits fit as planned.");
  const bad = visits.getByRole("listitem").filter({ hasText: "Doesn't fit" });
  await expect(bad).toContainText("The stylist already has a client then.");
  await expect(bad).toContainText("Denise suggests:");
  // Her first suggestion is picked: an hour later the same day.
  await expect(bad.getByRole("radio").first()).toBeChecked();
  await expect(bad.getByRole("radio").first()).toHaveAccessibleName(/Same day at 11am \(60 min later\)/);
  await form.getByRole("button", { name: "Book 4 visits" }).click();
  await expect(ui(page).getByRole("status").filter({ hasText: "Booked 4 visits." })).toBeVisible();

  const { data: booked } = await admin.from("appointments").select("starts_at, series_index, series_id").eq("client_id", (await admin.from("clients").select("id").eq("first_name", `${PREFIX}Mae`).single()).data!.id).order("starts_at");
  expect(booked!.map((r) => [r.series_index, r.starts_at.slice(0, 10)])).toEqual(DATES.map((d, i) => [i + 1, at(d, 12).toISOString().slice(0, 10)]));
  expect(new Set(booked!.map((r) => r.series_id)).size).toBe(1);
  expect(new Date(booked![2].starts_at)).toEqual(at(DATES[2], 11));

  // The visit shows it repeats.
  const block = column(page, "Bridget Callahan").getByRole("button", { name: new RegExp(`${PREFIX}Mae Test.*repeating`) });
  await expect(block).toBeVisible();
  await block.click();
  await expect(page.getByTestId("series-info")).toHaveText("Visit 1 of 4 · every 2 weeks");
});

test("moves and cancels this and following visits", async ({ page }) => {
  const client = await newClient("Ivy");
  const { data: s } = await admin.from("services").select("id").eq("name", "Women's Cut & Style").single();
  const { data: series } = await admin.from("appointment_series").insert({ business_id: B, location_id: L, client_id: client, interval_weeks: 2, occurrences: 4 }).select("id").single();
  for (const [i, d] of DATES.entries()) {
    const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: client, starts_at: at(d, 10).toISOString(), ends_at: at(d, 11).toISOString(), series_id: series!.id, series_index: i + 1 }).select("id").single();
    await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: s!.id, staff_id: BRIDGET, starts_at: at(d, 10).toISOString(), ends_at: at(d, 11).toISOString(), active_minutes: 60, price_cents: 0 });
  }

  // Drag the second visit an hour later: this and following.
  await openDay(page, DATES[1]);
  const block = column(page, "Bridget Callahan").getByRole("button", { name: new RegExp(`${PREFIX}Ivy Test`) });
  await block.scrollIntoViewIfNeeded();
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 8 + 60 * (await pxPerMinute(page)), { steps: 10 });
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: `Move ${PREFIX}Ivy Test's repeating visit` });
  await dialog.getByRole("button", { name: "This and following visits" }).click();
  await expect(ui(page).getByRole("status").filter({ hasText: "Changed 3 visits." })).toBeVisible();
  const times = async () => (await admin.from("appointments").select("starts_at, status").eq("series_id", series!.id).order("series_index")).data!;
  expect((await times()).map((r) => new Date(r.starts_at).getTime())).toEqual([at(DATES[0], 10), at(DATES[1], 11), at(DATES[2], 11), at(DATES[3], 11)].map((d) => d.getTime()));

  // Cancel the third and fourth.
  await openDay(page, DATES[2]);
  await column(page, "Bridget Callahan").getByRole("button", { name: new RegExp(`${PREFIX}Ivy Test`) }).click();
  const panel = page.getByRole("tabpanel", { name: "Booking details" });
  await moreAction(panel, "Cancel booking");
  const cancel = panel.getByRole("form", { name: "Cancel booking" });
  await cancel.getByLabel("Reason").selectOption("Client rescheduled");
  await cancel.getByLabel("This and following visits").check();
  await cancel.getByRole("button", { name: "Cancel booking" }).click();
  await expect.poll(async () => (await times()).map((r) => r.status)).toEqual(["booked", "booked", "canceled", "canceled"]);
});
