import { chargeDuePayments } from "@/lib/events/billing";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { admin, SEED, signIn } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Bridal and events, stage 2: the desk sends the proposal, the client signs
// and pays the deposit on its page, a bridesmaid pays her own share by link,
// a scheduled payment that's declined is tried again and paid with a new
// card from the client, and an event is marked lost and reopened.

const TZ = "America/Chicago";
const PREFIX = `Ep${Date.now().toString(36)}`;
const EMAIL = `${PREFIX.toLowerCase()}@example.test`;
const ANA = `${PREFIX.toLowerCase()}.ana@example.test`;
const DATE = addDays(todayIn(TZ), 140);

let clientId: string;
let eventId: string;

async function lastLink(to: string): Promise<string> {
  const { data } = await admin.from("outbox_messages").select("body").eq("to_address", to).order("created_at", { ascending: false }).limit(1).single();
  return data!.body.match(/https?:\/\/\S+\/event\/[A-Za-z0-9_-]{43}/)![0].replace(/^https?:\/\/[^/]+/, "");
}

test.beforeAll(async () => {
  const { data: c } = await admin.from("clients").insert({ business_id: SEED.business, first_name: `${PREFIX}Mia`, last_name: "Rossi", email: EMAIL }).select("id").single();
  clientId = c!.id;
  const desk = await signIn("frontdesk@mapleandash.test");
  const { data: id, error } = await desk.rpc("save_event", {
    p_event_id: null!,
    p_input: {
      title: `${PREFIX} Rossi wedding`,
      client_id: clientId,
      event_date: DATE,
      ready_by: `${DATE}T19:00:00Z`,
      billing: "split",
      members: [
        { name: "Mia", party_role: "bride", package_id: "ee000000-0000-4000-8000-000000000001" },
        { name: "Ana", party_role: "bridesmaid", package_id: "ee000000-0000-4000-8000-000000000003", pays_own: true, email: ANA },
        { name: "Lu", party_role: "bridesmaid", package_id: "ee000000-0000-4000-8000-000000000002" },
      ],
      tasks: [],
    } as never,
  });
  if (error) throw error;
  eventId = id;
});

test.afterAll(async () => {
  await admin.from("events").delete().eq("id", eventId);
  await admin.from("outbox_messages").delete().in("to_address", [EMAIL, ANA]);
  await admin.from("clients").delete().eq("id", clientId);
});

test.use({ viewport: { width: 1440, height: 1100 } });

