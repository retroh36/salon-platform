// "Mark … out": from the stylist's column (or Denise), the panel beside the
// calendar plans where each client goes as the time out changes, a client
// can be changed, it's applied all at once, the clients are messaged and
// it's undone.
import type { Locator, Page } from "@playwright/test";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { askOnCalendar, AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, sandra: SANDRA, frontDesk: FRONT_DESK } = SEED.staff;
// A Tuesday past the seeded nine days ahead (and the other calendar tests'
// days). Bridget works 9-1 and 2-6, Sandra (a Master too) 9-5.
const DAY = addDays(startOfWeek(todayIn(TZ)), 50);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const PREFIX = `Rs${Date.now().toString(36)}`;
const made: { clients: string[]; visits: string[] } = { clients: [], visits: [] };

// `imported`: kept as it came, the one exemption from the database's no
// double-booking rule, for two clients booked with Bridget at once.
async function visit(firstName: string, service: string, start: Date, imported = false) {
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}${firstName}`, last_name: "Test", phone: "(312) 555-0197", appointment_sms_ok: true }).select("id").single();
  made.clients.push(c!.id);
  const { data: s } = await admin.from("services").select("id, active_minutes, processing_minutes, finishing_minutes, duration_minutes, price_cents").eq("business_id", B).eq("name", service).single();
  const end = new Date(start.getTime() + s!.duration_minutes! * 60_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: c!.id, starts_at: start.toISOString(), ends_at: end.toISOString(), created_by: FRONT_DESK }).select("id").single();
  made.visits.push(a!.id);
  const { error } = await admin.from("appointment_items").insert({
    business_id: B,
    location_id: L,
    appointment_id: a!.id,
    service_id: s!.id,
    staff_id: BRIDGET,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    active_minutes: s!.active_minutes,
    processing_minutes: s!.processing_minutes,
    finishing_minutes: s!.finishing_minutes,
    price_cents: s!.price_cents,
    imported,
  });
  if (error) throw error;
  return a!.id;
}

const staffOf = async (appointmentId: string) => (await admin.from("appointment_items").select("staff_id").eq("appointment_id", appointmentId).single()).data!.staff_id;

async function clearOut() {
  const { data } = await admin.from("schedule_disruptions").select("id, time_off_id").eq("staff_id", BRIDGET).eq("on_date", DAY);
  await admin.from("ai_actions").delete().like("subject", `rescue:${BRIDGET}:${DAY}:%`);
  await admin.from("schedule_disruptions").delete().in("id", (data ?? []).map((d) => d.id));
  await admin.from("staff_time_off").delete().in("id", (data ?? []).flatMap((d) => (d.time_off_id ? [d.time_off_id] : [])));
}

// Each test's own visits (the database never double-books Bridget).
async function clearVisits() {
  await admin.from("client_messages").delete().in("appointment_id", made.visits);
  await admin.from("appointments").delete().in("id", made.visits);
  await admin.from("clients").delete().in("id", made.clients);
  made.visits.length = 0;
  made.clients.length = 0;
}

test.beforeEach(async () => {
  await clearOut();
  await clearVisits();
});
test.afterAll(async () => {
  await clearVisits();
  await clearOut();
});

test.use({ storageState: AUTH.frontDesk });

async function openDay(page: Page) {
  await page.goto(`/calendar?date=${DAY}`);
  await waitForHydration(page, "section[data-staff-id]");
}

async function openPanel(page: Page) {
  await ui(page).getByRole("button", { name: "More for Bridget Callahan" }).click();
  await page.getByRole("menu", { name: "Bridget's day" }).getByRole("menuitem", { name: "Mark Bridget out…" }).click();
  const panel = page.getByRole("region", { name: "Mark Bridget out" });
  await expect(panel.getByRole("heading", { name: "Bridget is out" })).toBeVisible();
  return panel;
}

const rowOf = (panel: Locator, name: string) => panel.getByTestId("out-row").filter({ hasText: `${PREFIX}${name} Test` });

async function change(panel: Locator, name: string, choice: string | RegExp) {
  await rowOf(panel, name).getByRole("button", { name: `Change ${PREFIX}${name}'s plan` }).click();
  await panel.getByRole("menu", { name: `Where ${PREFIX}${name} goes` }).getByRole("menuitemradio", { name: choice }).click();
}

