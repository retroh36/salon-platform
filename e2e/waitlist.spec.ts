import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, openAllDay, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration, moreAction } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { nola: NOLA } = SEED.staff;
// A Tuesday clear of the other tests' days: Nola works 9-5, lunch at noon.
const DAY = addDays(startOfWeek(todayIn(TZ)), 127);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const PREFIX = `Wl${Date.now().toString(36)}`;

async function clear() {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
}
test.beforeEach(clear);
test.afterAll(async () => {
  await clear();
  const { data } = await admin.from("clients").select("id").like("first_name", `${PREFIX}%`);
  const ids = (data ?? []).map((c) => c.id);
  await admin.from("walk_ins").delete().like("name", `${PREFIX}%`);
  await admin.from("waitlist_entries").delete().in("client_id", ids);
  for (const id of ids) await admin.from("appointments").delete().eq("client_id", id);
  await admin.from("clients").delete().in("id", ids);
});

test.use({ storageState: AUTH.frontDesk, viewport: { width: 1920, height: 1300 } });

async function newClient(first: string) {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}${first}`, last_name: "Test", phone: "(312) 555-0196" }).select("id").single();
  return data!.id;
}

async function mensCut() {
  return (await admin.from("services").select("id").eq("business_id", B).eq("name", "Men's Cut").single()).data!.id;
}

async function book(clientId: string, serviceId: string, hour: number, minute = 0) {
  const start = at(hour, minute);
  const end = new Date(start.getTime() + 30 * 60_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString() }).select("id").single();
  const { error } = await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: serviceId, staff_id: NOLA, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 30, price_cents: 0 });
  expect(error).toBeNull();
  return a!.id;
}

async function openDay(page: Page) {
  await page.goto(`/calendar?date=${DAY}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
  await waitForHydration(page, "section[data-staff-id]");
}

test("adds clients to the waitlist and removes them", async ({ page }) => {
  await newClient("Lena");
  await page.goto("/calendar/waitlist");
  await waitForHydration(page, "form[aria-label='Add to the waitlist']");
  const form = page.getByRole("form", { name: "Add to the waitlist" });
  await form.getByLabel("Find a client").fill(`${PREFIX}lena`);
  await form.getByRole("list", { name: "Matching clients" }).getByRole("button", { name: new RegExp(`${PREFIX}Lena Test`) }).click();
  await form.getByLabel("Service", { exact: true }).selectOption({ label: "Balayage" });
  await form.getByLabel("Bridget Callahan").check();
  await form.getByLabel("Afternoons").check();
  await form.getByLabel("Notes (optional)").fill("Can come at short notice");
  await form.getByRole("button", { name: "Add to waitlist" }).click();
  await expect(form.getByRole("status")).toHaveText(`Added ${PREFIX}Lena Test to the waitlist.`);

  const row = page.getByRole("region", { name: /^Waiting/ }).getByRole("listitem").filter({ hasText: `${PREFIX}Lena Test` });
  await expect(row).toContainText("Balayage · Bridget");
  await expect(row).toContainText("Afternoons · Can come at short notice");
  await row.getByRole("button", { name: `Remove ${PREFIX}Lena Test from the waitlist` }).click();
  await expect(row).toHaveCount(0);
});

