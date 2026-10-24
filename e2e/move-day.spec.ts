import type { Page } from "@playwright/test";
import { formatDay, formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn, toLocal } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, moreAction, test, ui, waitForHydration } from "./fixtures";

// Moving a visit to another day: from "⋯" (every service together, with
// Denise's nearest times when it doesn't fit), from Edit booking's date,
// a repeating visit (this and following), and a group (everyone). Each
// move records notices to the client and stylists.

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, shae: SHAE, frontDesk: FRONT_DESK } = SEED.staff;
// Tuesdays clear of the other tests' days (Bridget 9-1 and 2-6, Shae 9-1 and 1:30-5:30).
const DAY = addDays(startOfWeek(todayIn(TZ)), 148);
const NEXT = addDays(DAY, 7);
const LATER = addDays(DAY, 14);
const PREFIX = `Mv${Date.now().toString(36)}`;
const at = (date: string, hour: number, minute = 0) => fromLocal(date, hour * 60 + minute, TZ)!;

async function clear() {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(DAY, 0).toISOString()).lt("starts_at", at(addDays(LATER, 2), 0).toISOString());
}
test.beforeEach(clear);
test.afterAll(async () => {
  await clear();
  await admin.from("appointment_groups").delete().like("label", `${PREFIX}%`);
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

test.use({ storageState: AUTH.frontDesk, viewport: { width: 1920, height: 1500 } });

async function newClient(firstName: string) {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}${firstName}`, last_name: "Test", phone: "(312) 555-0188" }).select("id").single();
  return data!.id;
}

async function seedVisit(clientId: string | null, items: { service: string; staff: string; start: Date }[], extra: Record<string, unknown> = {}) {
  const rows = await Promise.all(
    items.map(async (i) => ({ ...i, s: (await admin.from("services").select("id, active_minutes, processing_minutes, finishing_minutes, duration_minutes, price_cents").eq("business_id", B).eq("name", i.service).single()).data! })),
  );
  const end = Math.max(...rows.map((r) => r.start.getTime() + r.s.duration_minutes! * 60_000));
  const { data: a } = await admin
    .from("appointments")
    .insert({ business_id: B, location_id: L, client_id: clientId, starts_at: rows[0].start.toISOString(), ends_at: new Date(end).toISOString(), created_by: FRONT_DESK, ...extra })
    .select("id")
    .single();
  await admin.from("appointment_items").insert(
    rows.map((r) => ({
      business_id: B,
      location_id: L,
      appointment_id: a!.id,
      service_id: r.s.id,
      staff_id: r.staff,
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

// Where a visit's services are now: local date and time, by stylist.
async function where(id: string) {
  const { data } = await admin.from("appointment_items").select("staff_id, starts_at").eq("appointment_id", id).order("starts_at");
  return data!.map((i) => ({ staff: i.staff_id, ...toLocal(new Date(i.starts_at), TZ) }));
}

const panel = (page: Page) => page.getByRole("tabpanel", { name: "Booking details" });
const column = (page: Page, name: string) => ui(page).getByRole("region", { name, exact: true });

async function open(page: Page, date: string, stylist: string, name: RegExp) {
  await page.goto(`/calendar?date=${date}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(date));
  await waitForHydration(page, "section[data-staff-id]");
  await column(page, stylist).getByRole("button", { name }).first().click();
}

test("moves a visit to another day from ⋯, every service together, and tells the client and stylist", async ({ page }) => {
  const ava = await newClient("Ava");
  const id = await seedVisit(ava, [
    { service: "Women's Cut & Style", staff: BRIDGET, start: at(DAY, 10) },
    { service: "Blowout", staff: SHAE, start: at(DAY, 11) },
  ]);
  await open(page, DAY, "Bridget Callahan", new RegExp(`${PREFIX}Ava Test`));
  await moreAction(panel(page), "Move to another day");
  const form = panel(page).getByRole("form", { name: "Move to another day" });
  await expect(form).toContainText("Every service moves together, with the same stylists.");
  await form.getByLabel("Date").fill(NEXT);
  await form.getByLabel("Starts").fill("14:00");
  await form.getByRole("button", { name: "Move" }).click();

  // The calendar follows it there, with it open.
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(NEXT));
  await expect(page.getByTestId("client-name")).toHaveText(`${PREFIX}Ava Test`);
  expect(await where(id)).toEqual([
    { staff: BRIDGET, date: NEXT, minute: 14 * 60 },
    { staff: SHAE, date: NEXT, minute: 15 * 60 },
  ]);
  const { data: notices } = await admin.from("notifications").select("template, body, client_id, staff_id").eq("appointment_id", id).order("template");
  expect(notices!.map((n) => n.template)).toEqual(["staff_visit_moved", "visit_moved"]);
  const client = notices!.find((n) => n.template === "visit_moved")!;
  expect(client.client_id).toBe(ava);
  expect(client.body).toBe(`Hi ${PREFIX}Ava, it's Maple & Ash Hair Studio. Your appointment has moved from ${formatDay(DAY)} at 10am to ${formatDay(NEXT)} at 2pm, still with Bridget. Reply or call us if that doesn't work. See you soon!`);
});

