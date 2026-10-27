// Sick-day rescue: from the stylist's column (or Denise), mark them out,
// review where each client goes, change a line, apply it all at once,
// message the clients and undo.
import type { Page } from "@playwright/test";
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

test("marks a stylist out, reviews every client, applies it all, messages them and undoes it", async ({ page }) => {
  const ava = await visit("Ava", "Balayage", at(9));
  const ben = await visit("Ben", "Women's Cut & Style", at(15));
  await openDay(page);
  await ui(page).getByRole("button", { name: "More for Bridget Callahan" }).click();
  await page.getByRole("dialog", { name: "Bridget's day" }).getByRole("link", { name: "Plan the rescue" }).click();

  const form = page.getByRole("form", { name: "Mark Bridget out" });
  await form.getByRole("radio", { name: "All day" }).click();
  await form.getByRole("button", { name: "Mark Bridget out" }).click();

  await expect(page.getByRole("heading", { name: "Bridget is out" })).toBeVisible();
  const rows = page.getByTestId("rescue-row");
  const avaRow = rows.filter({ hasText: `${PREFIX}Ava Test` });
  const benRow = rows.filter({ hasText: `${PREFIX}Ben Test` });
  await expect(avaRow.getByLabel("Where they go")).toHaveValue("0");
  await expect(avaRow).toContainText("Same time");
  await expect(avaRow.getByRole("option", { name: /^Sandra at 9am \(Same level/ })).toBeAttached();
  // Ben: leave him for a call instead.
  await benRow.getByLabel("Where they go").selectOption({ label: "Leave it and call the client" });
  await expect(benRow).toContainText("Call to rebook");

  await page.getByRole("button", { name: "Apply all (1 client)" }).click();
  await expect(page.getByText("The plan is applied")).toBeVisible();
  expect(await staffOf(ava)).toBe(SANDRA);
  expect(await staffOf(ben)).toBe(BRIDGET);

  // A message for each: Ava's new stylist, Ben's call to move.
  const messages = page.getByTestId("rescue-message");
  const avaMessage = messages.filter({ hasText: `${PREFIX}Ava Test` });
  await expect(avaMessage.getByRole("textbox")).toHaveValue(/Bridget is out, so Sandra will look after you .* instead\./);
  await expect(messages.filter({ hasText: `${PREFIX}Ben Test` }).getByRole("textbox")).toHaveValue(/We need to move your visit/);
  await avaMessage.getByRole("button", { name: "Send" }).click();
  await expect(avaMessage).toContainText("Sent");
  const { data: sent } = await admin.from("client_messages").select("template, sent_by").eq("appointment_id", ava);
  expect(sent).toEqual([{ template: "stylist_out_covered", sent_by: FRONT_DESK }]);

  await page.getByRole("button", { name: "Undo all" }).click();
  await expect(page.getByRole("button", { name: /^Apply all/ })).toBeVisible();
  expect(await staffOf(ava)).toBe(BRIDGET);
});

test("flags two clients given the same stylist at the same time", async ({ page }) => {
  await visit("Cara", "Balayage", at(9));
  await visit("Dee", "Balayage", at(9), true);
  await page.goto(`/calendar/rescue?staff=${BRIDGET}&date=${DAY}`);
  await page.getByRole("form", { name: "Mark Bridget out" }).getByRole("button", { name: "Mark Bridget out" }).click();
  const rows = page.getByTestId("rescue-row");
  const cara = rows.filter({ hasText: `${PREFIX}Cara Test` });
  const dee = rows.filter({ hasText: `${PREFIX}Dee Test` });
  await expect(cara.getByLabel("Where they go")).toHaveValue("0");
  // Both on Sandra at 9: the second line clashes.
  const sandraAt9 = await dee.getByRole("option", { name: /^Sandra at 9am \(Same level/ }).textContent();
  await dee.getByLabel("Where they go").selectOption({ label: sandraAt9!.trim() });
  await expect(dee).toContainText("Clashes with a line above");
  await expect(page.getByRole("button", { name: /^Apply all/ })).toBeDisabled();
});

test("Denise opens the rescue when told someone called out", async ({ page }) => {
  await openDay(page);
  await askOnCalendar(page, "Bridget has to leave at 1");
  const conversation = page.getByRole("region", { name: "Conversation with Denise" });
  await expect(conversation).toContainText("Sorry to hear Bridget is out from 1pm");
  await conversation.getByRole("link", { name: "Open sick-day rescue" }).click();
  const form = page.getByRole("form", { name: "Mark Bridget out" });
  await expect(form.getByRole("radio", { name: "From a time" })).toHaveAttribute("aria-checked", "true");
  await expect(form.getByLabel("Leaves at")).toHaveValue("13:00");
});
