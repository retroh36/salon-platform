import { admin, makeRoom, SEED } from "../tests/db/helpers";
import { addDays, fromLocal, todayIn } from "../lib/scheduling/time";
import { AUTH, expect, moreAction, test, ui, waitForHydration } from "./fixtures";
import type { Page } from "@playwright/test";

// Message client: quick picks and free text, through the consent rules.
// A marketing opt-out never stops messages about a visit; a STOP on texts
// does, and those messages go by email instead; owners choose who can
// write their own. Denise never writes these.

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const DAY = addDays(todayIn(TZ), 1);
const PREFIX = `Msg${Date.now().toString(36)}`;
// Its own number, so a STOP here touches nobody else.
const DIGITS = `312555${String(Date.now() % 10_000).padStart(4, "0")}`;
const PHONE = `(${DIGITS.slice(0, 3)}) ${DIGITS.slice(3, 6)}-${DIGITS.slice(6)}`;
let clientId: string;
let visitId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await admin.from("sms_suppressions").delete().eq("phone_digits", DIGITS);
  const { data: c } = await admin
    .from("clients")
    .insert({ business_id: B, first_name: `${PREFIX}Rae`, last_name: "Test", phone: PHONE, email: `${PREFIX.toLowerCase()}@example.com`, sms_opt_in: false, email_opt_in: false })
    .select("id")
    .single();
  clientId = c!.id;
  const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single();
  const start = fromLocal(DAY, 10 * 60, TZ)!;
  const end = new Date(start.getTime() + 3_600_000);
  // The demo calendar may have Bridget busy then; the database refuses a double-booking.
  await makeRoom(SEED.staff.bridget, start, end);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "booked" }).select("id").single();
  visitId = a!.id;
  await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: visitId, service_id: s!.id, staff_id: SEED.staff.bridget, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: 8_500 });
});

test.afterAll(async () => {
  await admin.from("sms_suppressions").delete().eq("phone_digits", DIGITS);
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("businesses").update({ free_text_roles: ["manager", "front_desk", "stylist"] }).eq("id", B);
});

const panel = (page: Page) => page.getByRole("tabpanel", { name: "Booking details" });

async function openVisit(page: Page) {
  await page.goto(`/calendar?date=${DAY}&open=${visitId}`);
  await waitForHydration(page, "section[data-staff-id]");
  await expect(panel(page).getByTestId("client-name")).toHaveText(`${PREFIX}Rae Test`);
}

