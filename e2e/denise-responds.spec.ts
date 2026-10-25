import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, restoreLearnedDurations, SEED, setAsideLearnedDurations } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration, moreAction } from "./fixtures";

// Denise always responds: whatever triggers her, she shows she's thinking,
// then says something (fixes, why there's nothing to do, or what staff can
// do), never silence.

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, shae: SHAE, gil: GIL, frontDesk: FRONT_DESK } = SEED.staff;

// A Tuesday clear of the seeded month and the other tests' days. Bridget
// works 9-1 and 2-6, Shae 9-1 and 1:30-5:30.
const DAY = addDays(startOfWeek(todayIn(TZ)), 64);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const PREFIX = `Dr${Date.now().toString(36)}`;

async function clearDay() {
  await admin.from("ai_actions").delete().eq("location_id", L).like("subject", `${DAY}:%`);
  await admin.from("schedule_disruptions").delete().eq("location_id", L).eq("on_date", DAY);
  await admin.from("staff_time_off").delete().eq("starts_on", DAY);
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
}

test.beforeEach(clearDay);
test.afterAll(async () => {
  await clearDay();
  const { data } = await admin.from("clients").select("id").like("first_name", `${PREFIX}%`);
  const ids = (data ?? []).map((c) => c.id);
  await admin.from("waitlist_entries").delete().in("client_id", ids);
  for (const id of ids) await admin.from("appointments").delete().eq("client_id", id);
  await admin.from("clients").delete().in("id", ids);
});

test.use({ storageState: AUTH.frontDesk, viewport: { width: 1920, height: 1500 } });

async function newClient(first: string) {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}${first}`, last_name: "Lewis", phone: "(312) 555-0197" }).select("id").single();
  return data!.id;
}

async function service(name: string) {
  return (await admin.from("services").select("id, active_minutes, processing_minutes, finishing_minutes, duration_minutes, price_cents").eq("business_id", B).eq("name", name).single()).data!;
}

// A visit straight into the database (as an import would, rules unchecked).
// `imported`: brought in from another system as it was, so the database
// lets it clash (only an import can double-book).
async function seed(clientId: string, staffId: string, start: Date, name = "Women's Cut & Style", status: "booked" | "checked_in" = "booked", imported = false) {
  const s = await service(name);
  const end = new Date(start.getTime() + s.duration_minutes! * 60_000).toISOString();
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end, created_by: FRONT_DESK, status }).select("id").single();
  const { error } = await admin.from("appointment_items").insert({
    business_id: B,
    location_id: L,
    appointment_id: a!.id,
    service_id: (await admin.from("services").select("id").eq("business_id", B).eq("name", name).single()).data!.id,
    staff_id: staffId,
    starts_at: start.toISOString(),
    ends_at: end,
    active_minutes: s.active_minutes,
    processing_minutes: s.processing_minutes,
    finishing_minutes: s.finishing_minutes,
    price_cents: s.price_cents,
    imported,
  });
  expect(error).toBeNull();
  return a!.id;
}

async function openDay(page: Page, date = DAY) {
  await page.goto(`/calendar?date=${date}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(date));
  await waitForHydration(page, "section[data-staff-id]");
}

const denisePanel = (page: Page) => page.getByRole("tabpanel", { name: /Denise/ });
const details = (page: Page) => page.getByRole("tabpanel", { name: "Booking details" });
const block = (page: Page, client: string) => ui(page).getByRole("button", { name: new RegExp(`${PREFIX}${client} Lewis`) });

async function markOut(page: Page, fullName: string, firstName: string, restOfDay: boolean) {
  await ui(page).getByRole("button", { name: `More for ${fullName}` }).click();
  await page.getByRole("dialog", { name: `${firstName}'s day` }).getByRole("button", { name: restOfDay ? "Out for the rest of the day" : "Out for the day" }).click();
}

async function reportLate(page: Page, client: string, minutes: number) {
  await block(page, client).click();
  await moreAction(details(page), "Running late");
  const form = details(page).getByRole("form", { name: "Running late" });
  await form.getByText(`${minutes} min`, { exact: true }).click();
  await form.getByRole("button", { name: "Tell Denise" }).click();
}

// A fixed-offset zone where it's now `hour` o'clock: the salon's local time
// for "it's 10pm", with the database's real clock.
function zoneAt(hour: number) {
  let offset = hour - new Date().getUTCHours();
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}

