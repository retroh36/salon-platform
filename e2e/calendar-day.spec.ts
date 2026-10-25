import type { Page } from "@playwright/test";
import { addDays, fromLocal, toLocal, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, checkIn, expect, moreAction, openChecklist, pxPerMinute, test, ui, waitForHydration } from "./fixtures";

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

// A stylist with nothing else on between these times, so a test visit
// gets a lane of its own whatever the demo data has booked.
async function freeStylist(from: Date, to: Date, except: string[]) {
  const candidates = [SEED.staff.shae, SEED.staff.hannah, SEED.staff.sandra, SEED.staff.gil, SEED.staff.bridget].filter((id) => !except.includes(id));
  const { data } = await admin
    .from("appointment_items")
    .select("staff_id, appointment:appointments!inner(status)")
    .in("staff_id", candidates)
    .not("appointment.status", "in", "(canceled,no_show)")
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString());
  const busy = new Set(data!.map((i) => i.staff_id));
  return candidates.find((id) => !busy.has(id))!;
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

  test("booking details: who and where it's at, the visit, tabs, and one main button with the rest under ⋯", async ({ page }) => {
    const calm = await client("Calm");
    await admin.from("clients").update({ phone: "+15555550123", preferences: "Likes it quiet" }).eq("id", calm);
    await book(calm, "Blowout", fromLocal(DAY, 11 * 60, TZ)!);
    await openDay(page);
    await ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Calm`) }).click();
    const panel = details(page);

    // The name opens the profile; the phone is a call button, not text.
    await expect(panel.getByTestId("client-name").getByRole("link")).toHaveAttribute("href", `/clients/${calm}`);
    await expect(panel.getByRole("link", { name: `Call ${PREFIX}Calm` })).toHaveAttribute("href", "tel:+15555550123");
    await expect(panel).not.toContainText("+15555550123");
    await expect(panel.getByTestId("visit-status")).toHaveText("Booked");
    // Not today: the date. One service: no total, and no "Not started".
    await expect(panel.getByTestId("visit-date")).toBeVisible();
    await expect(panel.getByRole("region", { name: "Visit", exact: true })).toContainText(/Blowout with Lois/);
    await expect(panel).not.toContainText("Total");
    await expect(panel).not.toContainText("Not started");

    // One primary button, pinned at the bottom; the rest under ⋯.
    await expect(panel.locator("button.bg-navy-900:visible")).toHaveCount(1);
    await expect(panel.getByTestId("primary-action")).toHaveText("Check in");
    const footer = panel.locator("footer");
    const [foot, box] = await Promise.all([footer.boundingBox(), panel.boundingBox()]);
    expect(Math.abs(foot!.y + foot!.height - (box!.y + box!.height))).toBeLessThan(2);
    await panel.getByRole("button", { name: "More actions" }).click();
    await expect(panel.getByRole("menu", { name: "More actions" }).getByRole("menuitem")).toHaveText(["Running late", "Message client", "Edit booking", "Move to another day", "Mark no-show", "Cancel booking"]);
    await page.keyboard.press("Escape");
    await expect(panel.getByRole("menu")).toHaveCount(0);
    await expect(panel).toBeVisible();

    // Notes · Formula · Photos · History.
    await expect(panel.getByRole("tab")).toHaveText(["Notes", "Formula", "Photos", "History"]);
    await expect(panel.getByRole("tabpanel", { name: "Notes" })).toContainText("Likes it quiet");
    await expect(panel.getByRole("button", { name: "Save notes" })).toHaveCount(0);
    await panel.getByRole("tab", { name: "History" }).click();
    await expect(panel.getByRole("region", { name: "Past visits" })).toContainText("No earlier visits.");
    await expect(panel.getByRole("region", { name: "Changes" })).toContainText(/^Booking and changes/);
  });

  test("a checked-out visit points to voiding its sale instead", async ({ page }) => {
    await openDay(page, addDays(today, -1));
    await ui(page).locator("[data-block][data-visit=done]").first().click({ position: { x: 10, y: 5 } });
    const note = details(page).getByTestId("checked-out-note");
    await expect(note).toContainText("To reverse checkout, a manager or owner voids the sale");
    // Yesterday's sale is a report: the front desk sees today's sales only.
    await expect(note.getByRole("link", { name: "view the sale" })).toHaveCount(0);
    await expect(details(page).getByRole("button", { name: "Undo check-in" })).toHaveCount(0);
  });

  test("lists what the visit needs in one collapsed row under the visit, warns once at check-in, and ticks things off", async ({ page }) => {
    const patchClient = await client("Patch");
    const id = await book(patchClient, "Gloss / Toner", fromLocal(DAY, 13 * 60, TZ)!);
    await openDay(page);
    const block = ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Patch`) });
    // Nothing about it on the block.
    await expect(block.locator("[data-attention]")).toHaveCount(0);
    await block.click();
    // One row while something's outstanding, opening to the checklist.
    const list = details(page).getByRole("region", { name: "Before this visit" });
    await expect(list.getByRole("button", { name: "Before this visit (3)" })).toHaveAttribute("aria-expanded", "false");
    await expect(list.getByRole("listitem")).toHaveCount(0);
    await openChecklist(details(page));
    const row = (label: string) => list.getByRole("listitem").filter({ hasText: label });
    await expect(row("Patch test")).toContainText("Patch test — none on file");
    await expect(row("Patch test")).toContainText("Needed for Gloss / Toner.");
    await expect(row("Color consent")).toContainText("Color consent — not signed");
    await expect(row("Color consent").getByRole("link", { name: "Fill it in now" })).toBeVisible();
    await expect(row("New client consultation")).toContainText("not signed");
    // The old separate boxes are gone; the checklist comes after the visit.
    await expect(details(page).getByTestId("patch-notice")).toHaveCount(0);
    await expect(details(page).getByText("Still to do for this visit")).toHaveCount(0);
    const [n, visit] = await Promise.all([list.boundingBox(), details(page).getByRole("region", { name: "Visit", exact: true }).boundingBox()]);
    expect(n!.y).toBeGreaterThan(visit!.y);

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

    // With the forms signed too, there's nothing to show.
    const { data: templates } = await admin.from("form_templates").select("id, name").in("name", ["Color consent", "New client consultation"]);
    await admin.from("client_forms").insert(
      templates!.map((t) => ({ business_id: B, client_id: patchClient, template_id: t.id, template_name: t.name, fields: [], answers: {}, signature: SIGNATURE, collected_by: SEED.staff.frontDesk })),
    );
    await page.reload();
    await waitForHydration(page, "section[data-staff-id]");
    await ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Patch`) }).click();
    await expect(details(page).getByTestId("client-name")).toHaveText(`${PREFIX}Patch Test`);
    await expect(details(page).getByRole("region", { name: "Before this visit" })).toHaveCount(0);
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
    // Unless it's so early or late the grid can't scroll that far.
    const scroll = await grid.evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
    if (scroll.top > 0 && scroll.top < scroll.max - 1) expect(Math.abs(line!.y - third)).toBeLessThan(40);
    // The stylist header and the time column stay put as it scrolls.
    await grid.evaluate((el) => (el.scrollTop += 200));
    expect((await ui(page).locator("[data-grid-header]").boundingBox())!.y).toBeCloseTo(header!.y, 0);
  });

  test("groups clients who haven't arrived into one card, to mark a no-show or dismiss for good", async ({ page }) => {
    const nowMinute = toLocal(new Date(), TZ).minute;
    test.skip(nowMinute < 60 || nowMinute > 23 * 60, "Needs room for visits due in the last hour");
    // Ben's name is long: it wraps, never cut off.
    const BEN = "Benedetta-Alessandrina Featherstonehaugh-Montgomery";
    const [ana, ben, cy, dee] = await Promise.all([client("Ana"), client(BEN), client("Cy"), client("Dee")]);
    // Due 15 and 50 minutes ago, one after the other (not a clash), and
    // 30 minutes ago with another stylist; 5 minutes ago is still in the
    // grace period.
    await book(ana, "Men's Cut", new Date(Date.now() - 15 * 60_000));
    await book(ben, "Men's Cut", new Date(Date.now() - 50 * 60_000));
    const cyVisit = await book(cy, "Men's Cut", new Date(Date.now() - 30 * 60_000), SEED.staff.nola);
    const deeStart = new Date(Date.now() - 5 * 60_000);
    await book(dee, "Men's Cut", deeStart, await freeStylist(deeStart, new Date(deeStart.getTime() + 30 * 60_000), [SEED.staff.lois, SEED.staff.nola]));
    await openDay(page, today);
    await page.getByTestId("denise-launcher").click();
    const card = page.getByTestId("denise-late");
    await expect(card).toContainText(/not arrived yet/);
    await expect(card).toContainText("Give them a call");
    const line = (name: string) => card.getByRole("listitem").filter({ hasText: `${PREFIX}${name}` });
    await expect(line("Ana")).toContainText(/Due \d/);
    await expect(line("Ben").getByRole("button", { name: "Open" })).toBeVisible();
    // Each row: the full name on its own line, the due time under it, the
    // actions below that, and dismiss in the top right corner.
    const name = line("Ben").getByTestId("late-name");
    await expect(name).toHaveText(`${PREFIX}${BEN} Test`);
    expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth && getComputedStyle(el).textOverflow !== "ellipsis")).toBe(true);
    const [row, nameBox, due, open, noShow, dismiss] = await Promise.all([
      line("Ben").boundingBox(),
      name.boundingBox(),
      line("Ben").getByText(/^Due \d/).boundingBox(),
      line("Ben").getByRole("button", { name: "Open" }).boundingBox(),
      line("Ben").getByRole("button", { name: "Mark no-show" }).boundingBox(),
      line("Ben").getByRole("button", { name: /^Dismiss/ }).boundingBox(),
    ]);
    expect(due!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height - 1);
    expect(open!.y).toBeGreaterThanOrEqual(due!.y + due!.height - 1);
    expect(noShow!.y).toBeCloseTo(open!.y, 0);
    expect(open!.height).toBeLessThan(32);
    expect(dismiss!.y - row!.y).toBeLessThan(10);
    expect(row!.x + row!.width - (dismiss!.x + dismiss!.width)).toBeLessThan(10);
    expect(dismiss!.x).toBeGreaterThanOrEqual(nameBox!.x + nameBox!.width - 1);
    await expect(line("Dee")).toHaveCount(0);
    // On the calendar: "Not arrived", not a growing count; still a count
    // in the grace period.
    await expect(ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Ben`) }).locator("[data-attention=not-arrived]")).toHaveText("Not arrived");
    await expect(ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Dee`) }).locator("[data-attention=late]")).toHaveText(/^\+\d+m$|^$/);

    await line("Cy").getByRole("button", { name: "Mark no-show" }).click();
    await line("Cy").getByRole("button", { name: "Yes, no-show" }).click();
    await expect(line("Cy")).toHaveCount(0);
    await expect(page.getByTestId("no-show-toast")).toContainText("is marked a no-show.");
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
    await expect(details(page).getByTestId("client-name")).toHaveText(`${PREFIX}${BEN} Test`);
  });
});

// Nothing in booking details is wider than the panel, in any state: no
// sideways scroll bar.
for (const viewport of [
  { name: "a laptop", width: 1440, height: 900 },
  { name: "an iPad in landscape", width: 1180, height: 820 },
  { name: "an iPad in portrait", width: 768, height: 1024 },
]) {
  test.describe(`booking details on ${viewport.name}`, () => {
    test.use({ storageState: AUTH.frontDesk, viewport: { width: viewport.width, height: viewport.height } });

    test("never scrolls sideways", async ({ page }) => {
      test.setTimeout(60_000);
      await openDay(page, today);
      const panel = details(page);
      const overflow = () =>
        panel.evaluate((el) => {
          const box = el.getBoundingClientRect();
          // What sticks out past the panel's edge, for the failure message.
          const wide = [...el.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > box.right + 0.5).map((e) => e.outerHTML.slice(0, 120));
          return { scroll: el.scrollWidth - el.clientWidth, wide: wide.slice(0, 3) };
        });
      const expectNone = async (state: string) => expect(await overflow(), state).toEqual({ scroll: 0, wide: [] });

      // Visits in every state the demo day has: booked, here, done.
      for (const visit of ["upcoming", "here", "done"]) {
        const block = ui(page).locator(`[data-block][data-visit=${visit}]`).first();
        if (!(await block.count())) continue;
        await block.evaluate((el: HTMLElement) => el.click());
        await expect(panel.getByTestId("client-name")).toBeVisible();
        await expectNone(`${visit}: opened`);
        const checklist = panel.getByRole("region", { name: "Before this visit" }).getByRole("button", { name: /^Before this visit/ });
        if (await checklist.count()) {
          await checklist.click();
          await expectNone(`${visit}: checklist open`);
        }
        const denise = panel.getByTestId("client-insight").getByRole("button");
        if (await denise.count()) {
          await denise.click();
          await expectNone(`${visit}: Denise's line open`);
        }
        for (const tab of ["Formula", "Photos", "History", "Notes"] as const) {
          await panel.getByRole("tab", { name: tab, exact: true }).click();
          if (tab === "Photos") await expect(panel.getByText("Loading photos…")).toHaveCount(0);
          await expectNone(`${visit}: ${tab}`);
        }
        const more = panel.getByRole("button", { name: "More actions" });
        if (await more.count()) {
          await more.click();
          await expectNone(`${visit}: menu open`);
          await page.keyboard.press("Escape");
        }
      }
    });
  });
}

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
    await openChecklist(details(desk));
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
    await openChecklist(details(owner));
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
