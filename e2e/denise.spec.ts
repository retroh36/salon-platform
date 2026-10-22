import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, shae: SHAE, frontDesk: FRONT_DESK } = SEED.staff;

// A Tuesday clear of the seeded month and of the other tests' days. Bridget
// works 9-1 and 2-6, Shae 9-1 and 1:30-5:30.
const DAY = addDays(startOfWeek(todayIn(TZ)), 50);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;

const PREFIX = `Dn${Date.now().toString(36)}`;

async function clearDay() {
  await admin.from("ai_actions").delete().eq("location_id", L).like("subject", `${DAY}:%`);
  await admin.from("schedule_disruptions").delete().eq("location_id", L).eq("on_date", DAY);
  await admin.from("staff_time_off").delete().eq("starts_on", DAY);
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
}

test.beforeEach(clearDay);
test.afterAll(async () => {
  await clearDay();
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

async function newClient(firstName: string) {
  const { data } = await admin
    .from("clients")
    .insert({ business_id: B, first_name: `${PREFIX}${firstName}`, last_name: "Lewis", phone: "(312) 555-0198" })
    .select("id")
    .single();
  return data!.id;
}

// A cut straight into the database.
async function seedCut(clientId: string, staffId: string, start: Date, status: "booked" | "checked_in" = "booked") {
  const { data: s } = await admin.from("services").select("id, duration_minutes, active_minutes, price_cents").eq("business_id", B).eq("name", "Women's Cut & Style").single();
  const end = new Date(start.getTime() + s!.duration_minutes! * 60_000).toISOString();
  const { data: a } = await admin
    .from("appointments")
    .insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end, created_by: FRONT_DESK, status })
    .select("id")
    .single();
  const { data: item } = await admin
    .from("appointment_items")
    .insert({
      business_id: B,
      location_id: L,
      appointment_id: a!.id,
      service_id: s!.id,
      staff_id: staffId,
      starts_at: start.toISOString(),
      ends_at: end,
      active_minutes: s!.active_minutes,
      price_cents: s!.price_cents,
    })
    .select("id")
    .single();
  return item!.id;
}

// Bridget's 10:00 client is in the chair; Grace is next at 11:00. Shae is
// booked all morning, so Denise has to keep Grace with Bridget.
async function overrunMorning() {
  await seedCut(await newClient("Mia"), BRIDGET, at(10), "checked_in");
  const grace = await seedCut(await newClient("Grace"), BRIDGET, at(11));
  for (const hour of [9, 10, 11, 12]) await seedCut(await newClient(`E${hour}`), SHAE, at(hour));
  return grace;
}

