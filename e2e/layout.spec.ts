// The finished look, checked on every refined screen at a phone (390), an
// iPad (1180) and a laptop (1440), with Denise open too: no text cut off,
// spilling out or covered, and no sideways page scroll (`expectTidyLayout`).
// A client with a long name booked for a long-titled service is the worst
// case for each screen, on the staff app and on the pages clients open.
import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { linkSnapshot, type LinkSnapshot } from "@/lib/payment-links";
import { EMPTY_TICKET, type Ticket } from "@/lib/ticket";
import { formatLongDay } from "@/lib/schedule-format";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, busyDay, makeRoom, SEED, signIn } from "../tests/db/helpers";
import { AUTH, expect, putBackSales, test, ui, waitForHydration } from "./fixtures";
import { expectTidyLayout, expectWholeHeaders } from "./layout";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const PREFIX = `Ly${Date.now().toString(36)}`;
const LONG_NAME = { first: `${PREFIX}Maximiliana`, last: "Featherstonehaugh-Delacroix" };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1180, height: 820 },
  { width: 1440, height: 900 },
];

let day: string;
let appointmentId: string;
let serviceId: string;
let clientId: string;
let putBack: () => Promise<void>;

// The checkout is opened (a draft), never completed.
putBackSales();

test.beforeAll(async () => {
  ({ date: day } = await busyDay(TZ));
  const start = fromLocal(day, 15 * 60, TZ)!;
  const end = new Date(start.getTime() + 75 * 60_000);
  putBack = await makeRoom(SEED.staff.bridget, start, end);
  serviceId = (await admin.from("services").insert({ business_id: B, name: `${PREFIX} Restorative Bond-Building Treatment with Scalp Massage`, category: "Treatments", active_minutes: 75, price_cents: 9500 }).select("id").single()).data!.id;
  clientId = (await admin.from("clients").insert({ business_id: B, first_name: LONG_NAME.first, last_name: LONG_NAME.last }).select("id").single()).data!.id;
  appointmentId = (await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString() }).select("id").single()).data!.id;
  const { error } = await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: appointmentId, service_id: serviceId, staff_id: SEED.staff.bridget, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 75, price_cents: 9500 });
  expect(error).toBeNull();
});

test.afterAll(async () => {
  await admin.from("sale_drafts").delete().eq("client_id", clientId);
  await admin.from("card_requests").delete().eq("client_id", clientId);
  await admin.from("appointments").delete().eq("id", appointmentId);
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("services").delete().eq("id", serviceId);
  await putBack();
});

test.use({ storageState: AUTH.owner });