test.describe.serial("an event's proposal and payments", () => {
  test("the desk sends the proposal; the client signs and pays the deposit", async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH.frontDesk });
    await page.goto(`/events/${eventId}`);
    await waitForHydration(page, "form[aria-label='Send proposal'] button");
    const proposal = ui(page).getByRole("form", { name: "Send proposal" });
    await proposal.getByRole("radio", { name: "Email" }).click();
    await expect(proposal.getByLabel("Email address")).toHaveValue(EMAIL);
    await proposal.getByRole("button", { name: "Send proposal" }).click();
    await expect(proposal.getByRole("status")).toHaveText(`Proposal sent to ${EMAIL}.`);
    await page.reload();
    await expect(ui(page).getByText("Proposal sent", { exact: true })).toBeVisible();
    await expect(ui(page).getByTestId("proposal-status")).toContainText(`Sent to ${EMAIL}`);
    const total = await ui(page).getByTestId("event-total").textContent();

    // The client's page, signed out, on a phone.
    const client = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await client.goto(await lastLink(EMAIL));
    await waitForHydration(client, "input[autocomplete=name]");
    await expect(client.getByRole("heading", { name: `Hi ${PREFIX}Mia` })).toBeVisible();
    await expect(client.getByTestId("proposal-party").getByRole("listitem")).toHaveCount(3);
    await expect(client.getByTestId("proposal-total")).toContainText(total!);
    await expect(client.getByTestId("proposal-schedule")).toContainText("Deposit");
    await expect(client.getByTestId("proposal-terms")).toContainText("Maple & Ash");
    const pay = client.getByRole("button", { name: /^Agree and pay/ });
    await expect(pay).toBeDisabled();
    await client.getByLabel("Your full name, to sign").fill(`${PREFIX}Mia Rossi`);
    await client.getByLabel(/agree to the terms, and to my card/).check();
    await pay.click();
    await expect(client.getByTestId("event-booked")).toContainText("Thank you");
    await client.close();

    await page.reload();
    await expect(ui(page).getByText("Booked", { exact: true })).toBeVisible();
    await expect(ui(page).getByTestId("agreement")).toContainText(`Agreed by ${PREFIX}Mia Rossi`);
    await expect(ui(page).getByTestId("payments")).toContainText("Deposit");
    await expect(ui(page).getByTestId("payments")).toContainText("Paid");
    await expect(ui(page).getByTestId("payments")).toContainText("Balance");
    await page.close();
  });

  test("a bridesmaid pays her own share by link", async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH.frontDesk });
    await page.goto(`/events/${eventId}`);
    await waitForHydration(page, "[data-testid=paying-own] button");
    await ui(page).getByRole("button", { name: "Send pay link to Ana" }).click();
    const form = ui(page).getByRole("form", { name: "Pay link for Ana" });
    await form.getByRole("radio", { name: "Email" }).click();
    await expect(form.getByLabel("Email address")).toHaveValue(ANA);
    await form.getByRole("button", { name: "Send pay link" }).click();
    await expect(form.getByRole("status")).toHaveText(`Pay link sent to ${ANA}.`);

    const ana = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await ana.goto(await lastLink(ANA));
    await waitForHydration(ana, "form button[type=submit]");
    await expect(ana.getByRole("heading", { name: "Hi Ana" })).toBeVisible();
    await expect(ana.getByRole("region", { name: "Your share" })).toContainText("Bridesmaid hair + makeup");
    await ana.getByRole("button", { name: /^Pay \$/ }).click();
    await expect(ana.getByTestId("share-paid")).toContainText("Paid with Visa …4242");
    await ana.close();

    await page.reload();
    await expect(ui(page).getByTestId("paying-own")).toContainText("Paid");
    await page.close();
  });

  test("a declined payment is flagged, tried again, and paid with a new card from the client", async ({ browser }) => {
    const { data: final } = await admin.from("event_payments").select("id").eq("event_id", eventId).eq("kind", "final").eq("status", "scheduled").single();
    await admin.from("event_payments").update({ due_on: todayIn(TZ) }).eq("id", final!.id);
    await admin.from("events").update({ card_ref: "test_visa_0002", card_label: "Visa …0002" }).eq("id", eventId);
    await chargeDuePayments(admin, { businessId: SEED.business, paymentId: final!.id });

    const page = await browser.newPage({ storageState: AUTH.frontDesk });
    await page.goto("/events");
    await expect(ui(page).getByRole("alert")).toContainText(`${PREFIX} Rossi wedding`);
    await ui(page).getByRole("alert").getByRole("link", { name: `${PREFIX} Rossi wedding` }).click();
    await waitForHydration(page, "[data-testid=payments] button");
    await expect(ui(page).getByTestId("payments")).toContainText("Didn't go through: The card was declined");
    await ui(page).getByRole("button", { name: "Try again" }).click();
    await expect(ui(page).getByRole("alert").filter({ hasText: "It didn't go through again" })).toBeVisible();

    await ui(page).getByRole("button", { name: "Ask for another card" }).click();
    const form = ui(page).getByRole("form", { name: "Send card link" });
    await form.getByRole("radio", { name: "Email" }).click();
    await form.getByRole("button", { name: "Send card link" }).click();
    await expect(form.getByRole("status")).toHaveText(`Card link sent to ${EMAIL}.`);

    const client = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await client.goto(await lastLink(EMAIL));
    await waitForHydration(client, "form button[type=submit]");
    await expect(client.getByRole("region", { name: "Your payments" })).toContainText("didn't go through on Visa …0002");
    await client.getByRole("button", { name: /^Save card and pay/ }).click();
    await expect(client.getByTestId("card-updated")).toContainText("Visa …4242 is saved and paid what was due");
    await client.close();

    await page.reload();
    // The balance is paid; the second payment is still to come.
    await expect(ui(page).getByTestId("payments").getByRole("listitem").filter({ hasText: "Balance" })).toContainText("Paid");
    await expect(ui(page).getByTestId("payments").getByRole("listitem").filter({ hasText: "Second payment" })).toContainText("Due");
    await expect(ui(page).getByTestId("payments")).not.toContainText("Didn't go through");
    await page.close();
  });

  test("an event is marked lost with a reason, and reopened", async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH.frontDesk });
    await page.goto(`/events/${eventId}`);
    await waitForHydration(page, "main button");
    await ui(page).getByRole("button", { name: "Mark as lost" }).click();
    const form = ui(page).getByRole("form", { name: "Mark as lost" });
    await form.getByLabel("Why was it lost?").fill("Moved the wedding abroad");
    await form.getByRole("button", { name: "Mark as lost" }).click();
    await expect(ui(page).getByText("Lost: Moved the wedding abroad")).toBeVisible();
    await page.goto("/events");
    await expect(ui(page).getByTestId("column-lost")).toContainText("Moved the wedding abroad");
    await ui(page).getByTestId("column-lost").getByRole("link", { name: new RegExp(`${PREFIX} Rossi wedding`) }).click();
    await ui(page).getByRole("button", { name: "Reopen" }).click();
    await expect(ui(page).getByText("Inquiry", { exact: true })).toBeVisible();
    await page.goto("/events");
    await expect(ui(page).getByTestId("column-inquiry")).toContainText(`${PREFIX} Rossi wedding`);
    await page.close();
  });
});
