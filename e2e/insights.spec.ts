import type { Page } from "@playwright/test";
import type { DurationInsight } from "@/lib/insights/durations";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration, slotAt } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
// A clear Tuesday far past the demo (Bridget works 9-1, 2-6).
const DAY = addDays(startOfWeek(todayIn(TZ)), 7 * 37 + 1);
const at = (h: number, m = 0) => fromLocal(DAY, h * 60 + m, TZ)!;
const PREFIX = `In${Date.now().toString(36)}`;

async function learned(staffId: string, service: string) {
  const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", service).single();
  const { data } = await admin.from("insights").select("data").eq("business_id", B).eq("kind", "duration").eq("key", `${staffId}:${s!.id}`).single();
  return { serviceId: s!.id, d: data!.data as unknown as DurationInsight };
}

const hm = (m: number) => (Math.floor(m / 60) ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

test.afterAll(async () => {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
  await admin.from("staff_services").update({ active_minutes: null, processing_minutes: null, finishing_minutes: null }).eq("staff_id", SEED.staff.bridget);
  await admin.from("ai_actions").delete().eq("feature", "duration");
});

test.describe("the front desk", () => {
  test.use({ storageState: AUTH.frontDesk, viewport: { width: 1920, height: 1500 } });

  async function clickSlot(page: Page, stylist: string, hour: number) {
    const { box, y } = await slotAt(page, ui(page).getByRole("region", { name: stylist }), hour * 60);
    await page.mouse.click(box.x + box.width - 15, y);
  }

  test("booking suggests the stylist's usual length when it's longer than the menu's", async ({ page }) => {
    const { d } = await learned(SEED.staff.bridget, "Balayage");
    const suggested = Math.ceil(d.medianMinutes / 5) * 5;
    await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Bal`, last_name: "Test" });

    await page.goto(`/calendar?date=${DAY}`);
    await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
    await waitForHydration(page, "section[data-staff-id]");
    await clickSlot(page, "Bridget Callahan", 9);
    const form = page.getByRole("tabpanel", { name: "Booking details" }).getByRole("form", { name: "New booking" });
    await form.getByLabel("Find a client").fill(`${PREFIX}bal`);
    await form.getByRole("list", { name: "Matching clients" }).getByRole("button", { name: new RegExp(`${PREFIX}Bal`) }).click();
    const line = form.getByRole("group", { name: "Service 1" });
    await line.getByLabel("Service").selectOption({ label: "Balayage" });

    // Denise's note, from what she's learned.
    const note = line.getByTestId("usual-length");
    await expect(note).toContainText(`This is shorter than Bridget usually takes: ${hm(d.medianMinutes)} for this (${d.visits} visits).`);
    await note.getByRole("button", { name: `Book ${hm(suggested)}` }).click();
    await expect(line.getByTestId("line-summary")).toContainText(`· ${hm(suggested)} ·`);
    await expect(line.getByTestId("usual-length")).toHaveText("Booked at Bridget’s usual length.");

    await form.getByRole("button", { name: "Create booking" }).click();
    await expect(page.getByRole("tabpanel", { name: "Booking details" }).getByTestId("client-name")).toHaveText(`${PREFIX}Bal Test`);
    const { data: item } = await admin.from("appointment_items").select("active_minutes, processing_minutes, finishing_minutes").eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString()).single();
    expect(item!.active_minutes + item!.processing_minutes + item!.finishing_minutes).toBe(suggested);
  });

  test("no brief in her calendar panel, and what Denise knows about each client", async ({ page }) => {
    await page.goto("/calendar");
    await waitForHydration(page, "[data-testid=denise-launcher]");
    await page.getByTestId("denise-launcher").click();
    // The brief is on the Dashboard; her panel is for what to act on now.
    await expect(page.getByRole("tabpanel", { name: /Denise/ })).toBeVisible();
    await expect(page.getByText(/Today.s brief/)).toHaveCount(0);

    // Booking details for a visit with a client: her card about them.
    const block = ui(page).locator("[data-block]").filter({ hasNotText: /Walk-in|guest/ }).first();
    await block.click({ position: { x: 10, y: 5 } });
    const card = page.getByRole("tabpanel", { name: "Booking details" }).getByTestId("client-insight");
    await expect(card).toBeVisible();
    // One quiet line, opening to her full sentence.
    await expect(card).toContainText(/^(Every|One visit so far|New client|Has a package)/);
    await card.getByRole("button").click();
    await expect(card).toContainText(/(Comes every|One visit so far|New client|Has a package)/);
  });
});

test.describe("owners", () => {
  test.use({ storageState: AUTH.owner, viewport: { width: 1440, height: 1000 } });

  test("see learned durations, apply Denise's suggestion and undo it", async ({ page }) => {
    const { d } = await learned(SEED.staff.bridget, "Balayage");
    await page.goto("/durations");
    const bridget = ui(page).getByRole("region", { name: "Bridget Callahan" });
    const row = bridget.getByTestId("duration-row").filter({ has: page.getByRole("rowheader", { name: "Balayage", exact: true }) });
    await expect(row).toContainText(hm(d.medianMinutes));
    await expect(row).toContainText(`${d.visits} visits`);
    await waitForHydration(page, "[data-testid=duration-row] button");
    await row.getByRole("button", { name: `Use ${hm(d.suggestedMinutes!)}` }).click();
    await expect(row.getByRole("status")).toContainText(`now books for ${hm(d.suggestedMinutes!)}`);

    await page.reload();
    const after = ui(page).getByRole("region", { name: "Bridget Callahan" }).getByTestId("duration-row").filter({ has: page.getByRole("rowheader", { name: "Balayage", exact: true }) });
    await expect(after).toContainText(`(menu ${hm(d.menuMinutes)})`);
    const { data: action } = await admin.from("ai_actions").select("status, summary").eq("feature", "duration").eq("status", "approved").single();
    expect(action!.summary).toBe(`Book Balayage with Bridget for ${hm(d.suggestedMinutes!)}`);

    await waitForHydration(page, "[data-testid=duration-row] button");
    await after.getByRole("button", { name: "Undo" }).click();
    await expect(after.getByRole("status")).toHaveText("Back to the previous length.");
    expect((await admin.from("ai_actions").select("status").eq("feature", "duration").single()).data!.status).toBe("undone");
  });

  test("see what Denise knows on a client's profile", async ({ page }) => {
    const { data } = await admin.from("insights").select("key").eq("business_id", B).eq("kind", "client").like("key", "e0000000-0000-4000-8000-%").not("data->>lastVisit", "is", null).limit(1).single();
    await page.goto(`/clients/${data!.key}`);
    await expect(ui(page).getByTestId("client-insight")).toContainText(/ over \d+ visits?/);
  });
});

test.describe("owners' settings", () => {
  test.use({ storageState: AUTH.owner });

  test("show what Denise's thinking uses, and set her daily limit", async ({ page }) => {
    const { data: before } = await admin.from("businesses").select("ai_daily_token_limit").eq("id", B).single();
    try {
      await page.goto("/settings");
      const usage = ui(page).getByTestId("denise-usage");
      await expect(usage).toContainText(/Today\s*[\d,]+ of 1,500,000 tokens/);
      // The test server has no API key.
      await expect(usage).toContainText("No: plain wording only");
      await waitForHydration(page, "form[aria-label=\"Denise's daily limit\"] button");
      const form = ui(page).getByRole("form", { name: "Denise's daily limit" });
      await form.getByLabel("Daily limit (tokens)").fill("250000");
      await form.getByRole("button", { name: "Save limit" }).click();
      await expect(ui(page).getByRole("status")).toHaveText("Saved Denise's daily limit.");
      expect((await admin.from("businesses").select("ai_daily_token_limit").eq("id", B).single()).data!.ai_daily_token_limit).toBe(250000);
    } finally {
      await admin.from("businesses").update({ ai_daily_token_limit: before!.ai_daily_token_limit }).eq("id", B);
    }
  });
});

test("the nightly job refuses requests without its secret", async ({ request }) => {
  expect((await request.get("/api/cron/insights")).status()).toBe(401);
  expect((await request.get("/api/cron/insights", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
});
