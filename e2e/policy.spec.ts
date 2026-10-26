import { admin, busyDay, makeRoom, SEED } from "../tests/db/helpers";
import { runPolicyCharges } from "../lib/policy-billing";
import { todayIn } from "../lib/scheduling/time";
import { AUTH, expect, moreAction, test, ui, waitForHydration } from "./fixtures";

// The cancellation policy at the desk (the demo salon: a card for new
// clients, 48 hours' notice, $40 to cancel late, half the visit for a
// no-show): a card link to a new client, the fee on a no-show charged by
// itself, a waiver with a reason, a late cancel, and the Policy page.

const B = SEED.business;
const L = SEED.location;
const PREFIX = `Pc${Date.now().toString(36)}`;
const TZ = "America/Chicago";
const ids: string[] = [];
// Demo visits set aside to make room for the test's own (put back after).
const putBack: (() => Promise<void>)[] = [];

async function newClient(name: string, phone: string) {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}${name}`, last_name: "Test", phone }).select("id").single();
  ids.push(data!.id);
  return data!.id;
}

// A visit with Bridget, booked directly (the calendar's rules aren't what's
// tested here), `hours` from now.
async function visit(clientId: string, hours: number, status: "booked" | "confirmed" = "booked") {
  const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single();
  const start = new Date(Math.round((Date.now() + hours * 3_600_000) / 900_000) * 900_000);
  const end = new Date(start.getTime() + 3_600_000);
  // The database refuses a double-booking with the demo calendar.
  putBack.push(await makeRoom(SEED.staff.bridget, start, end));
  const { data: a } = await admin
    .from("appointments")
    .insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString(), status, created_at: new Date(Date.now() - 20 * 86_400_000).toISOString() })
    .select("id")
    .single();
  await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: s!.id, staff_id: SEED.staff.bridget, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: 10000 });
  return { id: a!.id, date: todayIn(TZ) === start.toLocaleDateString("en-CA", { timeZone: TZ }) ? todayIn(TZ) : start.toLocaleDateString("en-CA", { timeZone: TZ }) };
}

async function addCard(clientId: string, ref = "test_visa_4242", label = "Visa …4242") {
  const { data: consent } = await admin.from("policy_consents").insert({ business_id: B, client_id: clientId, policy_text: "Test policy", terms: {}, channel: "link" }).select("id").single();
  await admin.from("client_cards").insert({ business_id: B, client_id: clientId, provider: "test", payment_method_ref: ref, label, consent_id: consent!.id });
}

async function openVisit(page: import("@playwright/test").Page, v: { id: string; date: string }) {
  await page.goto(`/calendar?date=${v.date}&open=${v.id}`);
  await waitForHydration(page, "section[data-staff-id]");
  const panel = page.getByRole("tabpanel", { name: "Booking details" });
  await expect(panel).toBeVisible();
  return panel;
}

test.afterAll(async () => {
  if (!ids.length) return;
  await admin.from("policy_fees").delete().in("client_id", ids);
  await admin.from("card_requests").delete().in("client_id", ids);
  await admin.from("client_cards").delete().in("client_id", ids);
  await admin.from("policy_consents").delete().in("client_id", ids);
  await admin.from("appointments").delete().in("client_id", ids);
  await admin.from("clients").delete().in("id", ids);
  for (const back of putBack) await back();
});

test.use({ storageState: AUTH.frontDesk });

test("a new client's booking needs a card: the desk sends a link, the client agrees and saves one", async ({ page, browser }) => {
  const clientId = await newClient("Cara", "(312) 555-0181");
  const v = await visit(clientId, 50);
  const panel = await openVisit(page, v);
  await expect(panel.getByTestId("card-needed")).toHaveText("Card needed to hold this booking");
  await panel.getByRole("button", { name: "Send card link" }).click();
  await expect(panel.getByLabel("Mobile number")).toHaveValue("(312) 555-0181");
  await panel.getByRole("button", { name: "Send link" }).click();
  await expect(panel.getByRole("status")).toHaveText("Card link sent to (312) 555-0181.");

  const { data: sent } = await admin.from("outbox_messages").select("body").eq("to_address", "(312) 555-0181").order("created_at", { ascending: false }).limit(1).single();
  const token = /\/card\/([A-Za-z0-9_-]{43})/.exec(sent!.body)![1];

  // On the client's phone, signed out.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const client = await phone.newPage();
  try {
    await client.goto(`/card/${token}`);
    await expect(client.getByTestId("policy")).toContainText("Canceling with less notice costs $40.");
    await expect(client.getByTestId("policy")).toContainText("Not showing up costs 50% of the visit ($50).");
    const save = client.getByRole("button", { name: "Save card" });
    await expect(save).toBeDisabled();
    await client.getByLabel(/I agree to the cancellation policy/).check();
    await save.click();
    await expect(client.getByTestId("card-saved")).toBeVisible();
    // The link works once.
    await client.reload();
    await expect(client.getByTestId("card-saved")).toBeVisible();
  } finally {
    await phone.close();
  }

  const card = (await admin.from("client_cards").select("label, consent:policy_consents(channel, policy_text)").eq("client_id", clientId).single()).data!;
  expect(card).toMatchObject({ label: "Visa …4242", consent: { channel: "link" } });
  expect(card.consent.policy_text).toContain("Canceling with less notice costs $40.");
  // Nothing on the desk's calendar still loading (the card link's action,
  // the refresh after it, Denise), so navigating away cuts nothing off.
  await page.waitForLoadState("networkidle");
  const again = await openVisit(page, v);
  await expect(again.getByTestId("policy-info")).toContainText("Visa …4242 on file");
  await expect(again.getByTestId("card-needed")).toHaveCount(0);
});

test("a no-show's fee is charged to the card by itself, with a receipt; a manager waives it and it's refunded", async ({ page, browser }) => {
  const clientId = await newClient("Nico", "(312) 555-0182");
  await addCard(clientId);
  const v = await visit(clientId, -1, "confirmed");
  const panel = await openVisit(page, v);
  await moreAction(panel, "Mark no-show");
  await expect(panel.getByTestId("no-show-fee")).toContainText("The no-show fee is $50");
  await panel.getByRole("group", { name: "Mark no-show" }).getByRole("button", { name: "Mark no-show" }).click();
  await expect(panel.getByTestId("policy-fee")).toHaveAttribute("data-fee-status", "pending");
  await expect(panel.getByTestId("policy-fee")).toContainText("No-show fee $50 · charging Visa …4242 in a few minutes");

  // Ten minutes on, the job charges it.
  const fee = (await admin.from("policy_fees").select("id").eq("appointment_id", v.id).single()).data!;
  await admin.from("policy_fees").update({ charge_after: new Date(Date.now() - 60_000).toISOString() }).eq("id", fee.id);
  expect(await runPolicyCharges(admin, { feeId: fee.id })).toMatchObject({ charged: 1 });
  const { data: receipt } = await admin.from("outbox_messages").select("body").eq("to_address", "(312) 555-0182").order("created_at", { ascending: false }).limit(1).single();
  expect(receipt!.body).toContain("$50");

  // The front desk can't waive (the salon lets owners and managers).
  const again = await openVisit(page, v);
  await expect(again.getByTestId("policy-fee")).toContainText("No-show fee $50 · charged to Visa …4242");
  await expect(again.getByTestId("policy-fee").getByRole("button", { name: /Waive/ })).toHaveCount(0);

  const manager = await browser.newContext({ storageState: AUTH.manager });
  const m = await manager.newPage();
  try {
    const mp = await openVisit(m, v);
    await mp.getByRole("button", { name: "Waive and refund…" }).click();
    await mp.getByLabel("Why are you waiving it?").fill("Family emergency");
    await mp.getByRole("button", { name: "Waive and refund" }).click();
    await expect(mp.getByTestId("policy-fee").getByRole("status")).toHaveText("Fee waived. It's being refunded to the card.");
  } finally {
    await manager.close();
  }
  await expect.poll(async () => (await admin.from("policy_fees").select("status, waive_reason, refunded_at").eq("id", fee.id).single()).data).toMatchObject({ status: "waived", waive_reason: "Family emergency", refunded_at: expect.any(String) });
});

test("a late cancel by the client shows the fee before canceling; a declined card is flagged on the Dashboard", async ({ page }) => {
  const clientId = await newClient("Lena", "(312) 555-0183");
  await addCard(clientId, "test_visa_0002", "Visa …0002");
  const v = await visit(clientId, 30);
  const panel = await openVisit(page, v);
  await moreAction(panel, "Cancel booking");
  const form = panel.getByRole("form", { name: "Cancel booking" });
  await form.getByLabel("Reason").selectOption("Stylist unavailable");
  await expect(form.getByTestId("late-cancel-fee")).toHaveCount(0);
  await form.getByLabel("Reason").selectOption("Client canceled");
  await expect(form.getByTestId("late-cancel-fee")).toContainText("It’s inside the 48-hour window: the late-cancellation fee is $40, charged to Visa …0002.");
  await form.getByRole("button", { name: "Cancel booking" }).click();
  await expect.poll(async () => (await admin.from("appointments").select("status").eq("id", v.id).single()).data!.status).toBe("canceled");

  const fee = (await admin.from("policy_fees").select("id").eq("appointment_id", v.id).single()).data!;
  await admin.from("policy_fees").update({ charge_after: new Date(Date.now() - 60_000).toISOString() }).eq("id", fee.id);
  expect(await runPolicyCharges(admin, { feeId: fee.id })).toMatchObject({ failed: 1 });

  await page.goto("/dashboard");
  const notices = ui(page).getByTestId("fee-notices");
  await expect(notices.getByRole("listitem").filter({ hasText: `${PREFIX}Lena` })).toContainText("Late cancellation fee · The card was declined");
  // The front desk sees no amounts there.
  await expect(notices.getByRole("listitem").filter({ hasText: `${PREFIX}Lena` })).not.toContainText("$");
});

test.describe("as the owner", () => {
  test.use({ storageState: AUTH.owner });

  test("the Policy page shows what was recovered, repeat offenders and card on file", async ({ page }) => {
    await page.goto("/policy");
    await expect(ui(page).getByRole("heading", { name: "Cancellation policy" })).toBeVisible();
    for (const id of ["policy-recovered", "policy-charged", "policy-waived", "policy-failed", "policy-card-share"]) await expect(ui(page).getByTestId(id)).toBeVisible();
    await expect(ui(page).getByTestId("policy-card-share")).toHaveText(/^\d+%$/);
    await expect(ui(page).getByTestId("offender").first()).toBeVisible();
    // Last month, from the demo history.
    await ui(page).getByRole("link", { name: "Previous" }).click();
    await expect(ui(page).getByTestId("policy-row").first()).toBeVisible();
  });

  test("the policy settings preview what clients will read", async ({ page }) => {
    await page.goto("/settings/policies");
    const preview = ui(page).getByTestId("policy-preview");
    await expect(preview).toContainText("at least 2 days' notice");
    await ui(page).getByLabel("Cancellation window (hours before the visit)").fill("24");
    await expect(preview).toContainText("at least 24 hours' notice");
    await ui(page).getByLabel("No-show fee").selectOption("fixed");
    await ui(page).getByLabel("No-show amount").fill("75");
    await expect(preview).toContainText("Not showing up costs a $75 fee.");
  });
});

test("Denise flags a repeat offender when the desk books them", async ({ page }) => {
  const clientId = await newClient("Remy", "(312) 555-0184");
  // Two no-shows in the last few months.
  for (const days of [40, 20]) {
    const { data: a } = await admin
      .from("appointments")
      .insert({ business_id: B, location_id: L, client_id: clientId, starts_at: new Date(Date.now() - days * 86_400_000).toISOString(), ends_at: new Date(Date.now() - days * 86_400_000 + 3_600_000).toISOString(), status: "booked" })
      .select("id")
      .single();
    await admin.from("policy_fees").insert({ business_id: B, location_id: L, appointment_id: a!.id, client_id: clientId, kind: "no_show", fee_cents: 5000, status: "charged", created_at: new Date(Date.now() - days * 86_400_000).toISOString() });
  }
  // A day the salon is open (today is closed on Sundays and Mondays).
  await page.goto(`/calendar?date=${(await busyDay()).date}`);
  await waitForHydration(page, "section[data-staff-id]");
  await ui(page).getByRole("button", { name: "New booking" }).click();
  const form = page.getByRole("tabpanel", { name: "Booking details" }).getByRole("form", { name: "New booking" });
  await form.getByLabel("Find a client").fill(`${PREFIX}remy`);
  await form.getByRole("list", { name: "Matching clients" }).getByRole("button", { name: new RegExp(`${PREFIX}Remy Test`) }).click();
  await expect(form.getByTestId("denise-policy")).toHaveText(/^Heads up: \w+Remy has 2 late cancellations or no-shows since \w+, so the salon asks for a 50% deposit\./, { timeout: 15_000 });
});
