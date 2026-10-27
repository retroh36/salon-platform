import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { linkSnapshot, type LinkSnapshot } from "@/lib/payment-links";
import { EMPTY_TICKET, type Ticket } from "@/lib/ticket";
import { admin, SEED, signIn, throwawayStylist } from "../tests/db/helpers";
import { allowOfflineLogs, expect, putBackSales, test } from "./fixtures";

// Stock and sales this file uses are put back afterwards.
putBackSales();

// The client's own pages on a phone (pay by link, save a card, agree to an
// event proposal) when the connection drops just as they tap: the salon
// gets the request but the answer never comes back. The page says so
// instead of breaking, and tapping again never charges twice.

const B = SEED.business;
const L = SEED.location;
const PREFIX = `Co${Date.now().toString(36)}`;
const EMAIL = `${PREFIX.toLowerCase()}@example.test`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const NO_CONNECTION = "We couldn't reach the salon. Check your connection and try again: you won't be charged twice.";

let clientId: string;
let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
let eventId: string | null = null;

test.beforeAll(async () => {
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Pia`, last_name: "Test", email: EMAIL }).select("id").single();
  clientId = c!.id;
  // The visit is checked in now, when the demo calendar is busy.
  stylist = await throwawayStylist("Bridget");
});

test.afterAll(async () => {
  if (eventId) await admin.from("events").delete().eq("id", eventId);
  await admin.from("sales").delete().eq("client_id", clientId);
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("card_requests").delete().eq("client_id", clientId);
  await admin.from("client_cards").delete().eq("client_id", clientId);
  await admin.from("outbox_messages").delete().eq("to_address", EMAIL);
  await admin.from("clients").delete().eq("id", clientId);
  await stylist.remove();
});

test.use({ viewport: { width: 390, height: 844 } });

// The first time the form posts, the request reaches the salon but the
// answer is lost.
async function dropFirstAnswer(page: Page, path: string) {
  let dropped = false;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "POST" || dropped) return route.continue();
    dropped = true;
    await route.fetch();
    await route.abort("internetdisconnected");
  });
}

test("paying by link: it says the connection dropped, and paying again doesn't charge twice", async ({ page, pageErrors }) => {
  const { data: cut } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single();
  const start = new Date(Date.now() - 3_600_000);
  const end = new Date(start.getTime() + 3_600_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "checked_in" }).select("id").single();
  const { data: item } = await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: cut!.id, staff_id: stylist.id, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: 10000 })
    .select("id")
    .single();
  const ticket: Ticket = {
    ...EMPTY_TICKET,
    lines: [{ key: "k", kind: "service", appointmentItemId: item!.id, serviceId: cut!.id, name: "Women's Cut & Style", staffId: stylist.id, unitPriceCents: 10000, basePriceCents: 10000, priceReason: "", quantity: 1, discount: null, packageItemId: null }],
  };
  const desk = await signIn("frontdesk@mapleandash.test");
  const { data: draft } = await desk.from("sale_drafts").insert({ business_id: B, location_id: L, appointment_id: a!.id, client_id: clientId, ticket: ticket as never, created_by: SEED.staff.frontDesk }).select("id").single();
  const { data: biz } = await admin.from("businesses").select("tax_rate_services_bp, tax_rate_retail_bp").eq("id", B).single();
  const snapshot = linkSnapshot(ticket, { taxServicesBp: biz!.tax_rate_services_bp ?? 0, taxRetailBp: biz!.tax_rate_retail_bp ?? 0, member: null }, { appointmentId: a!.id, clientId }, [{ id: stylist.id, firstName: "Bridget" }], "Pia") as LinkSnapshot;
  const token = newToken();
  const { error } = await desk.rpc("create_payment_link", { p_draft_id: draft!.id, p_token_hash: sha256(token), p_snapshot: snapshot as never, p_amount_cents: snapshot.dueCents, p_channel: "email", p_to: EMAIL, p_hours: 24 });
  expect(error).toBeNull();

  await page.goto(`/pay/${token}`);
  await dropFirstAnswer(page, `/pay/${token}`);
  const pay = page.getByRole("button", { name: /^Pay \$/ });
  await pay.click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(NO_CONNECTION);
  // It went through the first time: tapping again says so.
  await pay.click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("This has already been paid. Thank you.");
  await page.reload();
  await expect(page.getByTestId("link-paid")).toContainText("Paid. Thank you.");

  const { data: sales } = await admin.from("sales").select("id, payments(amount_cents)").eq("client_id", clientId);
  expect(sales).toHaveLength(1);
  expect(sales![0].payments).toHaveLength(1);
  allowOfflineLogs(pageErrors);
});

test("saving a card: it says the connection dropped, and the card is saved once", async ({ page, pageErrors }) => {
  const desk = await signIn("frontdesk@mapleandash.test");
  const token = newToken();
  const { error } = await desk.rpc("create_card_request", { p_client_id: clientId, p_appointment_id: null!, p_token_hash: sha256(token), p_deposit_cents: 0, p_channel: "email", p_to: EMAIL, p_hours: 72 });
  expect(error).toBeNull();

  await page.goto(`/card/${token}`);
  await dropFirstAnswer(page, `/card/${token}`);
  await page.getByLabel(/I agree to the cancellation policy/).check();
  await page.getByRole("button", { name: "Save card" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(NO_CONNECTION);
  await page.getByRole("button", { name: "Save card" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("Your card is already saved. Thank you.");
  await page.reload();
  await expect(page.getByTestId("card-saved")).toBeVisible();
  expect((await admin.from("client_cards").select("id").eq("client_id", clientId)).data).toHaveLength(1);
  allowOfflineLogs(pageErrors);
});

test("agreeing to an event proposal: it says the connection dropped, and the deposit is taken once", async ({ page, pageErrors }) => {
  const desk = await signIn("frontdesk@mapleandash.test");
  const date = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
  const { data: id, error } = await desk.rpc("save_event", {
    p_event_id: null!,
    p_input: { title: `${PREFIX} wedding`, client_id: clientId, event_date: date, ready_by: `${date}T19:00:00Z`, billing: "main", members: [{ name: "Pia", party_role: "bride", package_id: "ee000000-0000-4000-8000-000000000001" }], tasks: [] } as never,
  });
  expect(error).toBeNull();
  eventId = id as string;
  const token = newToken();
  expect((await desk.rpc("send_event_proposal", { p_event_id: eventId!, p_token_hash: sha256(token), p_channel: "email", p_to: EMAIL, p_days: 14 })).error).toBeNull();

  await page.goto(`/event/${token}`);
  await dropFirstAnswer(page, `/event/${token}`);
  await page.getByLabel("Your full name, to sign").fill(`${PREFIX}Pia Test`);
  await page.getByLabel(/agree to the terms, and to my card/).check();
  const agree = page.getByRole("button", { name: /^Agree and pay/ });
  await agree.click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(NO_CONNECTION);
  await agree.click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("You've already agreed. Thank you.");

  const { data: deposits } = await admin.from("event_payments").select("kind, status").eq("event_id", eventId!).eq("kind", "deposit");
  expect(deposits).toEqual([{ kind: "deposit", status: "paid" }]);
  allowOfflineLogs(pageErrors);
});