async function openDay(page: Page) {
  await page.goto(`/calendar?date=${DAY}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
  await waitForHydration(page, "section[data-staff-id]");
}

// Denise's panel is closed until something opens it; her face opens it.
async function openDenise(page: Page) {
  await page.getByTestId("denise-launcher").click();
  await expect(denisePanel(page)).toBeVisible();
}

const block = (page: Page, client: string) => ui(page).getByRole("button", { name: new RegExp(`${PREFIX}${client} Lewis`) });
const deniseTab = (page: Page) => page.getByRole("tab", { name: /Denise/ });
const denisePanel = (page: Page) => page.getByRole("tabpanel", { name: /Denise/ });

async function startOf(itemId: string) {
  const { data } = await admin.from("appointment_items").select("starts_at, staff_id").eq("id", itemId).single();
  return { start: new Date(data!.starts_at).getTime(), staffId: data!.staff_id };
}

test.use({ viewport: { width: 1920, height: 1500 } });

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("waves when the day is clear, and mentions stock that needs ordering", async ({ page }) => {
    await openDay(page);
    // Nothing on the calendar, so her panel stays closed; she has reorders
    // waiting, so her badge shows them.
    await expect(page.getByRole("complementary", { name: "Assistant and booking details" })).toBeHidden();
    const badge = page.getByTestId("denise-launcher-badge");
    await expect(badge).toHaveText(/^\d+$/);
    const waiting = Number(await badge.innerText());
    // Something new: a gentle bounce.
    await expect(badge).toHaveAttribute("data-bounce", "true");
    expect(await badge.evaluate((el) => getComputedStyle(el).animationName)).toBe("soft-bounce");
    await openDenise(page);
    // Seen now: no more bouncing once she's closed again.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("denise-launcher-badge")).not.toHaveAttribute("data-bounce");
    await openDenise(page);
    await expect(denisePanel(page).getByTestId("denise-says")).toHaveText("The calendar's clear. A few things about stock:");
    await expect(denisePanel(page).locator("[data-pose]")).toHaveAttribute("data-pose", "wave");
    await expect(denisePanel(page).getByTestId("denise-reorder").first()).toContainText("I've put together an order for");
    // The badge counts exactly the orders she has waiting.
    await expect(denisePanel(page).getByTestId("denise-reorder")).toHaveCount(waiting);
  });

  test("finds a fix for an overrun, applies it, and undoes it", async ({ page }) => {
    const grace = await overrunMorning();
    await openDay(page);

    // Report that Bridget's 10:00 is running 20 minutes over.
    await block(page, "Mia").click();
    const details = page.getByRole("tabpanel", { name: "Booking details" });
    await details.getByRole("button", { name: "Running late" }).click();
    const form = details.getByRole("form", { name: "Running late" });
    await expect(form.getByRole("group", { name: "How far over is this running?" })).toBeVisible();
    await form.getByText("20 min").click();
    await form.getByRole("button", { name: "Tell Denise" }).click();

    // Denise's panel slides in with her fix, pointing.
    await expect(deniseTab(page)).toHaveAttribute("aria-selected", "true");
    const panel = denisePanel(page);
    // The fix and the reorders waiting.
    const reorders = await panel.getByTestId("denise-reorder").count();
    await expect(page.getByTestId("denise-badge")).toHaveText(new RegExp(String(1 + reorders)));
    await expect(panel.locator("[data-pose]")).toHaveAttribute("data-pose", "point");
    await expect(panel.getByTestId("denise-message")).toHaveText(
      `Bridget's running 20 minutes late. I found a fix that only moves one client: ${PREFIX}Grace Lewis 11:00 → 11:20. Want me to apply it?`,
    );
    await expect(panel).toContainText("Why it works:");

    // The calendar previews it: Mia's and Grace's blocks glow, and Grace's
    // new place shows dashed.
    await expect(ui(page).locator("[data-denise-highlight]")).toHaveCount(2);
    await expect(ui(page).locator("[data-fix-ghost]")).toContainText("→ 11:20am");

    await panel.getByRole("button", { name: "Apply fix" }).click();
    await expect(panel.getByRole("status")).toContainText(`Done — ${PREFIX}Grace has been moved and notified.`);
    expect(await startOf(grace)).toEqual({ start: at(11, 20).getTime(), staffId: BRIDGET });
    await expect(block(page, "Grace")).toHaveAccessibleName(/^11:20am–12:20pm/);
    await expect(panel.getByTestId("denise-message")).toHaveCount(0);
    await expect(panel.locator("[data-pose]")).toHaveAttribute("data-pose", "wave");

    // Logged and notified.
    const { data: logged } = await admin.from("ai_actions").select("id, status, decided_by").like("subject", `${DAY}:%`).eq("status", "approved").single();
    expect(logged!.decided_by).toBe(FRONT_DESK);
    const { count } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("ai_action_id", logged!.id);
    expect(count).toBe(2);

    // Undo, right there.
    await panel.getByRole("button", { name: "Undo" }).click();
    await expect(panel.getByRole("status")).toContainText(`Undone — ${PREFIX}Grace is back at 11:00.`);
    expect(await startOf(grace)).toEqual({ start: at(11).getTime(), staffId: BRIDGET });
    // The problem is back, so Denise offers the fix again.
    await expect(panel.getByTestId("denise-message")).toContainText("Bridget's running 20 minutes late.");
  });

  test("dismisses a fix", async ({ page }) => {
    await overrunMorning();
    await openDay(page);
    await block(page, "Mia").click();
    await page.getByRole("button", { name: "Running late" }).click();
    await page.getByText("30 min").click();
    await page.getByRole("button", { name: "Tell Denise" }).click();

    const panel = denisePanel(page);
    await expect(panel.getByTestId("denise-message")).toContainText("Bridget's running 30 minutes late.");
    await panel.getByRole("button", { name: "Dismiss" }).click();
    await expect(panel.getByRole("status")).toContainText("Okay, I'll leave that one.");
    await expect(panel.getByTestId("denise-message")).toHaveCount(0);

    // It stays dismissed after a reload.
    await openDay(page);
    await openDenise(page);
    await expect(denisePanel(page).getByTestId("denise-message")).toHaveCount(0);
  });

  test("hands a stylist's clients to others when they're out for the day", async ({ page }) => {
    const grace = await seedCut(await newClient("Grace"), BRIDGET, at(10));
    await openDay(page);
    await ui(page).getByRole("button", { name: "More for Bridget Callahan" }).click();
    await page.getByRole("dialog", { name: "Bridget's day" }).getByRole("button", { name: "Out for the day" }).click();

    const panel = denisePanel(page);
    await expect(panel.getByTestId("denise-message")).toHaveText(
      `Bridget is out for the rest of the day. I found a fix that only moves one client: ${PREFIX}Grace Lewis → Shae at 10:00. Want me to apply it?`,
    );
    await panel.getByRole("button", { name: "Apply fix" }).click();
    await expect(panel.getByRole("status")).toContainText("has been moved and notified");
    expect(await startOf(grace)).toEqual({ start: at(10).getTime(), staffId: SHAE });
    // Bridget's column shows the time off.
    await expect(ui(page).getByRole("region", { name: "Bridget Callahan" }).locator("[data-time-off]")).toContainText("Out for the rest of the day");
  });

  test("shows other options, previews them, and applies one", async ({ page }) => {
    // Shae is free, so moving Grace to Shae is another option.
    await seedCut(await newClient("Mia"), BRIDGET, at(10), "checked_in");
    const grace = await seedCut(await newClient("Grace"), BRIDGET, at(11));
    await openDay(page);
    await block(page, "Mia").click();
    await page.getByRole("button", { name: "Running late" }).click();
    await page.getByText("20 min").click();
    await page.getByRole("button", { name: "Tell Denise" }).click();

    const panel = denisePanel(page);
    await expect(panel.getByTestId("denise-message")).toContainText("11:00 → 11:20");
    // Shown under the top fix.
    await expect(panel.getByRole("button", { name: "Other options (1)" })).toHaveAttribute("aria-expanded", "true");
    const other = panel.getByRole("listitem").filter({ hasText: "→ Shae at 11:00" });
    await other.hover();
    await expect(ui(page).getByRole("region", { name: "Shae Morgan" }).locator("[data-fix-ghost]")).toBeVisible();
    await other.getByRole("button", { name: "Use this instead" }).click();
    await expect(panel.getByRole("status")).toContainText("has been moved and notified");
    expect(await startOf(grace)).toEqual({ start: at(11).getTime(), staffId: SHAE });
  });

  test("is not connected for questions without an API key", async ({ page }) => {
    await openDay(page);
    const bar = ui(page).getByRole("form", { name: "Ask Denise", exact: true });
    await bar.getByRole("textbox").fill("Who's free for a color at 3?");
    await bar.getByRole("button", { name: "Ask" }).click();
    const panel = denisePanel(page);
    await expect(panel.getByRole("region", { name: "Conversation with Denise" })).toContainText("Who's free for a color at 3?");
    await expect(panel.getByRole("region", { name: "Conversation with Denise" })).toContainText("I'm not connected yet");
  });
});