test("when a visit is canceled, Denise suggests who on the waitlist fits, and staff book them", async ({ page }) => {
  const cut = await mensCut();
  const regular = await newClient("Regular");
  for (const [h, m] of [[9, 0], [9, 30], [10, 0], [10, 30], [11, 0], [11, 30], [14, 0], [14, 30], [15, 0], [15, 30], [16, 0], [16, 30]]) await book(regular, cut, h, m);
  const gone = await newClient("Gone");
  await book(gone, cut, 12, 30);
  const [eli, sam] = [await newClient("Eli"), await newClient("Sam")];
  const entry = (client: string, staff: string[], daysAgo: number) => ({
    business_id: B,
    location_id: L,
    client_id: client,
    service_ids: [cut],
    staff_ids: staff,
    windows: [] as string[],
    from_date: addDays(DAY, -3),
    to_date: addDays(DAY, 3),
    created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  });
  expect((await admin.from("waitlist_entries").insert([entry(eli, [], 5), entry(sam, [NOLA], 1)])).error).toBeNull();

  await openDay(page);
  await ui(page).getByRole("region", { name: "Nola Brennan", exact: true }).getByRole("button", { name: new RegExp(`${PREFIX}Gone Test`) }).click();
  const panel = page.getByRole("tabpanel", { name: "Booking details" });
  await moreAction(panel, "Cancel booking");
  const cancel = panel.getByRole("form", { name: "Cancel booking" });
  await cancel.getByLabel("Reason").selectOption("Client canceled");
  await cancel.getByRole("button", { name: "Cancel booking" }).click();

  // Denise opens her panel with the opening and who fits, best first.
  const opening = page.getByTestId("denise-opening");
  // Her reply streams in after the cancel saves, slower when the machine is busy.
  await expect(opening).toContainText("A 90-minute opening with Nola at 12:30pm fits 2 people on your waitlist.", { timeout: 15_000 });
  const matches = opening.getByRole("listitem");
  await expect(matches).toHaveText([new RegExp(`1\\. ${PREFIX}Sam Test.*asked for Nola`), new RegExp(`2\\. ${PREFIX}Eli Test`)]);
  await matches.first().getByRole("button", { name: "Book" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Booked ${PREFIX}Sam Test with Nola at 12:30pm. Let ${PREFIX}Sam know.` })).toBeVisible();

  const { data: booked } = await admin.from("appointments").select("starts_at, status").eq("client_id", sam);
  expect(booked).toEqual([{ starts_at: expect.any(String), status: "booked" }]);
  expect(new Date(booked![0].starts_at)).toEqual(at(12, 30));
  // The canceled time is filled, so Denise has nothing more to offer.
  await expect(opening).toHaveCount(0);
});

test("queues walk-ins with an estimated wait and books them in one click", async ({ page }) => {
  // Open all day today, whatever day this runs, with Shae (who does men's
  // cuts) working.
  const reopen = await openAllDay([SEED.staff.shae]);
  try {
    await page.goto(`/calendar`);
    await waitForHydration(page, "section[data-staff-id]");
    await ui(page).getByRole("button", { name: "Walk-ins" }).click();
    const add = page.getByRole("form", { name: "Add walk-in" });
    await add.getByLabel("Name").fill(`${PREFIX}Walker Test`);
    await add.getByLabel("Phone (optional)").fill("999 555 0123");
    await add.getByLabel("Service").selectOption({ label: "Men's Cut" });
    await add.getByRole("button", { name: "Add to queue" }).click();

    const queue = page.getByRole("region", { name: "Walk-in queue" });
    const row = queue.getByRole("listitem").filter({ hasText: `${PREFIX}Walker Test` });
    await expect(row).toContainText("Men's Cut");
    // Shae works all day today, so someone is free, unless it is nearly midnight.
    const bookButton = row.getByRole("button", { name: /^Book with / });
    await expect(row.getByTestId("walk-in-estimate").or(row.getByText("No one who does this service is free today."))).toBeVisible();
    if (await bookButton.isVisible()) {
      const label = (await bookButton.textContent())!;
      const [, stylist, time] = label.match(/^Book with (\w+) at (.+)$/)!;
      await expect(row.getByTestId("walk-in-estimate")).toContainText(`Next free: ${stylist} at ${time} · wait`);
      await bookButton.click();
      await expect(page.getByRole("status").filter({ hasText: `Booked ${PREFIX}Walker Test with ${stylist} at ${time}.` })).toBeVisible();
      const { data: w } = await admin.from("walk_ins").select("status, appointment_id").eq("name", `${PREFIX}Walker Test`).single();
      expect(w!.status).toBe("booked");
      await admin.from("appointments").delete().eq("id", w!.appointment_id!);
    } else {
      await row.getByRole("button", { name: "Left" }).click();
      await expect(row).toHaveCount(0);
    }
  } finally {
    await reopen();
  }
});