test("plans every client as the time out changes, applies it all, messages them and undoes it", async ({ page }) => {
  const ava = await visit("Ava", "Balayage", at(9));
  const ben = await visit("Ben", "Women's Cut & Style", at(15));
  await openDay(page);
  const panel = await openPanel(page);

  // All day: both, Ava to Sandra at the same time (the same level), shown
  // dashed on the calendar with Bridget's column hatched.
  await expect(panel.getByTestId("out-denise")).toHaveText("2 clients need a new spot. Here's my plan.");
  await expect(panel.getByRole("radio", { name: "All day" })).toHaveAttribute("aria-checked", "true");
  await expect(rowOf(panel, "Ava").getByTestId("out-choice")).toHaveText("Moves to Sandra, same time");
  await expect(rowOf(panel, "Ava")).toContainText("Move");
  await expect(rowOf(panel, "Ava")).toContainText("Same level");
  await expect(ui(page).getByRole("region", { name: /^Sandra/ }).locator("[data-fix-ghost]")).toContainText(`${PREFIX}Ava`);
  await expect(ui(page).getByRole("region", { name: "Bridget Callahan" }).locator("[data-out-preview]")).toBeVisible();

  // Leaving at 1pm: only Ben; coming in at 11am: only Ava.
  await panel.getByRole("radio", { name: "Leaving early…" }).click();
  await expect(panel.getByRole("button", { name: /Leaves at 1pm/ })).toBeVisible();
  await expect(panel.getByTestId("out-row")).toHaveCount(1);
  await expect(rowOf(panel, "Ben")).toBeVisible();
  await expect(panel.getByTestId("out-denise")).toHaveText("1 client needs a new spot. Here's my plan.");
  await panel.getByRole("radio", { name: "Coming in late…" }).click();
  await expect(panel.getByTestId("out-row")).toHaveCount(1);
  await expect(rowOf(panel, "Ava")).toBeVisible();
  await panel.getByRole("radio", { name: "All day" }).click();
  await expect(panel.getByTestId("out-row")).toHaveCount(2);

  // Ben: leave him for a call instead.
  await change(panel, "Ben", "Leave it and call the client");
  await expect(rowOf(panel, "Ben")).toContainText("Call");
  await expect(panel.getByTestId("out-summary")).toContainText("1 move");
  await expect(panel.getByTestId("out-summary")).toContainText("1 to call");

  await panel.getByRole("button", { name: "Apply plan · 1 client" }).click();
  await expect(panel.getByText("Plan applied")).toBeVisible();
  expect(await staffOf(ava)).toBe(SANDRA);
  expect(await staffOf(ben)).toBe(BRIDGET);
  const { data: out } = await admin.from("schedule_disruptions").select("ends_at").eq("staff_id", BRIDGET).eq("on_date", DAY).single();
  expect(out!.ends_at).toBeNull();

  // A message for each: Ava's new stylist, Ben's call to move.
  const messages = panel.getByTestId("out-message");
  const avaMessage = messages.filter({ hasText: `${PREFIX}Ava Test` });
  await expect(avaMessage.getByRole("textbox")).toHaveValue(/Bridget is out, so Sandra will look after you .* instead\./);
  await expect(messages.filter({ hasText: `${PREFIX}Ben Test` }).getByRole("textbox")).toHaveValue(/We need to move your visit/);
  await avaMessage.getByRole("button", { name: "Send" }).click();
  await expect(avaMessage).toContainText("Sent");
  const { data: sent } = await admin.from("client_messages").select("template, sent_by").eq("appointment_id", ava);
  expect(sent).toEqual([{ template: "stylist_out_covered", sent_by: FRONT_DESK }]);

  // Undo: back with Bridget, still marked out, the plan on offer again.
  await panel.getByRole("button", { name: "Undo all" }).click();
  await expect(panel.getByRole("button", { name: /^Apply plan/ })).toBeVisible();
  expect(await staffOf(ava)).toBe(BRIDGET);
  await expect(panel.getByRole("radio", { name: "All day" })).toBeDisabled();
});

test("flags two clients given the same stylist at the same time", async ({ page }) => {
  await visit("Cara", "Balayage", at(9));
  await visit("Dee", "Balayage", at(9), true);
  await openDay(page);
  const panel = await openPanel(page);
  await expect(rowOf(panel, "Cara").getByTestId("out-choice")).toHaveText("Moves to Sandra, same time");
  // Both on Sandra at 9: the second clashes.
  await change(panel, "Dee", /^Moves to Sandra, same time/);
  await expect(rowOf(panel, "Dee")).toContainText("Clashes");
  await expect(panel.getByRole("button", { name: /^Apply plan/ })).toBeDisabled();
});

test("coming in late with nobody booked then: marked out, no clients affected", async ({ page }) => {
  await visit("Eve", "Women's Cut & Style", at(15));
  await openDay(page);
  const panel = await openPanel(page);
  await panel.getByRole("radio", { name: "Coming in late…" }).click();
  await panel.getByRole("button", { name: /Comes in at 11am/ }).click();
  await page.getByRole("option", { name: "Comes in at noon" }).click();
  await expect(panel.getByTestId("out-denise")).toHaveText("No clients need a new spot then.");
  await panel.getByRole("button", { name: "Mark Bridget out" }).click();
  await expect(panel.getByText("Bridget is marked out. No clients affected.")).toBeVisible();
  const { data: out } = await admin.from("schedule_disruptions").select("starts_at, ends_at, time_off:staff_time_off(start_minute, end_minute)").eq("staff_id", BRIDGET).eq("on_date", DAY).single();
  expect(new Date(out!.ends_at!).getTime()).toBe(at(12).getTime());
  expect(out!.time_off).toMatchObject({ start_minute: 0, end_minute: 12 * 60 });
});

test("Denise opens the panel when told someone has to leave early", async ({ page }) => {
  await openDay(page);
  await askOnCalendar(page, "Bridget has to leave at 1");
  const conversation = page.getByRole("region", { name: "Conversation with Denise" });
  await expect(conversation).toContainText("Sorry to hear Bridget is out from 1pm");
  await conversation.getByRole("link", { name: "Mark Bridget out" }).click();
  const panel = page.getByRole("region", { name: "Mark Bridget out" });
  await expect(panel.getByRole("radio", { name: "Leaving early…" })).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByRole("button", { name: /Leaves at 1pm/ })).toBeVisible();
});