const lastSent = async (channel: "sms" | "email") =>
  (await admin.from("outbox_messages").select("to_address, subject, body").eq("channel", channel).eq("to_address", channel === "sms" ? DIGITS : `${PREFIX.toLowerCase()}@example.com`).order("created_at", { ascending: false }).limit(1).maybeSingle()).data;

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("sends a quick pick and their own words by text, counting past 160; offers need a yes, visit messages don't", async ({ page }) => {
    await openVisit(page);
    await moreAction(panel(page), "Message client");
    const form = panel(page).getByRole("form", { name: "Message client" });
    // No to offers, but messages about the visit still go.
    await expect(form.getByRole("radio", { name: "An offer" })).toBeDisabled();

    await form.getByRole("combobox", { name: /^Message/ }).selectOption({ label: "Please call us" });
    await expect(form.getByTestId("message-preview")).toContainText(`Hi ${PREFIX}Rae, Maple & Ash Hair Studio here. Please give us a call`);
    await expect(form.getByTestId("message-preview")).toContainText("Reply STOP to stop texts.");
    await form.getByRole("button", { name: "Send" }).click();
    await expect(panel(page).getByTestId("message-sent")).toHaveText("Sent by text.");
    expect((await lastSent("sms"))!.body).toMatch(/Please give us a call at .+ about your visit .+ Reply STOP to stop texts\.$/);

    // Their own words: the counter warns once it's more than one text.
    await moreAction(panel(page), "Message client");
    await form.getByRole("combobox", { name: /^Message/ }).selectOption({ label: "Write my own" });
    await form.getByLabel("Your message").fill("Hi Rae, could you bring a photo of the color you'd like?");
    await expect(form.getByTestId("sms-counter")).toContainText("/ 160");
    await form.getByLabel("Your message").fill("Hi Rae, could you bring a photo of the color you'd like? ".repeat(3).trim());
    await expect(form.getByTestId("sms-counter")).toContainText("sends as 2 texts");
    await form.getByRole("button", { name: "Send" }).click();
    await expect(panel(page).getByTestId("message-sent")).toHaveText("Sent by text.");
    const { data: logged } = await admin.from("client_messages").select("template, sent_by, purpose").eq("client_id", clientId).order("created_at", { ascending: false }).limit(1).single();
    expect(logged).toEqual({ template: "custom", sent_by: SEED.staff.frontDesk, purpose: "appointment" });
  });

  test("after the client replies STOP, the visit says no texts and messages go by email", async ({ page }) => {
    // The client replies STOP to the text (the dev outbox plays their phone).
    await page.goto(`/dev/outbox?to=${DIGITS}`);
    const reply = page.getByTestId("outbox-message").filter({ has: page.getByTestId("outbox-to").getByText(DIGITS, { exact: true }) }).first();
    await reply.getByRole("button", { name: "Reply STOP" }).click();
    // Our fixed reply goes back to their number.
    await expect(page.getByTestId("outbox-message").filter({ hasText: "You're unsubscribed from texts" }).filter({ has: page.getByTestId("outbox-to").getByText(DIGITS, { exact: true }) })).toHaveCount(1);

    await openVisit(page);
    await expect(panel(page).getByTestId("no-texts")).toHaveText("No texts — call or email");
    await moreAction(panel(page), "Message client");
    const form = panel(page).getByRole("form", { name: "Message client" });
    await expect(form.getByRole("radio", { name: "Text" })).toBeDisabled();
    await expect(form.getByRole("radio", { name: "Email" })).toBeChecked();
    await form.getByRole("combobox", { name: /^Message/ }).selectOption({ label: "Reminder" });
    await form.getByRole("button", { name: "Send" }).click();
    await expect(panel(page).getByTestId("message-sent")).toHaveText("Sent by email.");
    expect((await lastSent("email"))!.subject).toBe("Your visit at Maple & Ash Hair Studio");

    // The profile has it all, with where it came from.
    await page.goto(`/clients/${clientId}`);
    const card = ui(page).getByTestId("client-messages");
    await expect(card.getByTestId("no-texts")).toContainText("No texts — call or email");
    await card.getByText("Consent history").click();
    await expect(card.getByTestId("consent-history")).toContainText("Appointment texts off: replied STOP");
    await expect(card.getByTestId("sent-messages")).toContainText("Reminder by email");
  });
});

test.describe("owner and stylist", () => {
  test("owners turn off free text for stylists; quick picks stay", async ({ browser }) => {
    const owner = await browser.newPage({ storageState: AUTH.owner });
    await owner.goto("/settings/messages");
    const stylists = ui(owner).getByRole("checkbox", { name: "Stylists" });
    await expect(stylists).toBeChecked();
    await stylists.uncheck();
    await expect(ui(owner).getByRole("status")).toHaveText("Saved.");
    await owner.close();

    const bridget = await browser.newPage({ storageState: AUTH.stylist });
    await bridget.goto(`/calendar?date=${DAY}&open=${visitId}`);
    await waitForHydration(bridget, "section[data-staff-id]");
    await moreAction(panel(bridget), "Message client");
    const select = panel(bridget).getByRole("form", { name: "Message client" }).getByRole("combobox", { name: /^Message/ });
    await expect(select.locator("option")).not.toContainText(["Write my own"]);
    await expect(select).toHaveValue("please_call");
    await bridget.close();
  });
});