async function openDay(page: Page, query = "") {
  await page.goto(`/calendar?date=${day}${query}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(day));
  await waitForHydration(page, "section[data-staff-id]");
}

for (const size of WIDTHS) {
  test.describe(`at ${size.width}px`, () => {
    test.use({ viewport: size, hasTouch: size.width < 1440, isMobile: size.width < 500 });

    test("the calendar day, booking details and Denise's card", async ({ page }) => {
      await openDay(page);
      const card = page.getByTestId("denise-card");
      if (await card.getByRole("button", { name: "Close Denise" }).isVisible()) await card.getByRole("button", { name: "Close Denise" }).click();
      await expectTidyLayout(page, "on the calendar");
      await expectWholeHeaders(page, "on the calendar");
      if (size.width < 500) {
        // Scrolled to the end, the day and the key row end above the floating New booking.
        await page.evaluate(() => document.scrollingElement!.scrollTo(0, document.scrollingElement!.scrollHeight));
        const fab = (await page.getByTestId("new-booking-fab").boundingBox())!;
        const key = (await ui(page).getByRole("button", { name: "Key" }).boundingBox())!;
        expect(key.y + key.height).toBeLessThanOrEqual(fab.y);
        await page.evaluate(() => document.scrollingElement!.scrollTo(0, 0));
      }

      // Booking details for the long name and service.
      const block = ui(page).getByRole("button", { name: new RegExp(LONG_NAME.first) });
      await block.scrollIntoViewIfNeeded();
      await block.click();
      const details = page.getByTestId("side-panel");
      await expect(details.getByTestId("client-name")).toHaveText(`${LONG_NAME.first} ${LONG_NAME.last}`);
      await expectTidyLayout(page, "in booking details");
      // Beside the panel, the headers stay whole (on a laptop and an iPad).
      if (size.width >= 1180) await expectWholeHeaders(page, "beside booking details");
      await details.getByRole("button", { name: "Close panel" }).click();

      // Denise's card, open on the day.
      await openDay(page, "&denise=1");
      await expect(card).toBeVisible();
      await expectTidyLayout(page, "with Denise open");
    });

    // The pages clients see: the booking site's first steps, a visit's own
    // page, a card link with a deposit, a payment link and signing in.
    test("the booking site and the client's link pages", async ({ page }) => {
      await page.goto("/book/maple-and-ash");
      await waitForHydration(page, "[data-testid=booking-flow] button[aria-pressed]");
      await expectTidyLayout(page, "on the booking site");
      const flow = page.getByTestId("booking-flow");
      await flow.getByRole("button", { name: /^Women's Cut & Style\s*\d/ }).click();
      await flow.getByRole("button", { name: "Continue" }).click();
      await expect(flow.getByRole("heading", { name: "Choose your stylist" })).toBeVisible();
      await expectTidyLayout(page, "choosing a stylist");
      await flow.getByTestId("stylist-card").first().getByRole("button").first().click();
      await flow.getByRole("button", { name: "Continue" }).click();
      await expect(flow.getByRole("radiogroup", { name: "Date" })).toBeVisible();
      await expectTidyLayout(page, "choosing a time");

      const manage = newToken();
      await admin.from("appointment_manage_links").insert({ business_id: B, appointment_id: appointmentId, token_hash: sha256(manage) });
      await page.goto(`/book/maple-and-ash/manage/${manage}`);
      await expect(page.getByRole("heading", { name: "Your booking" })).toBeVisible();
      await expectTidyLayout(page, "on a visit's own page");

      const desk = await signIn("frontdesk@mapleandash.test");
      const card = newToken();
      const { error: cardError } = await desk.rpc("create_card_request", { p_client_id: clientId, p_appointment_id: appointmentId, p_token_hash: sha256(card), p_deposit_cents: 2400, p_channel: "email", p_to: "layout@example.test", p_hours: 24 });
      expect(cardError).toBeNull();
      await page.goto(`/card/${card}`);
      await expect(page.getByText("Deposit, paid now")).toBeVisible();
      await expectTidyLayout(page, "on a card link");

      await admin.from("sale_drafts").delete().eq("client_id", clientId);
      const ticket: Ticket = {
        ...EMPTY_TICKET,
        lines: [{ key: "k", kind: "service", appointmentItemId: null, serviceId, name: `${PREFIX} Restorative Bond-Building Treatment with Scalp Massage`, staffId: SEED.staff.bridget, unitPriceCents: 9500, basePriceCents: 9500, priceReason: "", quantity: 1, discount: null, packageItemId: null }],
      };
      const { data: draft, error: draftError } = await desk.from("sale_drafts").insert({ business_id: B, location_id: L, appointment_id: appointmentId, client_id: clientId, ticket: ticket as never, created_by: SEED.staff.frontDesk }).select("id").single();
      expect(draftError).toBeNull();
      const snapshot = linkSnapshot(ticket, { taxServicesBp: 0, taxRetailBp: 0, member: null }, { appointmentId, clientId }, [{ id: SEED.staff.bridget, firstName: "Bridget" }], LONG_NAME.first) as LinkSnapshot;
      const pay = newToken();
      const { error: payError } = await desk.rpc("create_payment_link", { p_draft_id: draft!.id, p_token_hash: sha256(pay), p_snapshot: snapshot as never, p_amount_cents: snapshot.dueCents, p_channel: "email", p_to: "layout@example.test", p_hours: 24 });
      expect(payError).toBeNull();
      await page.goto(`/pay/${pay}`);
      await expect(page.getByRole("button", { name: /^Pay \$/ })).toBeVisible();
      await expectTidyLayout(page, "on a payment link");

      await page.goto("/book/maple-and-ash/account");
      await expect(page.getByRole("button", { name: "Send my code" })).toBeVisible();
      await expectTidyLayout(page, "signing in to an account");
    });

    test("signing in, and the checkout", async ({ page, browser }) => {
      const out = await browser.newContext({ viewport: size, hasTouch: size.width < 1440, isMobile: size.width < 500, storageState: { cookies: [], origins: [] } });
      try {
        const signedOut = await out.newPage();
        await signedOut.goto("/login");
        await expect(signedOut.getByRole("link", { name: "Forgot password?" })).toBeVisible();
        await expectTidyLayout(signedOut, "signing in");
        await signedOut.goto("/login/forgot");
        await expect(signedOut.getByRole("button", { name: "Send the link" })).toBeVisible();
        await expectTidyLayout(signedOut, "on forgot password");
      } finally {
        await out.close();
      }

      await page.goto(`/checkout/new?appointment=${appointmentId}&from=/calendar`);
      await page.waitForURL(/\/checkout\/[0-9a-f-]{36}$/);
      await waitForHydration(page, "#product-search");
      await expect(page.getByTestId("checkout-client")).toContainText(LONG_NAME.last);
      await expectTidyLayout(page, "at checkout");
      // The payment link test above leaves its link out on this checkout.
      const cancel = page.getByRole("button", { name: "Cancel the link" });
      if (await cancel.isVisible()) {
        await cancel.click();
        await expect(cancel).toBeHidden();
      }
      await page.getByRole("complementary", { name: "Payment" }).getByRole("button", { name: "Cash", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      // Measured once it has faded in.
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
      await expectTidyLayout(page, "taking cash");
    });

    // Whatever today holds (a closed day shows its quiet states instead).
    test("the Dashboard and My day", async ({ page, browser }) => {
      await page.goto("/dashboard");
      await expect(ui(page).getByTestId("dashboard-brief")).toBeVisible();
      await waitForHydration(page, "form[aria-label='Ask Denise']");
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished)));
      await expectTidyLayout(page, "on the owner's Dashboard");

      const stylist = await browser.newContext({ viewport: size, hasTouch: size.width < 1440, isMobile: size.width < 500, storageState: AUTH.stylist });
      try {
        const own = await stylist.newPage();
        await own.goto("/dashboard");
        await expect(ui(own).getByRole("heading", { level: 1 })).toHaveText(/Bridget$/);
        await own.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished)));
        await expectTidyLayout(own, "on a stylist's Dashboard");
        await own.goto("/my-day");
        await expect(ui(own).getByTestId("my-earnings")).toBeVisible();
        await own.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished)));
        await expectTidyLayout(own, "on My day");
      } finally {
        await stylist.close();
      }
    });

    // Meet Denise, for an owner and a stylist, and with her open beside it
    // after a sample question.
    test("Meet Denise", async ({ page, browser }) => {
      const settle = (p: Page) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished)));
      await page.goto("/settings/denise");
      await expect(ui(page).getByTestId("meet-denise-intro")).toBeVisible();
      await waitForHydration(page, "[data-testid=meet-denise-try]");
      await settle(page);
      await expectTidyLayout(page, "on Meet Denise");
      await ui(page).getByTestId("try-denise").first().click();
      await expect(page.getByRole("textbox", { name: "Message Denise" })).not.toHaveValue("");
      await settle(page);
      await expectTidyLayout(page, "on Meet Denise with Denise open");

      const stylist = await browser.newContext({ viewport: size, hasTouch: size.width < 1440, isMobile: size.width < 500, storageState: AUTH.stylist });
      try {
        const own = await stylist.newPage();
        await own.goto("/settings/denise");
        await expect(ui(own).getByTestId("meet-denise-intro")).toBeVisible();
        await settle(own);
        await expectTidyLayout(own, "on Meet Denise, as a stylist");
      } finally {
        await stylist.close();
      }
    });

    // The list, the long-named client's profile (with an allergy and their
    // visit), their details form, and Maria's profile as her stylist.
    test("Clients and the client profile", async ({ page, browser }) => {
      const settle = (p: Page) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished)));
      await page.goto("/clients");
      await expect(ui(page).getByRole("table", { name: "Clients" })).toBeVisible();
      await settle(page);
      await expectTidyLayout(page, "on Clients");

      await admin.from("clients").update({ allergies: "Latex and some hair dyes: patch test first, nitrile gloves only." }).eq("id", clientId);
      await page.goto(`/clients/${clientId}`);
      await expect(ui(page).getByRole("heading", { level: 1 })).toHaveText(`${LONG_NAME.first} ${LONG_NAME.last}`);
      await expect(ui(page).getByTestId("allergy-alert")).toBeVisible();
      await settle(page);
      await expectTidyLayout(page, "on a client's profile");

      await page.goto(`/clients/${clientId}/edit`);
      await expect(ui(page).getByLabel("Signed on")).toBeVisible();
      await expectTidyLayout(page, "editing a client's details");

      const { data: maria } = await admin.from("clients").select("id").eq("business_id", B).eq("first_name", "Maria").eq("last_name", "Lopez").single();
      const stylist = await browser.newContext({ viewport: size, hasTouch: size.width < 1440, isMobile: size.width < 500, storageState: AUTH.stylist });
      try {
        const own = await stylist.newPage();
        await own.goto(`/clients/${maria!.id}`);
        await expect(ui(own).getByRole("heading", { level: 1 })).toHaveText("Maria Lopez");
        await settle(own);
        await expectTidyLayout(own, "on a client's profile, as their stylist");
      } finally {
        await stylist.close();
      }
    });
  });
}
