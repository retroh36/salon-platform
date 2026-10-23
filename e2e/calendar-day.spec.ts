import type { Page } from "@playwright/test";
import { addDays, fromLocal, toLocal, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, checkIn, expect, moreAction, pxPerMinute, test, ui, waitForHydration } from "./fixtures";

// The calendar's day: undoing a check-in, the patch test notice in booking
// details, zoom, opening at the current time, and Denise's late-arrivals
// card.

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const today = todayIn(TZ);
const DAY = addDays(today, 40);
const PREFIX = `Cd${Date.now().toString(36)}`;
const clientIds: string[] = [];
// A signed form's signature (a 1×1 PNG).
const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function client(first: string) {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}${first}`, last_name: "Test" }).select("id").single();
  clientIds.push(data!.id);
  return data!.id;
}

async function book(clientId: string, service: string, start: Date, staffId = SEED.staff.lois) {
  const { data: s } = await admin.from("services").select("id, duration_minutes").eq("business_id", B).eq("name", service).single();
  const end = new Date(start.getTime() + s!.duration_minutes! * 60_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString() }).select("id").single();
  const { error } = await admin.from("appointment_items").insert({
    business_id: B,
    location_id: L,
    appointment_id: a!.id,
    service_id: s!.id,
    staff_id: staffId,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    active_minutes: s!.duration_minutes!,
    price_cents: 0,
  });
  expect(error).toBeNull();
  return a!.id;
}

async function openDay(page: Page, date = DAY) {
  await page.goto(date === today ? "/calendar" : `/calendar?date=${date}`);
  await waitForHydration(page, "section[data-staff-id]");
}

const details = (page: Page) => page.getByRole("tabpanel", { name: "Booking details" });
const status = async (id: string) => (await admin.from("appointments").select("status").eq("id", id).single()).data!.status;

test.afterAll(async () => {
  await admin.from("appointments").delete().in("client_id", clientIds);
  await admin.from("clients").delete().in("id", clientIds);
  await admin.from("denise_dismissals").delete().eq("location_id", L).eq("day", today).like("item_key", "late:%");
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk, viewport: { width: 1180, height: 820 } });

  test("undoes a check-in from the toast, or from booking details, and it's logged", async ({ page }) => {
    const id = await book(await client("Undo"), "Men's Cut", fromLocal(DAY, 10 * 60, TZ)!);
    await openDay(page);
    await ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Undo`) }).click();
    await checkIn(details(page));

    // A toast with Undo, right after.
    const toast = page.getByTestId("check-in-toast");
    await expect(toast).toContainText(`${PREFIX}Undo is checked in.`);
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toBeHidden();
    await expect.poll(() => status(id)).toBe("booked");
    await expect(details(page).getByRole("button", { name: "Check in", exact: true })).toBeVisible();

    // Again, then from booking details once the toast has gone.
    await checkIn(details(page));
    await expect.poll(() => status(id)).toBe("checked_in");
    await moreAction(details(page), "Undo check-in");
    await expect.poll(() => status(id)).toBe("booked");

    const { data: events } = await admin.from("appointment_events").select("kind, staff_id").eq("appointment_id", id);
    expect(events).toEqual([
      { kind: "check_in_undone", staff_id: SEED.staff.frontDesk },
      { kind: "check_in_undone", staff_id: SEED.staff.frontDesk },
    ]);
  });

  test("a checked-out visit points to voiding its sale instead", async ({ page }) => {
    await openDay(page, addDays(today, -1));
    await ui(page).locator("[data-block][data-visit=done]").first().click({ position: { x: 10, y: 5 } });
    const note = details(page).getByTestId("checked-out-note");
    await expect(note).toContainText("To reverse it, a manager or owner voids the sale");
    await expect(note.getByRole("link", { name: "view the sale" })).toHaveAttribute("href", /^\/sales\/[0-9a-f-]{36}$/);
    await expect(details(page).getByRole("button", { name: "Undo check-in" })).toHaveCount(0);
  });

  test("lists what the visit needs in one checklist near the top, warns once at check-in, and ticks things off", async ({ page }) => {
    const patchClient = await client("Patch");
    const id = await book(patchClient, "Gloss / Toner", fromLocal(DAY, 13 * 60, TZ)!);
    await openDay(page);
    const block = ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Patch`) });
    // Nothing about it on the block.
    await expect(block.locator("[data-attention]")).toHaveCount(0);
    await block.click();
    const list = details(page).getByRole("region", { name: "Before this visit" });
    const row = (label: string) => list.getByRole("listitem").filter({ hasText: label });
    await expect(row("Patch test")).toContainText("Patch test — none on file");
    await expect(row("Patch test")).toContainText("Needed for Gloss / Toner.");
    await expect(row("Color consent")).toContainText("Color consent — not signed");
    await expect(row("Color consent").getByRole("link", { name: "Fill it in now" })).toBeVisible();
    await expect(row("New client consultation")).toContainText("not signed");
    // The old separate boxes are gone; the checklist is above the services.
    await expect(details(page).getByTestId("patch-notice")).toHaveCount(0);
    await expect(details(page).getByText("Still to do for this visit")).toHaveCount(0);
    const [n, services] = await Promise.all([list.boundingBox(), details(page).getByRole("region", { name: "Service" }).boundingBox()]);
    expect(n!.y).toBeLessThan(services!.y);

    // Checking in warns once, with everything outstanding.
    await details(page).getByRole("button", { name: "Check in", exact: true }).click();
    const warning = details(page).getByRole("group", { name: "Before checking in" });
    await expect(warning.getByRole("listitem")).toHaveText(["Patch test — none on file", "Color consent — not signed", "New client consultation — not signed"]);
    await warning.getByRole("button", { name: "Not yet" }).click();
    await expect(warning).toBeHidden();
    expect(await status(id)).toBe("booked");

    // Recording the patch test ticks its row.
    await row("Patch test").getByRole("button", { name: "Record patch test" }).click();
    const form = list.getByRole("form", { name: "Record patch test" });
    await form.getByLabel("Date").fill(addDays(today, -7));
    await form.getByLabel("Products tested").fill("Redken Shades EQ 09V");
    await form.getByRole("button", { name: "Record patch test" }).click();
    await expect(row("Patch test")).toHaveAttribute("data-done", "true");
    await expect(row("Patch test")).toContainText(/Patch test — passed/);
    await expect(row("Color consent")).not.toHaveAttribute("data-done");

    // With the forms signed too, it's one line.
    const { data: templates } = await admin.from("form_templates").select("id, name").in("name", ["Color consent", "New client consultation"]);
    await admin.from("client_forms").insert(
      templates!.map((t) => ({ business_id: B, client_id: patchClient, template_id: t.id, template_name: t.name, fields: [], answers: {}, signature: SIGNATURE, collected_by: SEED.staff.frontDesk })),
    );
    await page.reload();
    await waitForHydration(page, "section[data-staff-id]");
    await ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Patch`) }).click();
    await expect(details(page).getByRole("region", { name: "Before this visit" })).toHaveText("Ready for this visit ✓");
  });

  test("zooms between Compact, Comfortable and Detailed, remembered for the person", async ({ page }) => {
    try {
      await openDay(page);
      const grid = ui(page).getByTestId("calendar-grid");
      const zoom = ui(page).getByRole("radiogroup", { name: "Zoom" });
      await expect(zoom.getByRole("radio", { name: "Comfortable" })).toHaveAttribute("aria-checked", "true");
      // About 40px a quarter hour, with every quarter labeled: hours bold,
      // quarters smaller and lighter.
      expect(Math.round((await pxPerMinute(page)) * 15)).toBe(40);
      const ten = grid.locator("[data-hour-label='600']");
      const quarter = grid.locator("[data-quarter-label='615']");
      await expect(ten).toHaveText("10am");
      await expect(quarter).toHaveText(":15");
      const style = (el: Element): [number, number] => [Number(getComputedStyle(el).fontWeight), parseFloat(getComputedStyle(el).fontSize)];
      const [[hourWeight, hourSize], [quarterWeight, quarterSize]] = await Promise.all([ten.evaluate(style), quarter.evaluate(style)]);
      expect(hourWeight).toBeGreaterThan(quarterWeight);
      expect(hourSize).toBeGreaterThan(quarterSize);
      const [a, b] = await Promise.all([ten.boundingBox(), quarter.boundingBox()]);
      expect(Math.round(b!.y - a!.y)).toBe(40);

      await zoom.getByRole("radio", { name: "Detailed" }).click();
      await expect(grid).toHaveAttribute("data-zoom", "detailed");
      expect(Math.round((await pxPerMinute(page)) * 15)).toBe(60);
      await expect.poll(async () => (await admin.from("staff").select("calendar_zoom").eq("id", SEED.staff.frontDesk).single()).data!.calendar_zoom).toBe("detailed");
      await page.reload();
      await waitForHydration(page, "section[data-staff-id]");
      await expect(ui(page).getByTestId("calendar-grid")).toHaveAttribute("data-zoom", "detailed");

      // A pinch (ctrl + scroll on a trackpad) steps it back.
      await ui(page).getByTestId("calendar-grid").hover();
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, 200);
      await page.keyboard.up("Control");
      await expect(ui(page).getByTestId("calendar-grid")).toHaveAttribute("data-zoom", "comfortable");
    } finally {
      await admin.from("staff").update({ calendar_zoom: "comfortable" }).eq("id", SEED.staff.frontDesk);
    }
  });

  test("opens today with the current time about a third of the way down", async ({ page }) => {
    await openDay(page, today);
    const now = page.getByRole("img", { name: /^Now,/ });
    test.skip((await now.count()) === 0, "Outside the hours the calendar shows");
    const grid = ui(page).getByTestId("calendar-grid");
    const [g, line, header] = await Promise.all([grid.boundingBox(), now.boundingBox(), ui(page).locator("[data-grid-header]").boundingBox()]);
    const third = header!.y + header!.height + (g!.y + g!.height - header!.y - header!.height) / 3;
    // Unless it's so early the grid can't scroll up that far.
    if ((await grid.evaluate((el) => el.scrollTop)) > 0) expect(Math.abs(line!.y - third)).toBeLessThan(40);
    // The stylist header and the time column stay put as it scrolls.
    await grid.evaluate((el) => (el.scrollTop += 200));
    expect((await ui(page).locator("[data-grid-header]").boundingBox())!.y).toBeCloseTo(header!.y, 0);
  });

  test("groups clients who haven't arrived into one card, to mark a no-show or dismiss for good", async ({ page }) => {
    const nowMinute = toLocal(new Date(), TZ).minute;
    test.skip(nowMinute < 60 || nowMinute > 23 * 60, "Needs room for visits due in the last hour");
    const [ana, ben, cy, dee] = await Promise.all([client("Ana"), client("Ben"), client("Cy"), client("Dee")]);
    // Due 15 and 50 minutes ago, one after the other (not a clash), and
    // 30 minutes ago with another stylist; 5 minutes ago is still in the
    // grace period.
    await book(ana, "Men's Cut", new Date(Date.now() - 15 * 60_000));
    await book(ben, "Men's Cut", new Date(Date.now() - 50 * 60_000));
    const cyVisit = await book(cy, "Men's Cut", new Date(Date.now() - 30 * 60_000), SEED.staff.nola);
    await book(dee, "Men's Cut", new Date(Date.now() - 5 * 60_000), SEED.staff.shae);
    await openDay(page, today);
    await page.getByTestId("denise-launcher").click();
    const card = page.getByTestId("denise-late");
    await expect(card).toContainText(/not arrived yet/);
    await expect(card).toContainText("Give them a call");
    const line = (name: string) => card.getByRole("listitem").filter({ hasText: `${PREFIX}${name}` });
    await expect(line("Ana")).toContainText(/Due \d/);
    await expect(line("Ben").getByRole("button", { name: "Open" })).toBeVisible();
    await expect(line("Dee")).toHaveCount(0);
    // On the calendar: "Not arrived", not a growing count; still a count
    // in the grace period.
    await expect(ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Ben`) }).locator("[data-attention=not-arrived]")).toHaveText("Not arrived");
    await expect(ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Dee`) }).locator("[data-attention=late]")).toHaveText(/^\+\d+m$|^$/);

    await line("Cy").getByRole("button", { name: "Mark no-show" }).click();
    await expect(line("Cy")).toHaveCount(0);
    await expect.poll(() => status(cyVisit)).toBe("no_show");

    await line("Ana").getByRole("button", { name: `Dismiss ${PREFIX}Ana Test` }).click();
    await expect(line("Ana")).toHaveCount(0);
    await expect.poll(async () => (await admin.from("denise_dismissals").select("id").eq("location_id", L).eq("day", today).like("item_key", "late:%")).data!.length).toBeGreaterThan(0);
    await page.reload();
    await waitForHydration(page, "section[data-staff-id]");
    await page.getByTestId("denise-launcher").click();
    await expect(page.getByTestId("denise-late").getByRole("listitem").filter({ hasText: `${PREFIX}Ben` })).toBeVisible();
    await expect(page.getByTestId("denise-late").getByRole("listitem").filter({ hasText: `${PREFIX}Ana` })).toHaveCount(0);

    await line("Ben").getByRole("button", { name: "Open" }).click();
    await expect(details(page).getByTestId("client-name")).toHaveText(`${PREFIX}Ben Test`);
  });
});