test.describe("stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("can say their client is running over, and sees Denise's fix without applying it", async ({ page }) => {
    await overrunMorning();
    await openDay(page);
    await block(page, "Mia").click();
    await page.getByRole("button", { name: "Running late" }).click();
    await page.getByText("15 min").click();
    await page.getByRole("button", { name: "Tell Denise" }).click();

    const panel = denisePanel(page);
    await expect(panel.getByTestId("denise-message")).toContainText("Bridget's running 15 minutes late.");
    await expect(panel.getByRole("button", { name: "Apply fix" })).toHaveCount(0);
    await expect(panel).toContainText("The front desk can apply this.");
  });
});

test.describe("reduced motion", () => {
  test.use({ storageState: AUTH.frontDesk, reducedMotion: "reduce" });

  test("changes Denise's pose instantly, and her badge doesn't bounce", async ({ page }) => {
    await openDay(page);
    const badge = page.getByTestId("denise-launcher-badge");
    await expect(badge).toHaveAttribute("data-bounce", "true");
    expect(parseFloat(await badge.evaluate((el) => getComputedStyle(el).animationDuration))).toBeLessThan(0.001);
    const aside = page.locator("aside[aria-label='Assistant and booking details']");
    expect(parseFloat(await aside.evaluate((el) => getComputedStyle(el).transitionDuration))).toBeLessThan(0.001);
    await openDenise(page);
    const image = denisePanel(page).locator("[data-pose] img").first();
    await expect(image).toBeVisible();
    const seconds = parseFloat(await image.evaluate((el) => getComputedStyle(el).transitionDuration));
    expect(seconds).toBeLessThan(0.001);
  });
});
