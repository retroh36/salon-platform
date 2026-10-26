// Booking by asking Denise, in her bubble on a page other than the
// calendar: the form she shows without Claude (the test server has no key),
// the client's alerts, the best times from the booking rules, Book and
// Confirm in one step, Open in booking form, alternatives and the waitlist,
// two clients with the same name, and a new client. Her reading of the line
// and the follow-ups ("anything later?") are tested with Claude mocked in
// tests/unit/denise-booking.test.ts.
import type { Locator, Page } from "@playwright/test";
import { addDays, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, waitForHydration } from "./fixtures";

const B = SEED.business;
const TZ = "America/Chicago";
// A Tuesday past the seeded nine days ahead, so Bridget's afternoon is
// clear (she works 2–6), and the Sunday that week (the salon is closed).
const MONDAY = startOfWeek(todayIn(TZ));
const DAY = addDays(MONDAY, 36);
const SUNDAY = addDays(MONDAY, 41);
// Letters only: a client's name has no digits.
const PREFIX = `Db${Date.now().toString(36).replace(/\d/g, (d) => "abcdefghij"[Number(d)])}`;
const PAT = `${PREFIX}Pat`;
const TWIN = `${PREFIX}Twin`;

let clientId: string;
const serviceId = async (name: string) => (await admin.from("services").select("id").eq("business_id", B).eq("name", name).single()).data!.id;

test.beforeAll(async () => {
  const { data } = await admin
    .from("clients")
    .insert([
      { business_id: B, first_name: PAT, last_name: "Test", phone: "(312) 555-0198" },
      { business_id: B, first_name: TWIN, last_name: "Same", phone: "(312) 555-0111" },
      { business_id: B, first_name: TWIN, last_name: "Same", phone: "(312) 555-0122" },
    ])
    .select("id, first_name");
  clientId = data!.find((c) => c.first_name === PAT)!.id;
});

