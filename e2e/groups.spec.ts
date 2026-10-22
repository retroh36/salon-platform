import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const PX_PER_MINUTE = 2;
// A Tuesday clear of the other tests' days: Bridget and Shae work 9-1.
const DAY = addDays(startOfWeek(todayIn(TZ)), 134);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const PREFIX = `Gp${Date.now().toString(36)}`;

async function clear() {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
}
test.beforeEach(clear);
test.afterAll(async () => {
  await clear();
  await admin.from("appointment_groups").delete().like("label", `${PREFIX}%`);
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

test.use({ storageState: AUTH.frontDesk, viewport: { width: 1920, height: 1500 } });

const column = (page: Page, name: string) => ui(page).getByRole("region", { name, exact: true });

async function openDay(page: Page) {
  await page.goto(`/calendar?date=${DAY}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
  await waitForHydration(page, "section[data-staff-id]");
}

async function clickSlot(page: Page, stylist: string, hour: number) {
  const box = (await column(page, stylist).boundingBox())!;
  const start = Number(await ui(page).locator("[data-range-start]").getAttribute("data-range-start"));
  await page.mouse.click(box.x + box.width - 15, box.y + (hour * 60 - start) * PX_PER_MINUTE + 3);
}

test("books a group, shows it together, and moves and cancels the whole group", async ({ page }) => {
  await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Ava`, last_name: "Test", phone: "(312) 555-0195" });
  const label = `${PREFIX} bridal party`;

  await openDay(page);
  await clickSlot(page, "Bridget Callahan", 10);
  await page.getByRole("form", { name: "New booking" }).getByRole("button", { name: "Book a group instead" }).click();
  const form = page.getByRole("form", { name: "Group booking" });
  await form.getByLabel("Group name").fill(label);
  const ava = form.getByRole("group", { name: "Guest 1" });
  await ava.getByLabel("Find a client").fill(`${PREFIX}ava`);
  await ava.getByRole("list", { name: "Matching clients" }).getByRole("button", { name: new RegExp(`${PREFIX}Ava Test`) }).click();
  await ava.getByLabel("Service").selectOption({ label: "Women's Cut & Style" });
  const guest = form.getByRole("group", { name: "Guest 2" });
  await guest.getByLabel("Service").selectOption({ label: "Women's Cut & Style" });
  await guest.getByLabel("Stylist").selectOption({ label: "Shae Morgan" });
  await form.getByLabel("Staggered, every").check();
  await form.getByLabel("Minutes between guests").fill("15");
  await expect(guest).toContainText("10:15am");
  await form.getByRole("button", { name: "Book 2 guests" }).click();
  await expect(ui(page).getByRole("status").filter({ hasText: `Booked 2 guests for ${label}.` })).toBeVisible();

  // Both show the group, and opening one lists and highlights the other.
  const avaBlock = column(page, "Bridget Callahan").getByRole("button", { name: new RegExp(`${PREFIX}Ava Test.*group: ${label}`) });
  const guestBlock = column(page, "Shae Morgan").getByRole("button", { name: new RegExp(`${label} guest.*group: ${label}`) });
  await expect(avaBlock).toBeVisible();
  await expect(guestBlock).toBeVisible();
  await avaBlock.click();
  const info = page.getByTestId("group-info");
  await expect(info).toContainText(`${label} · 2 guests`);
  await expect(info.getByRole("listitem")).toHaveText([`${PREFIX}Ava Test · Bridget Callahan · 10am (this visit)`, `${label} guest · Shae Morgan · 10:15am`]);
  await expect(guestBlock).toHaveAttribute("data-group-highlight", "true");

  // Drag Ava 30 minutes later: the whole group moves.
  const box = (await avaBlock.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 8 + 30 * PX_PER_MINUTE, { steps: 10 });
  await page.mouse.up();
  await page.getByRole("dialog", { name: `Move ${PREFIX}Ava Test's group visit` }).getByRole("button", { name: "The whole group" }).click();
  await expect(ui(page).getByRole("status").filter({ hasText: "Moved the whole group (2 guests)." })).toBeVisible();
  const { data: group } = await admin.from("appointment_groups").select("id").eq("label", label).single();
  const visits = async () => (await admin.from("appointments").select("starts_at, status").eq("group_id", group!.id).order("starts_at")).data!;
  expect((await visits()).map((v) => new Date(v.starts_at).getTime())).toEqual([at(10, 30).getTime(), at(10, 45).getTime()]);

  // Cancel the whole group.
  await openDay(page);
  await column(page, "Bridget Callahan").getByRole("button", { name: new RegExp(`${PREFIX}Ava Test`) }).click();
  const panel = page.getByRole("tabpanel", { name: "Booking details" });
  await panel.getByRole("button", { name: "Cancel booking" }).click();
  const cancel = panel.getByRole("form", { name: "Cancel booking" });
  await cancel.getByLabel("Reason").selectOption("Client canceled");
  await cancel.getByLabel("The whole group").check();
  await cancel.getByRole("button", { name: "Cancel booking" }).click();
  await expect.poll(async () => (await visits()).map((v) => v.status)).toEqual(["canceled", "canceled"]);
});

test("won't book a group that doesn't all fit", async ({ page }) => {
  await openDay(page);
  await clickSlot(page, "Bridget Callahan", 10);
  await page.getByRole("form", { name: "New booking" }).getByRole("button", { name: "Book a group instead" }).click();
  const form = page.getByRole("form", { name: "Group booking" });
  await form.getByLabel("Group name").fill(`${PREFIX} clash`);
  for (const n of [1, 2]) {
    const g = form.getByRole("group", { name: `Guest ${n}` });
    await g.getByLabel("Service").selectOption({ label: "Women's Cut & Style" });
    await g.getByLabel("Stylist").selectOption({ label: "Bridget Callahan" });
  }
  await form.getByRole("button", { name: "Book 2 guests" }).click();
  await expect(form.getByRole("alert")).toContainText("Not everyone fits as planned.");
  await expect(form.getByRole("group", { name: "Guest 2" })).toContainText("The stylist already has a client then.");
  expect((await admin.from("appointment_groups").select("id").eq("label", `${PREFIX} clash`)).data).toEqual([]);
});
