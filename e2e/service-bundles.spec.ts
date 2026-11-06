import type { Locator, Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { openCheckout } from "./checkout-helpers";
import { AUTH, expect, putBackSales, pxPerMinute, setAsideDay, slotAt, test, ui, waitForHydration } from "./fixtures";

// The checkout this file opens is put back afterwards.
putBackSales();

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, shae: SHAE } = SEED.staff;
// A Tuesday well past the demo's visits: Bridget works 9-1, Shae 9-1.
const DAY = addDays(startOfWeek(todayIn(TZ)), 99);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const PREFIX = `Bnd${Date.now().toString(36)}`;

let putBackDay = async () => {};
let bundleId: string;
let clientId: string;

const serviceId = async (name: string) => (await admin.from("services").select("id").eq("business_id", B).eq("name", name).single()).data!.id;

test.beforeAll(async () => {
  putBackDay = await setAsideDay([BRIDGET, SHAE], DAY, TZ);
  // The front desk's bundle: highlights, 15 minutes, a gloss, then a blowout.
  const { data: bundle } = await admin.from("service_bundles").insert({ business_id: B, name: `${PREFIX} Highlight, gloss and blowout` }).select("id").single();
  bundleId = bundle!.id;
  const parts = [
    { service: "Partial Highlights", gap: 0 },
    { service: "Gloss / Toner", gap: 15 },
    { service: "Blowout", gap: 0 },
  ];
  await admin.from("service_bundle_parts").insert(await Promise.all(parts.map(async (p, n) => ({ bundle_id: bundleId, business_id: B, position: n, service_id: await serviceId(p.service), gap_minutes: p.gap }))));
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Ava`, last_name: "Test" }).select("id").single();
  clientId = c!.id;
});

test.afterAll(async () => {
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("service_bundles").delete().like("name", `${PREFIX}%`);
  await putBackDay();
});

const column = (page: Page, name: string) => ui(page).getByRole("region", { name });
const panel = (page: Page) => page.getByRole("complementary", { name: "Booking details" });

async function drag(page: Page, block: Locator, minutes: number) {
  const ppm = await pxPerMinute(page);
  await block.scrollIntoViewIfNeeded();
  const from = (await block.boundingBox())!;
  await page.mouse.move(from.x + 15, from.y + 8);
  await page.mouse.down();
  await page.mouse.move(from.x + 15, from.y + 8 + minutes * ppm, { steps: 10 });
  await page.mouse.up();
}

async function items() {
  const { data } = await admin.from("appointment_items").select("appointment_id, staff_id, starts_at, bundle_id, service:services(name)").eq("location_id", L).in("staff_id", [BRIDGET, SHAE]).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString()).order("starts_at");
  return data!;
}

test.use({ viewport: { width: 1920, height: 1500 } });

test.describe("owners and managers", () => {
  test.use({ storageState: AUTH.manager });

  test("make a bundle from menu services, with a gap between", async ({ page }) => {
    const name = `${PREFIX} Color and cut`;
    await page.goto("/services");
    await ui(page).getByRole("link", { name: "Add bundle" }).click();
    await expect(page).toHaveURL("/services/bundles/new");
    await waitForHydration(page, "form");
    await ui(page).getByLabel("Name").fill(name);
    const parts = ui(page).getByRole("list", { name: "Services in the bundle" });
    await parts.getByLabel("Service 1", { exact: true }).selectOption({ label: "Partial Highlights" });
    await parts.getByLabel("Service 2", { exact: true }).selectOption({ label: "Gloss / Toner" });
    await parts.getByLabel("Gap before service 2").fill("30");
    await ui(page).getByRole("button", { name: "Add a service" }).click();
    await parts.getByLabel("Service 3", { exact: true }).selectOption({ label: "Women's Cut & Style" });
    // 1 hr 50 min, a 30 min gap, 50 min and an hour; free in the gap and both processing times.
    await expect(ui(page).getByTestId("bundle-total")).toContainText("4 hr 10 min in all, the stylist free for 1 hr 25 min.");
    await ui(page).getByRole("button", { name: "Add bundle" }).click();
    await expect(page).toHaveURL("/services");
    await expect(ui(page).getByRole("table", { name: "Bundles" }).getByRole("row").filter({ hasText: name })).toContainText("Partial Highlights, then 30 min gap, Gloss / Toner, then Women's Cut & Style");

    const { data } = await admin.from("service_bundles").select("online, parts:service_bundle_parts(position, gap_minutes)").eq("name", name).single();
    expect(data!.online).toBe(true);
    expect(data!.parts.sort((a, b) => a.position - b.position).map((p) => p.gap_minutes)).toEqual([0, 30, 0]);
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("book a bundle, give one part another stylist, drag it as one and check out each service on its own", async ({ page }) => {
    await page.goto(`/calendar?date=${DAY}`);
    await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
    await waitForHydration(page, "section[data-staff-id]");
    const { box, y } = await slotAt(page, column(page, "Bridget Callahan"), 9 * 60 + 15);
    await page.mouse.click(box.x + box.width - 15, y);

    const form = panel(page).getByRole("form", { name: "New booking" });
    await form.getByLabel("Find a client").fill(`${PREFIX}ava`);
    await form.getByRole("list", { name: "Matching clients" }).getByRole("button", { name: new RegExp(`${PREFIX}Ava Test`) }).click();
    await form.getByRole("group", { name: "Service 1" }).getByLabel("Service").selectOption({ label: `${PREFIX} Highlight, gloss and blowout` });

    // Its parts, one after another, with the gap before the gloss.
    const parts = ["Service 1", "Service 2", "Service 3"].map((n) => form.getByRole("group", { name: new RegExp(`^${n}`) }));
    await expect(parts[0].getByLabel("Starts")).toHaveValue("09:15");
    await expect(parts[1].getByLabel("Starts")).toHaveValue("11:20");
    await expect(parts[2].getByLabel("Starts")).toHaveValue("12:10");
    await expect(form.getByTestId("line-gap")).toHaveText("15 min gap");
    await expect(parts[0]).toContainText("Highlight, gloss and blowout");
    // Shae does the blowout.
    await parts[2].getByLabel("Stylist").selectOption({ label: "Shae Morgan" });
    await form.getByRole("button", { name: "Create booking" }).click();
    await expect(panel(page).getByTestId("client-name")).toHaveText(`${PREFIX}Ava Test`);
    await expect(panel(page).getByTestId("visit-bundle")).toHaveText(`Booked as ${PREFIX} Highlight, gloss and blowout`);

    const booked = await items();
    expect(booked.map((i) => [i.service!.name, i.staff_id, i.bundle_id])).toEqual([
      ["Partial Highlights", BRIDGET, bundleId],
      ["Gloss / Toner", BRIDGET, bundleId],
      ["Blowout", SHAE, bundleId],
    ]);

    // Dragging the highlights 15 minutes earlier moves the whole bundle; the blowout stays Shae's.
    await page.keyboard.press("Escape");
    const highlights = column(page, "Bridget Callahan").getByRole("button", { name: new RegExp(`^9:15am–11:05am, ${PREFIX}Ava Test, Partial Highlights, .*booked as`) });
    await drag(page, highlights, -15);
    await expect.poll(async () => (await items()).map((i) => [new Date(i.starts_at).getTime(), i.staff_id])).toEqual([
      [at(9).getTime(), BRIDGET],
      [at(11, 5).getTime(), BRIDGET],
      [at(11, 55).getTime(), SHAE],
    ]);
    await expect(column(page, "Shae Morgan").getByRole("button", { name: new RegExp(`^11:55am–12:40pm, ${PREFIX}Ava Test, Blowout`) })).toBeVisible();

    // At checkout, each service is its own line.
    const ticket = await openCheckout(page, { appointmentId: booked[0].appointment_id });
    await expect(ticket.lines).toHaveCount(3);
    for (const name of ["Partial Highlights", "Gloss / Toner", "Blowout"]) await expect(ticket.ticket).toContainText(name);
  });
});
