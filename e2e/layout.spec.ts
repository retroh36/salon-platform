// The finished look, checked on every refined screen at a phone (390), an
// iPad (1180) and a laptop (1440), with Denise open too: no text cut off,
// spilling out or covered, and no sideways page scroll (`expectTidyLayout`).
// A client with a long name booked for a long-titled service is the worst
// case for each screen.
import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, busyDay, makeRoom, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";
import { expectTidyLayout, expectWholeHeaders } from "./layout";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const PREFIX = `Ly${Date.now().toString(36)}`;
const LONG_NAME = { first: `${PREFIX}Maximiliana`, last: "Featherstonehaugh-Delacroix" };
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
  });
}