test.afterAll(async () => {
  const { data } = await admin.from("clients").select("id").like("first_name", `${PREFIX}%`);
  for (const c of data ?? []) {
    await admin.from("waitlist_entries").delete().eq("client_id", c.id);
    await admin.from("appointments").delete().eq("client_id", c.id);
  }
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

test.use({ storageState: AUTH.frontDesk });

// Denise's bubble on the Clients page, opened, with a line sent.
async function ask(page: Page, line: string): Promise<Locator> {
  await page.goto("/clients");
  await waitForHydration(page, "[data-testid=denise-bubble-launcher]");
  await page.getByTestId("denise-bubble-launcher").click();
  const bubble = page.getByRole("complementary", { name: "Denise" });
  await bubble.getByRole("textbox", { name: "Message Denise" }).fill(line);
  await bubble.getByRole("button", { name: "Send" }).click();
  return bubble;
}

// The form she shows without Claude: the day and part of it, then Find times.
async function findTimes(bubble: Locator, opts: { service?: string; stylist?: string; day: string; part?: string }) {
  const form = bubble.getByTestId("booking-form").last();
  await expect(form).toBeVisible();
  if (opts.service) await form.getByLabel("Service").selectOption(await serviceId(opts.service));
  if (opts.stylist) await form.getByLabel("Stylist").selectOption(opts.stylist);
  await form.getByLabel(/^Day/).fill(opts.day);
  if (opts.part) await form.getByRole("radio", { name: opts.part }).click();
  await form.getByRole("button", { name: "Find times" }).click();
  return bubble.getByTestId("booking-card").last();
}

test("without Denise reading it, a form from the line finds the best times; Book and Confirm in one step", async ({ page }) => {
  const bubble = await ask(page, `${PAT} Test wants a Women's Cut & Style with Bridget`);
  await expect(bubble.getByRole("region", { name: "Conversation with Denise" })).toContainText("I'm offline right now");
  // What our code could tell from the line is filled in.
  const form = bubble.getByTestId("booking-form");
  await expect(form.getByLabel("Service")).toHaveValue(await serviceId("Women's Cut & Style"));
  await expect(form.getByLabel("Stylist")).toHaveValue(SEED.staff.bridget);
  await expect(form).toContainText(`${PAT} Test`);

  const card = await findTimes(bubble, { day: DAY, part: "Afternoon" });
  await expect(card.getByTestId("booking-alerts")).toContainText("No card on file");
  const slots = card.getByTestId("booking-slot");
  await expect(slots).toHaveCount(3);
  for (const s of await slots.all()) {
    await expect(s).toContainText("with Bridget");
    await expect(s.locator("p").nth(2)).not.toBeEmpty();
  }
  await expect(slots.first().locator("p").first()).toHaveText(/(noon|(1|2|3|4|5)(:\d\d)?pm)–/);

  await slots.first().getByRole("button", { name: "Book", exact: true }).click();
  const confirm = card.getByTestId("booking-confirm");
  await expect(confirm).toContainText("Women's Cut & Style with Bridget");
  await expect(confirm.getByTestId("booking-policy")).not.toContainText("Checking");
  await confirm.getByRole("button", { name: "Confirm booking" }).click();
  const done = bubble.getByTestId("booking-outcome").last();
  await expect(done).toContainText("Booked");
  await expect(done.getByRole("link", { name: "Open booking" })).toHaveAttribute("href", new RegExp(`/calendar\\?date=${DAY}&open=`));

  const { data: visits } = await admin.from("appointments").select("id, appointment_items(staff_id)").eq("client_id", clientId).eq("status", "booked");
  expect(visits).toHaveLength(1);
  expect(visits![0].appointment_items[0].staff_id).toBe(SEED.staff.bridget);
});

test("shows the client's alerts on the card", async ({ page }) => {
  const bubble = await ask(page, "Maria Lopez wants a balayage");
  const card = await findTimes(bubble, { stylist: SEED.staff.bridget, day: DAY });
  const alerts = card.getByTestId("booking-alerts");
  await expect(alerts).toContainText("Latex allergy");
  await expect(alerts).toContainText("Card on file");
  await expect(alerts).toContainText("Last visit:");
});

test("Open in booking form opens the calendar's form, filled in", async ({ page }) => {
  const bubble = await ask(page, `${PAT} Test wants a blowout with Shae`);
  const card = await findTimes(bubble, { service: "Blowout", stylist: SEED.staff.shae, day: DAY });
  await card.getByTestId("booking-slot").first().getByRole("button", { name: "Open in booking form" }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?date=${DAY}`));
  const form = page.getByRole("form", { name: "New booking" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Date")).toHaveValue(DAY);
  await expect(form.getByText(`${PAT} Test`)).toBeVisible();
});

test("when nothing fits, offers another day and the waitlist", async ({ page }) => {
  const bubble = await ask(page, `${PAT} Test wants a Women's Cut & Style with Bridget`);
  const card = await findTimes(bubble, { day: SUNDAY });
  await expect(bubble.getByRole("region", { name: "Conversation with Denise" })).toContainText("Nothing fits");
  await expect(card.getByRole("heading", { name: "Another day" })).toBeVisible();
  await expect(card.getByTestId("booking-slot").first()).toContainText("with Bridget");
  await card.getByRole("button", { name: "Add to waitlist" }).click();
  await expect(bubble.getByTestId("booking-outcome").last()).toContainText(`${PAT} is on the waitlist.`);
  const { data: waiting } = await admin.from("waitlist_entries").select("staff_ids, from_date").eq("client_id", clientId);
  expect(waiting).toEqual([{ staff_ids: [SEED.staff.bridget], from_date: SUNDAY }]);
});

test("asks which client when two share a name", async ({ page }) => {
  const bubble = await ask(page, `${TWIN} Same wants a blowout`);
  await expect(bubble.getByRole("region", { name: "Conversation with Denise" })).toContainText("I found two clients called");
  const which = bubble.getByTestId("booking-which");
  await expect(which.getByRole("button")).toHaveCount(2);
  await which.getByRole("button", { name: /555-0122/ }).click();
  await expect(bubble.getByTestId("booking-outcome").first()).toContainText(`For ${TWIN} Same.`);
  // Then the times (or the form) for that one.
  await expect(bubble.getByTestId("booking-card").or(bubble.getByTestId("booking-form")).last()).toBeVisible();
});

test("offers to add a client who isn't on file", async ({ page }) => {
  const name = `${PREFIX}Newbie`;
  const bubble = await ask(page, `${name} Grant wants a blowout`);
  await expect(bubble.getByRole("region", { name: "Conversation with Denise" })).toContainText(`${name} Grant isn't on file yet.`);
  const add = bubble.getByTestId("booking-new-client");
  await expect(add.getByLabel("First name")).toHaveValue(name);
  await expect(add.getByLabel("Last name")).toHaveValue("Grant");
  await add.getByLabel("Mobile").fill("(312) 555-0177");
  await add.getByRole("button", { name: "Add client" }).click();
  await expect(bubble.getByTestId("booking-outcome").first()).toContainText(`Added ${name} Grant.`);
  const { data } = await admin.from("clients").select("id").eq("business_id", B).eq("first_name", name);
  expect(data).toHaveLength(1);
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("ask Denise but don't book through her", async ({ page }) => {
    await page.goto("/my-day");
    await waitForHydration(page, "[data-testid=denise-bubble-launcher]");
    await page.getByTestId("denise-bubble-launcher").click();
    const bubble = page.getByRole("complementary", { name: "Denise" });
    await expect(bubble.getByRole("textbox", { name: "Message Denise" })).toHaveAttribute("placeholder", "Ask Denise…");
    await expect(bubble.getByRole("button", { name: "Book with the form" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Phone booking" })).toHaveCount(0);
  });
});