test.describe("at 10pm", () => {
  test("marking Gil out for the rest of the day: there's no one left to move, and Denise says so", async ({ page }) => {
    const zone = zoneAt(22);
    const today = todayIn(zone);
    const outReports = () => admin.from("schedule_disruptions").select("id, time_off_id").eq("staff_id", GIL).eq("kind", "call_out").eq("on_date", today);
    // Gil works that day (the demo data may give him it off): his time off
    // is set aside and put back after.
    const { data: off } = await admin.from("staff_time_off").select("*").eq("staff_id", GIL).lte("starts_on", today).gte("ends_on", today);
    await admin.from("staff_time_off").delete().in("id", (off ?? []).map((t) => t.id));
    // Shifting the zone can leave some of his demo visits not over by 10pm
    // there (later ones, or a client in his chair right now): those are set
    // aside (canceled) and put back after too.
    const { data: later } = await admin
      .from("appointment_items")
      .select("appointment:appointments!inner(id, status, canceled_at, cancel_reason)")
      .eq("staff_id", GIL)
      .gt("ends_at", new Date().toISOString())
      .lt("starts_at", fromLocal(addDays(today, 1), 0, zone)!.toISOString())
      .in("appointment.status", ["booked", "confirmed", "checked_in"]);
    const setAside = [...new Map((later ?? []).map((i) => [i.appointment.id, i.appointment])).values()];
    for (const a of setAside) await admin.from("appointments").update({ status: "canceled", canceled_at: new Date().toISOString(), cancel_reason: "Test" }).eq("id", a.id);
    await admin.from("locations").update({ timezone: zone }).eq("id", L);
    try {
      await page.goto("/calendar");
      await waitForHydration(page, "section[data-staff-id]");
      await markOut(page, "Gil Navarro", "Gil", true);
      const panel = denisePanel(page);
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(/Gil's day is already over|Gil has no clients left today/);
      await expect(panel).toContainText("nothing to move");
    } finally {
      await admin.from("locations").update({ timezone: TZ }).eq("id", L);
      for (const d of (await outReports()).data ?? []) {
        await admin.from("schedule_disruptions").delete().eq("id", d.id);
        if (d.time_off_id) await admin.from("staff_time_off").delete().eq("id", d.time_off_id);
      }
      if (off?.length) await admin.from("staff_time_off").insert(off);
      for (const a of setAside) await admin.from("appointments").update({ status: a.status, canceled_at: a.canceled_at, cancel_reason: a.cancel_reason }).eq("id", a.id);
    }
  });
});

test.describe("at 9pm", () => {
  // Your steps: a 3:15pm client reported 45 minutes late at 9pm, hours
  // after the fact.
  test("a client reported late long after their time: Denise says there's no time left, and what to do", async ({ page }) => {
    const zone = zoneAt(21);
    const today = todayIn(zone);
    await admin.from("locations").update({ timezone: zone }).eq("id", L);
    const camila = await newClient("Camila");
    const id = await seed(camila, BRIDGET, fromLocal(today, 15 * 60 + 15, zone)!);
    try {
      await page.goto("/calendar");
      await waitForHydration(page, "section[data-staff-id]");
      await reportLate(page, "Camila", 45);
      const panel = denisePanel(page);
      await expect(panel).toContainText(`${PREFIX}Camila's 3:15pm visit should have started by now, even 45 minutes late`);
      await expect(panel).toContainText("you could mark it a no-show, or rebook them");
    } finally {
      await admin.from("locations").update({ timezone: TZ }).eq("id", L);
      await admin.from("schedule_disruptions").delete().eq("appointment_id", id);
      await admin.from("appointments").delete().eq("id", id);
    }
  });
});

test.describe("out for the day", () => {
  test("with no clients that day: nothing to move, and she says why", async ({ page }) => {
    await openDay(page);
    await markOut(page, "Bridget Callahan", "Bridget", false);
    await expect(denisePanel(page)).toContainText("Bridget has no clients that day, so there's nothing to move.");
  });

  test("with clients: her options appear", async ({ page }) => {
    await seed(await newClient("Grace"), BRIDGET, at(10));
    await openDay(page);
    await markOut(page, "Bridget Callahan", "Bridget", false);
    const panel = denisePanel(page);
    await expect(panel.getByRole("button", { name: "Apply fix" })).toBeVisible();
    await expect(panel).toContainText(/cover Bridget's client/);
  });
});

test.describe("booking over someone", () => {
  test("Denise suggests the nearest times that work, and one click books it", async ({ page }) => {
    await seed(await newClient("Ann"), BRIDGET, at(10));
    const bea = await newClient("Bea");
    await openDay(page);
    await ui(page).getByRole("button", { name: "New booking" }).click();
    const form = details(page).getByRole("form", { name: "New booking" });
    await form.getByLabel("Find a client").fill(`${PREFIX}bea`);
    await form.getByRole("list", { name: "Matching clients" }).getByRole("button").first().click();
    const line = form.getByRole("group", { name: "Service 1" });
    await line.getByLabel("Stylist").selectOption({ label: "Bridget Callahan" });
    await line.getByLabel("Starts").fill("10:30");
    await line.getByLabel("Service").selectOption({ label: "Women's Cut & Style" });
    await form.getByRole("button", { name: "Create booking" }).click();
    await expect(line).toContainText("The stylist already has a client then.");

    const ideas = form.getByRole("region", { name: "Denise's suggestions" });
    await expect(ideas).toContainText("That clashes with Bridget's 10am client.");
    await expect(ideas.getByRole("button", { name: "Bridget at 11am" })).toBeVisible();
    await expect(ideas.getByRole("button", { name: /^\w+ at 10:30am$/ }).first()).toBeVisible();
    await ideas.getByRole("button", { name: "Bridget at 11am" }).click();
    await expect(line.getByLabel("Starts")).toHaveValue("11:00");
    await form.getByRole("button", { name: "Create booking" }).click();
    await expect(details(page).getByTestId("client-name")).toHaveText(`${PREFIX}Bea Lewis`);
    const { data } = await admin.from("appointments").select("starts_at").eq("client_id", bea);
    expect(data!.map((a) => new Date(a.starts_at))).toEqual([at(11)]);
  });
});

test.describe("running late", () => {
  test.beforeAll(setAsideLearnedDurations);
  test.afterAll(restoreLearnedDurations);

  test("when it affects no one, she says nothing else is affected", async ({ page }) => {
    await seed(await newClient("Mia"), BRIDGET, at(10), "Women's Cut & Style", "checked_in");
    await openDay(page);
    await reportLate(page, "Mia", 15);
    await expect(denisePanel(page)).toContainText("Nothing else is affected: Bridget has no more clients that day.");
  });

  test("when it pushes into the next client, her options appear", async ({ page }) => {
    await seed(await newClient("Mia"), BRIDGET, at(10), "Women's Cut & Style", "checked_in");
    await seed(await newClient("Grace"), BRIDGET, at(11));
    await openDay(page);
    await reportLate(page, "Mia", 20);
    await expect(denisePanel(page).getByRole("button", { name: "Apply fix" })).toBeVisible();
  });

  test("a client arriving late: her options appear", async ({ page }) => {
    await seed(await newClient("Ava"), BRIDGET, at(10));
    await seed(await newClient("Grace"), BRIDGET, at(11));
    await openDay(page);
    await reportLate(page, "Ava", 30);
    const panel = denisePanel(page);
    await expect(panel).toContainText(`${PREFIX}Ava`);
    await expect(panel.getByRole("button", { name: "Apply fix" })).toBeVisible();
  });
});

test.describe("on the calendar", () => {
  test("a double-booking (from an import) gets fixes", async ({ page }) => {
    await seed(await newClient("Ann"), BRIDGET, at(10), undefined, "booked", true);
    await seed(await newClient("Bea"), BRIDGET, at(10, 30), undefined, "booked", true);
    await openDay(page);
    const panel = denisePanel(page);
    await expect(panel).toContainText("Bridget is double-booked");
    await expect(panel.getByRole("button", { name: "Apply fix" })).toBeVisible();
  });

  test("the risk check flags a tight day and offers fixes", async ({ page }) => {
    // Bridget usually takes longer than booked for balayage (demo history).
    await seed(await newClient("Ann"), BRIDGET, at(9), "Balayage");
    await seed(await newClient("Bea"), BRIDGET, at(11, 40));
    await openDay(page);
    await expect(page.getByTestId("denise-launcher-badge")).toBeVisible();
    await page.getByTestId("denise-launcher").click();
    const panel = denisePanel(page);
    await expect(panel).toContainText("Bridget usually takes about");
    await expect(panel.getByRole("button", { name: "Apply fix" })).toBeVisible();
  });
});

test.describe("cancellations", () => {
  test("with no one on the waitlist who fits, she says the time is open", async ({ page }) => {
    await seed(await newClient("Ann"), SHAE, at(10));
    await openDay(page);
    await block(page, "Ann").click();
    await moreAction(details(page), "Cancel booking");
    const cancel = details(page).getByRole("form", { name: "Cancel booking" });
    await cancel.getByLabel("Reason").selectOption("Client canceled");
    await cancel.getByRole("button", { name: "Cancel booking" }).click();
    await expect(denisePanel(page)).toContainText(/That frees 10am–11am with Shae\. No one on the waitlist fits it/);
  });

  test("with a waitlist match, her opening and Book button appear", async ({ page }) => {
    const cut = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single()).data!.id;
    await seed(await newClient("Ann"), SHAE, at(10));
    const eli = await newClient("Eli");
    await admin.from("waitlist_entries").insert({ business_id: B, location_id: L, client_id: eli, service_ids: [cut], staff_ids: [], windows: [], from_date: addDays(DAY, -2), to_date: addDays(DAY, 2) });
    await openDay(page);
    await block(page, "Ann").click();
    await moreAction(details(page), "Cancel booking");
    const cancel = details(page).getByRole("form", { name: "Cancel booking" });
    await cancel.getByLabel("Reason").selectOption("Client canceled");
    await cancel.getByRole("button", { name: "Cancel booking" }).click();
    const opening = page.getByTestId("denise-opening");
    await expect(opening).toContainText(`${PREFIX}Eli Lewis`);
    await expect(opening.getByRole("button", { name: "Book" })).toBeVisible();
  });
});

test.describe("while she works", () => {
  test("shows she's thinking at once, with what she's doing, then her answer", async ({ page }) => {
    await seed(await newClient("Grace"), BRIDGET, at(10));
    await openDay(page);
    // Hold her reply for a moment, to see what shows meanwhile.
    await page.route("**/api/denise", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await markOut(page, "Bridget Callahan", "Bridget", false);
    const panel = denisePanel(page);
    await expect(panel.getByTestId("denise-thinking")).toContainText("Denise is thinking");
    await expect(panel.locator("[data-pose]").first()).toHaveAttribute("data-pose", "think");
    await expect(panel.getByTestId("denise-status")).toContainText("Bridget");
    await expect(panel.getByRole("button", { name: "Apply fix" })).toBeVisible();
    await expect(panel.getByTestId("denise-thinking")).toHaveCount(0);
  });

  test("questions: one at a time, and she says she's still working after 20 seconds", async ({ page }) => {
    await page.clock.install();
    await openDay(page);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/api/denise", async (route) => {
      await held;
      await route.continue();
    });
    await page.getByTestId("denise-launcher").click();
    const panel = denisePanel(page);
    await panel.locator("#denise-follow-up").fill("Who's free for a color at 3?");
    await panel.getByRole("button", { name: "Send" }).click();
    await expect(panel).toContainText("Who's free for a color at 3?");
    await expect(panel.getByTestId("denise-thinking")).toContainText("Denise is thinking");
    await expect(panel.getByRole("button", { name: "Send" })).toBeDisabled();
    await page.clock.fastForward(21_000);
    await expect(panel.getByTestId("denise-thinking")).toContainText("Still working on it");
    release();
    // No API key in tests: she says so, but she says something.
    await expect(panel).toContainText("I'm not connected yet");
    await expect(panel.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("a how-to answer comes with a button that opens the right screen", async ({ page }) => {
    await openDay(page);
    // Her answer as the server streams it (the browser tests have no API key).
    const done = { t: "done", reply: { text: "1. Tap New sale.\n2. Under the lines, tap Gift card.", kind: "fixes" }, links: [{ path: "/checkout/new?from=/sales", label: "Open new sale" }] };
    await page.route("**/api/denise", (route) => route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify(done)}\n` }));
    await page.getByTestId("denise-launcher").click();
    const panel = denisePanel(page);
    await panel.locator("#denise-follow-up").fill("How do I ring up a gift card?");
    await panel.getByRole("button", { name: "Send" }).click();
    await expect(panel).toContainText("2. Under the lines, tap Gift card.");
    const button = panel.getByRole("link", { name: "Open new sale" });
    await expect(button).toHaveAttribute("href", "/checkout/new?from=/sales");
    await button.click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}/);
  });

  test("if something breaks, she says so", async ({ page }) => {
    await seed(await newClient("Grace"), BRIDGET, at(10));
    await openDay(page);
    // A reply that isn't what she sends (as when the server falls over).
    await page.route("**/api/denise", (route) => route.fulfill({ status: 200, contentType: "application/x-ndjson", body: "not json\n" }));
    await markOut(page, "Bridget Callahan", "Bridget", false);
    await expect(denisePanel(page)).toContainText("Something went wrong on my end.");
  });
});