test.describe("when the salon requires patch tests", () => {
  test.use({ viewport: { width: 1180, height: 820 } });
  test.beforeAll(async () => {
    await admin.from("businesses").update({ patch_test_enforcement: "block" }).eq("id", B);
  });
  test.afterAll(async () => {
    await admin.from("businesses").update({ patch_test_enforcement: "warn" }).eq("id", B);
  });

  test("the front desk can't check in without one; an owner can, with a reason, kept in the visit's history", async ({ browser }) => {
    const id = await book(await client("Gate"), "Gloss / Toner", fromLocal(DAY, 15 * 60, TZ)!);
    const open = async (storageState: string) => {
      const page = await browser.newPage({ storageState });
      await openDay(page);
      await ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Gate`) }).click();
      return page;
    };

    const desk = await open(AUTH.frontDesk);
    await expect(details(desk).getByRole("listitem").filter({ hasText: "Patch test" })).toContainText("Holds up this visit");
    await details(desk).getByRole("button", { name: "Check in", exact: true }).click();
    const refused = details(desk).getByRole("group", { name: "Before checking in" });
    await expect(refused).toContainText(`${PREFIX}Gate can't be checked in yet: the salon requires a valid patch test first.`);
    await expect(refused).toContainText("ask a manager or owner");
    await expect(refused.getByRole("button", { name: /Check in/ })).toHaveCount(0);
    expect(await status(id)).toBe("booked");
    await desk.close();

    const owner = await open(AUTH.owner);
    await details(owner).getByRole("button", { name: "Check in", exact: true }).click();
    const form = details(owner).getByRole("form", { name: "Check in without the patch test" });
    await expect(form.getByRole("button", { name: "Check in without the patch test" })).toBeDisabled();
    await form.getByLabel("Why check in without it?").fill("Tested at another salon on Monday");
    await form.getByRole("button", { name: "Check in without the patch test" }).click();
    await expect.poll(() => status(id)).toBe("checked_in");
    await expect(details(owner).getByTestId("patch-override")).toContainText("“Tested at another salon on Monday”");
    const { data: events } = await admin.from("appointment_events").select("kind, staff_id, detail").eq("appointment_id", id);
    expect(events).toEqual([{ kind: "patch_test_override", staff_id: SEED.staff.owner, detail: { reason: "Tested at another salon on Monday", services: ["Gloss / Toner"] } }]);
    await owner.close();
  });
});

test.describe("dashboard brief", () => {
  test.use({ storageState: AUTH.owner, viewport: { width: 1440, height: 1000 } });

  test("lays the brief out in sections, links each item, and dismissed items stay gone", async ({ page }) => {
    await page.goto("/dashboard");
    const due = ui(page).getByTestId("brief-due");
    await expect(due.getByRole("heading")).toHaveText(/^Due back, nothing booked\d+$/);
    const items = due.getByRole("listitem");
    await expect(items).toHaveCount(3);
    const first = items.first();
    const link = first.getByRole("link");
    await expect(link).toHaveAttribute("href", /^\/clients\/[0-9a-f-]{36}$/);
    const name = (await link.locator("span").first().textContent())!;
    const key = `due:${(await link.getAttribute("href"))!.split("/").pop()}`;
    try {
      await waitForHydration(page, "[data-testid=brief-due] button");
      // "See all" shows the rest here, then the whole list on Clients.
      await due.getByRole("button", { name: /^See all/ }).click();
      await expect(items).toHaveCount(5);
      await expect(due.getByRole("link", { name: /^See all/ })).toHaveAttribute("href", "/clients?due=1");

      await first.getByRole("button", { name: `Dismiss ${name}` }).click();
      await expect(due.getByText(name, { exact: true })).toHaveCount(0);
      await expect.poll(async () => (await admin.from("denise_dismissals").select("id").eq("item_key", key)).data!.length).toBe(1);
      await page.reload();
      await expect(ui(page).getByTestId("brief-due")).toBeVisible();
      await expect(ui(page).getByTestId("brief-due").getByText(name, { exact: true })).toHaveCount(0);
    } finally {
      await admin.from("denise_dismissals").delete().eq("item_key", key);
    }
  });
});
