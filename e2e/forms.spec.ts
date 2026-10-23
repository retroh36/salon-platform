import type { Page } from "@playwright/test";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration, slotAt } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
// A Tuesday clear of the other tests' days.
const DAY = addDays(startOfWeek(todayIn(TZ)), 120);
const at = (hour: number) => fromLocal(DAY, hour * 60, TZ)!;
const PREFIX = `Fm${Date.now().toString(36)}`;

test.afterAll(async () => {
  const { data } = await admin.from("clients").select("id").like("first_name", `${PREFIX}%`);
  for (const c of data ?? []) await admin.from("appointments").delete().eq("client_id", c.id);
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
  await admin.from("form_templates").delete().like("name", `${PREFIX}%`);
  await admin.from("businesses").update({ patch_test_enforcement: "warn", patch_test_valid_days: 182, patch_test_min_hours: 48 }).eq("id", B);
});

async function newClient(first: string) {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}${first}`, last_name: "Test", phone: "(312) 555-0198" }).select("id").single();
  return data!.id;
}

async function serviceId(name: string) {
  return (await admin.from("services").select("id").eq("business_id", B).eq("name", name).single()).data!.id;
}

async function sign(page: Page) {
  const pad = page.getByTestId("signature-pad");
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 40, { steps: 8 });
  await page.mouse.move(box.x + 220, box.y + 110, { steps: 8 });
  await page.mouse.up();
}

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("builds a form needed before some services, and sets patch test rules", async ({ page }) => {
    await page.goto("/forms");
    await waitForHydration(page, "form[aria-label='Patch test rules']");
    const rules = page.getByRole("form", { name: "Patch test rules" });
    await rules.getByLabel("Months a patch test is valid").fill("3");
    await rules.getByLabel("Don't allow the booking").check();
    await rules.getByRole("button", { name: "Save patch test rules" }).click();
    await expect(rules.getByRole("status")).toHaveText("Saved.");
    const { data: b } = await admin.from("businesses").select("patch_test_valid_days, patch_test_enforcement").eq("id", B).single();
    expect(b).toEqual({ patch_test_valid_days: 91, patch_test_enforcement: "block" });

    await page.getByRole("link", { name: "New form" }).click();
    const form = page.getByRole("form", { name: "Form template" });
    await form.getByLabel("Name", { exact: true }).fill(`${PREFIX} Keratin waiver`);
    await form.getByRole("group", { name: "Question 1" }).getByLabel("Question", { exact: true }).fill("Have you had a keratin treatment before?");
    await form.getByRole("group", { name: "Question 1" }).getByLabel("Type").selectOption("yes_no");
    await form.getByRole("group", { name: "Question 1" }).getByLabel("Required").check();
    await form.getByRole("button", { name: "+ Checkbox" }).click();
    await form.getByRole("group", { name: "Question 3" }).getByLabel("Question", { exact: true }).fill("I understand the aftercare.");
    await form.getByRole("button", { name: "Move question 3 up" }).click();
    await form.getByRole("group", { name: "Question 3" }).getByLabel("Question", { exact: true }).fill("Client signature");
    await form.getByLabel("Before certain services").check();
    await form.getByRole("group", { name: "Services that need this form" }).getByLabel("Keratin Smoothing", { exact: true }).check();
    await form.getByRole("button", { name: "Create form" }).click();

    await expect(page).toHaveURL(/\/forms$/);
    const row = page.getByRole("link", { name: new RegExp(`${PREFIX} Keratin waiver`) });
    await expect(row).toContainText("3 questions · 1 service");
    await expect(row).toContainText("Before some services");
    const { data: t } = await admin.from("form_templates").select("fields, required").eq("name", `${PREFIX} Keratin waiver`).single();
    expect(t!.required).toBe("services");
    expect((t!.fields as { type: string; label: string }[]).map((f) => [f.type, f.label])).toEqual([
      ["yes_no", "Have you had a keratin treatment before?"],
      ["checkbox", "I understand the aftercare."],
      ["signature", "Client signature"],
    ]);
  });
});

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk, viewport: { width: 1920, height: 1300 } });

  test("sees what's missing before check-in, and the client signs on the iPad", async ({ page }) => {
    await admin.from("businesses").update({ patch_test_enforcement: "warn" }).eq("id", B);
    const client = await newClient("Nova");
    const gloss = await serviceId("Gloss / Toner");
    const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: client, starts_at: at(10).toISOString(), ends_at: new Date(at(10).getTime() + 50 * 60_000).toISOString() }).select("id").single();
    const { error } = await admin.from("appointment_items").insert({
      business_id: B,
      location_id: L,
      appointment_id: a!.id,
      service_id: gloss,
      staff_id: SEED.staff.bridget,
      starts_at: at(10).toISOString(),
      ends_at: new Date(at(10).getTime() + 50 * 60_000).toISOString(),
      active_minutes: 15,
      processing_minutes: 20,
      finishing_minutes: 15,
      price_cents: 0,
    });
    expect(error).toBeNull();

    await page.goto(`/calendar?date=${DAY}`);
    await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
    await waitForHydration(page, "section[data-staff-id]");
    await ui(page).getByRole("region", { name: "Bridget Callahan", exact: true }).getByRole("button", { name: new RegExp(`${PREFIX}Nova Test`) }).click();
    // The patch test near the top, with a way to record one.
    const patch = page.getByTestId("patch-notice");
    await expect(patch).toContainText(/Patch test missing — required for .+None on file for this client\./);
    await expect(patch.getByRole("button", { name: "Record a patch test" })).toBeVisible();
    const before = page.getByRole("region", { name: "Before this visit" });
    await expect(before).toContainText("Before check-in");
    await expect(before).not.toContainText("patch test");
    await expect(before).toContainText("Color consent isn't signed yet.");
    await expect(before).toContainText("New client consultation isn't signed yet.");

    await before.locator("p", { hasText: "New client consultation isn't signed yet." }).getByRole("link", { name: "Fill it in now" }).click();
    const form = page.getByRole("form", { name: "New client consultation" });
    await waitForHydration(page, "[data-testid=signature-pad]");
    await form.getByRole("button", { name: "Sign and submit" }).click();
    await expect(form.getByRole("alert")).toContainText("Still needed: Do you have a sensitive scalp or skin allergies?; Are you pregnant or breastfeeding?; Signature");
    await form.getByRole("group", { name: "Do you have a sensitive scalp or skin allergies?" }).getByText("No", { exact: true }).click();
    await form.getByRole("group", { name: "Are you pregnant or breastfeeding?" }).getByText("No", { exact: true }).click();
    await form.getByLabel("What has been done to your hair in the last year?").fill("Box dye in spring");
    await sign(page);
    await form.getByRole("button", { name: "Sign and submit" }).click();
    await expect(page.getByText(`Thank you, ${PREFIX}Nova!`)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    await expect(page).toHaveURL(new RegExp(`/calendar\\?date=${DAY}`));
    const { data: signed } = await admin.from("client_forms").select("answers, signature, collected_by").eq("client_id", client).single();
    expect(signed!.answers).toEqual({ history: "Box dye in spring", sensitive: "no", pregnant: "no", photos: false, sign: true });
    expect(signed!.signature).toMatch(/^data:image\/png;base64,/);
    expect(signed!.collected_by).toBe(SEED.staff.frontDesk);

    await waitForHydration(page, "section[data-staff-id]");
    await ui(page).getByRole("region", { name: "Bridget Callahan", exact: true }).getByRole("button", { name: new RegExp(`${PREFIX}Nova Test`) }).click();
    await expect(page.getByRole("region", { name: "Before this visit" })).not.toContainText("New client consultation");

    // The signed form is on the client's profile.
    await page.goto(`/clients/${client}`);
    await page.getByRole("list", { name: "Signed forms" }).getByRole("link", { name: /New client consultation/ }).click();
    await expect(page.getByText("Box dye in spring")).toBeVisible();
    await expect(page.getByRole("img", { name: `Signature of ${PREFIX}Nova Test` })).toBeVisible();
  });

  test("records a patch test, and is warned or blocked when booking color without one", async ({ page }) => {
    await newClient("Remy");
    const clientId = (await admin.from("clients").select("id").eq("first_name", `${PREFIX}Remy`).single()).data!.id;
    await admin.from("businesses").update({ patch_test_enforcement: "block" }).eq("id", B);

    await page.goto(`/calendar?date=${DAY}`);
    await waitForHydration(page, "section[data-staff-id]");
    const { box: column, y } = await slotAt(page, ui(page).getByRole("region", { name: "Bridget Callahan", exact: true }), 14 * 60);
    await page.mouse.click(column.x + column.width - 15, y);
    const form = page.getByRole("form", { name: "New booking" });
    await form.getByLabel("Find a client").fill(`${PREFIX}remy`);
    await form.getByRole("list", { name: "Matching clients" }).getByRole("button", { name: new RegExp(`${PREFIX}Remy Test`) }).click();
    const line = form.getByRole("group", { name: "Service 1" });
    await line.getByLabel("Service").selectOption({ label: "Gloss / Toner" });
    await expect(form.getByTestId("patch-warning")).toContainText("No patch test on record for this client. The salon requires a valid patch test, so this can't be booked yet.");
    await form.getByRole("button", { name: "Create booking" }).click();
    await expect(form.getByText("This service needs a patch test, and the client has none on record.")).toBeVisible();

    // Record one (a week before), and the booking goes through.
    await page.goto(`/clients/${clientId}`);
    await waitForHydration(page, "form[aria-label='Record patch test']");
    const record = page.getByRole("form", { name: "Record patch test" });
    await record.getByLabel("Date").fill(addDays(todayIn(TZ), -1));
    await record.getByLabel("Products tested").fill("Redken Shades EQ 09V");
    await record.getByRole("button", { name: "Record patch test" }).click();
    await expect(record.getByRole("status")).toHaveText("Saved.");
    await expect(page.getByRole("list", { name: "Patch test history" })).toContainText("Redken Shades EQ 09V");
    await expect(page.getByRole("region", { name: "Patch tests" })).toContainText("Valid today for services that need one.");
  });
});