test("when it doesn't fit, says why and offers the nearest times that day", async ({ page }) => {
  const id = await seedVisit(await newClient("Bea"), [{ service: "Women's Cut & Style", staff: BRIDGET, start: at(DAY, 10) }]);
  await seedVisit(await newClient("Cal"), [{ service: "Women's Cut & Style", staff: BRIDGET, start: at(NEXT, 10) }]);
  await open(page, DAY, "Bridget Callahan", new RegExp(`${PREFIX}Bea Test`));
  await moreAction(panel(page), "Move to another day");
  const form = panel(page).getByRole("form", { name: "Move to another day" });
  await form.getByLabel("Date").fill(NEXT);
  await form.getByLabel("Starts").fill("10:00");
  await form.getByRole("button", { name: "Move" }).click();
  await expect(form.getByRole("alert")).toContainText("That doesn't fit on");
  const ideas = form.getByTestId("denise-ideas");
  await expect(ideas).toContainText("That clashes with Bridget's 10am client.");
  await ideas.getByRole("button").first().click();
  await form.getByRole("button", { name: "Move" }).click();
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(NEXT));
  const [moved] = await where(id);
  expect(moved.date).toBe(NEXT);
  expect(moved.minute).not.toBe(10 * 60);
});

test("Edit booking's date moves it too", async ({ page }) => {
  const id = await seedVisit(await newClient("Dee"), [{ service: "Women's Cut & Style", staff: BRIDGET, start: at(DAY, 9) }]);
  await open(page, DAY, "Bridget Callahan", new RegExp(`${PREFIX}Dee Test`));
  await moreAction(panel(page), "Edit booking");
  const form = panel(page).getByRole("form", { name: "Edit booking" });
  await form.getByLabel("Date").fill(NEXT);
  await expect(form.getByTestId("moving-note")).toContainText(`to ${formatLongDay(NEXT, false)}`);
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(NEXT));
  expect(await where(id)).toEqual([{ staff: BRIDGET, date: NEXT, minute: 9 * 60 }]);
});

test("a repeating visit: this and following move by the same days", async ({ page }) => {
  const eve = await newClient("Eve");
  const { data: series } = await admin.from("appointment_series").insert({ business_id: B, location_id: L, client_id: eve, interval_weeks: 1, occurrences: 3 }).select("id").single();
  const ids = [];
  for (const [n, date] of [DAY, NEXT, LATER].entries()) {
    ids.push(await seedVisit(eve, [{ service: "Women's Cut & Style", staff: BRIDGET, start: at(date, 9) }], { series_id: series!.id, series_index: n + 1 }));
  }
  await open(page, NEXT, "Bridget Callahan", new RegExp(`${PREFIX}Eve Test`));
  await moreAction(panel(page), "Move to another day");
  const form = panel(page).getByRole("form", { name: "Move to another day" });
  await form.getByLabel("Date").fill(addDays(NEXT, 1));
  await form.getByLabel("Starts").fill("09:00");
  await form.getByLabel("This and following visits").check();
  await form.getByRole("button", { name: "Move" }).click();
  await expect(ui(page).getByRole("status").filter({ hasText: "Changed 2 visits." })).toBeVisible();
  expect((await where(ids[0]))[0].date).toBe(DAY);
  expect((await where(ids[1]))[0].date).toBe(addDays(NEXT, 1));
  expect((await where(ids[2]))[0].date).toBe(addDays(LATER, 1));
});

test("a group moves together", async ({ page }) => {
  const { data: group } = await admin.from("appointment_groups").insert({ business_id: B, location_id: L, label: `${PREFIX} party` }).select("id").single();
  const fay = await seedVisit(await newClient("Fay"), [{ service: "Women's Cut & Style", staff: BRIDGET, start: at(DAY, 10) }], { group_id: group!.id });
  const guest = await seedVisit(null, [{ service: "Women's Cut & Style", staff: SHAE, start: at(DAY, 10, 15) }], { group_id: group!.id });
  await open(page, DAY, "Bridget Callahan", new RegExp(`${PREFIX}Fay Test`));
  // Edit booking points to the move instead of splitting the group.
  await moreAction(panel(page), "Edit booking");
  await expect(panel(page).getByRole("form", { name: "Edit booking" })).toContainText("To move the whole group to another day, use Move to another day");
  await panel(page).getByRole("form", { name: "Edit booking" }).getByRole("button", { name: "Cancel" }).click();
  await moreAction(panel(page), "Move to another day");
  const form = panel(page).getByRole("form", { name: "Move to another day" });
  await expect(form).toContainText("The whole group moves with it.");
  await form.getByLabel("Date").fill(NEXT);
  await form.getByLabel("Starts").fill("11:00");
  await form.getByRole("button", { name: "Move" }).click();
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(NEXT));
  expect(await where(fay)).toEqual([{ staff: BRIDGET, date: NEXT, minute: 11 * 60 }]);
  expect(await where(guest)).toEqual([{ staff: SHAE, date: NEXT, minute: 11 * 60 + 15 }]);
});
