import type { Page } from "@playwright/test";
import { admin, countFor, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Unique per run; afterAll deletes these clients (formulas cascade).
const PREFIX = `E2e${crypto.randomUUID().slice(0, 6)}`;

// Seeded clients to look at, found by query so the tests don't depend on
// which names the seed happened to generate.
let withAllergy: { id: string; first_name: string; last_name: string; allergies: string };
let withPhone: { id: string; first_name: string; last_name: string; phone: string };

test.beforeAll(async () => {
  const allergy = await admin
    .from("clients")
    .select("id, first_name, last_name, allergies")
    .eq("business_id", SEED.business)
    .not("allergies", "is", null)
    .order("search_name")
    .limit(1)
    .single();
  withAllergy = allergy.data as typeof withAllergy;

  const phone = await admin
    .from("clients")
    .select("id, first_name, last_name, phone")
    .eq("business_id", SEED.business)
    .eq("phone", "(708) 555-0142")
    .single();
  withPhone = phone.data as typeof withPhone;
});

test.afterAll(async () => {
  const { data: made } = await admin.from("clients").select("id").like("first_name", `${PREFIX}%`);
  if (made?.length) await admin.from("appointments").delete().in("client_id", made.map((c) => c.id));
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
});

const name = (c: { first_name: string; last_name: string }) => `${c.first_name} ${c.last_name}`;

function results(page: Page) {
  return ui(page).getByRole("list", { name: "Clients" }).getByRole("listitem");
}

async function openClients(page: Page) {
  await page.goto("/clients");
  await waitForHydration(page, "input[type=search]");
}

test.describe("front desk", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("search by name as you type, keeping focus", async ({ page }) => {
    await openClients(page);
    // However many there are now (more if some were added by hand).
    await expect(ui(page).getByText(`${await countFor("clients")} clients · showing the first 50`)).toBeVisible();

    const search = ui(page).getByRole("searchbox", { name: "Search clients" });
    await expect(search).toBeFocused();
    // Partial first and last name, in any case.
    const query = `${withPhone.first_name.slice(0, 3)} ${withPhone.last_name.slice(0, 4).toUpperCase()}`;
    await search.pressSequentially(query, { delay: 30 });

    await expect(page).toHaveURL(`/clients?q=${encodeURIComponent(query)}`);
    await expect(results(page).filter({ hasText: name(withPhone) })).toBeVisible();
    for (const row of await results(page).allInnerTexts()) {
      expect(row.toLowerCase()).toContain(withPhone.first_name.slice(0, 3).toLowerCase());
    }
    // Results re-render on the server; the box keeps focus and what was typed.
    await expect(search).toBeFocused();
    await expect(search).toHaveValue(query);
  });

  test("search by any part of a phone number", async ({ page }) => {
    await openClients(page);
    const search = ui(page).getByRole("searchbox", { name: "Search clients" });

    await search.fill("555-0142");
    await expect(page).toHaveURL(/q=555-0142/);
    // The same line number exists in each of the five seeded area codes.
    await expect(results(page)).toHaveCount(5);

    await search.fill("(708) 555-0142");
    await expect(results(page)).toHaveCount(1);
    await expect(results(page)).toContainText(name(withPhone));

    await search.fill("zzqx");
    await expect(ui(page).getByText("No clients match “zzqx”")).toBeVisible();
  });

  test("a client's allergies are flagged in the list and on their profile", async ({ page }) => {
    await page.goto(`/clients?q=${encodeURIComponent(name(withAllergy))}`);
    const row = results(page).filter({ hasText: name(withAllergy) }).first();
    await expect(row.getByText("Allergy")).toBeVisible();

    await row.getByRole("link").click();
    await expect(ui(page).getByRole("heading", { level: 1 })).toHaveText(name(withAllergy));
    await expect(ui(page).getByRole("note", { name: "Allergies" })).toContainText(withAllergy.allergies);
  });

  test("add a client, keeping typed values through a validation error", async ({ page }) => {
    await page.goto("/clients/new");
    await waitForHydration(page, "input[name=consent_signed]");
    const form = ui(page);

    await form.getByLabel("First name").fill(`${PREFIX} Rosa`);
    await form.getByLabel("Last name").fill("Delgado");
    await form.getByLabel("Phone", { exact: true }).fill("555");
    await form.getByLabel("Email", { exact: true }).fill("rosa@example");
    await form.getByLabel("Allergies and sensitivities").fill("Fragrance sensitivity");
    await form.getByLabel("Preferred stylist").selectOption({ label: "Sandra Whitfield" });
    await expect(form.getByLabel("Signed on")).toBeDisabled();
    await form.getByLabel("Consent form signed").check();
    await expect(form.getByLabel("Signed on")).toBeEnabled();
    await form.getByLabel("Signed on").fill("2026-01-15");
    await form.getByRole("button", { name: "Add client" }).click();

    await expect(form.getByRole("alert")).toHaveText("Fix the highlighted fields.");
    await expect(form.getByText("Enter a 10-digit phone number.")).toBeVisible();
    await expect(form.getByText("Enter a valid email address.")).toBeVisible();
    await expect(form.getByLabel("First name")).toHaveValue(`${PREFIX} Rosa`);
    await expect(form.getByLabel("Preferred stylist")).toHaveValue(SEED.staff.sandra);
    await expect(form.getByLabel("Consent form signed")).toBeChecked();
    await expect(form.getByLabel("Signed on")).toHaveValue("2026-01-15");

    await form.getByLabel("Phone", { exact: true }).fill("312 555 0177");
    await form.getByLabel("Email", { exact: true }).fill("rosa.delgado@example.com");
    await form.getByRole("button", { name: "Add client" }).click();

    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
    await expect(ui(page).getByRole("heading", { level: 1 })).toHaveText(`${PREFIX} Rosa Delgado`);
    await expect(ui(page).getByText("(312) 555-0177 · rosa.delgado@example.com")).toBeVisible();
    await expect(ui(page).getByRole("note", { name: "Allergies" })).toContainText("Fragrance sensitivity");

    // Findable straight away.
    await openClients(page);
    await ui(page).getByRole("searchbox", { name: "Search clients" }).fill("0177");
    await expect(results(page).filter({ hasText: `${PREFIX} Rosa Delgado` })).toBeVisible();
  });

  test("edit a client's details", async ({ page }) => {
    const { data } = await admin
      .from("clients")
      .insert({ business_id: SEED.business, first_name: `${PREFIX} Edit`, last_name: "Me", phone: "(312) 555-0178" })
      .select("id")
      .single();
    await page.goto(`/clients/${data!.id}`);
    await waitForHydration(page, "input[name=first_name]");

    await ui(page).getByLabel("Phone", { exact: true }).fill("(312) 555-0179");
    await ui(page).getByLabel("Notes", { exact: true }).fill("Prefers Saturday mornings.");
    await ui(page).getByRole("button", { name: "Save changes" }).click();

    await expect(ui(page).getByText("(312) 555-0179")).toBeVisible();
    await page.reload();
    await expect(ui(page).getByLabel("Notes", { exact: true })).toHaveValue("Prefers Saturday mornings.");
  });
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("see client details read-only and can add a formula entry", async ({ page }) => {
    const { data } = await admin
      .from("clients")
      .insert({ business_id: SEED.business, first_name: `${PREFIX} Formula`, last_name: "Client", notes: "Growing out bangs." })
      .select("id")
      .single();
    // A stylist sees the clients on their own book: one past visit with Bridget.
    const { data: svc } = await admin.from("services").select("id, active_minutes, price_cents").eq("business_id", SEED.business).eq("name", "Blowout").single();
    const start = new Date(Date.now() - 400 * 86_400_000);
    const end = new Date(start.getTime() + svc!.active_minutes * 60_000);
    const { data: visit } = await admin
      .from("appointments")
      .insert({ business_id: SEED.business, location_id: SEED.location, client_id: data!.id, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "canceled", canceled_at: start.toISOString(), cancel_reason: "Test visit", created_by: SEED.staff.frontDesk })
      .select("id")
      .single();
    await admin.from("appointment_items").insert({
      business_id: SEED.business,
      location_id: SEED.location,
      appointment_id: visit!.id,
      service_id: svc!.id,
      staff_id: SEED.staff.bridget,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      active_minutes: svc!.active_minutes,
      processing_minutes: 0,
      finishing_minutes: 0,
      price_cents: svc!.price_cents,
    });
    await page.goto(`/clients/${data!.id}`);
    await waitForHydration(page, "textarea[name=formula]");

    // Details are shown, not editable.
    await expect(ui(page).getByText("Growing out bangs.")).toBeVisible();
    await expect(ui(page).getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(ui(page).getByLabel("First name")).toHaveCount(0);
    await expect(ui(page).getByRole("heading", { name: "Color formulas (0)" })).toBeVisible();

    // An empty formula is rejected.
    await ui(page).getByRole("button", { name: "Add formula entry" }).click();
    await expect(ui(page).getByText("Enter the formula.")).toBeVisible();

    await ui(page).getByLabel("Formula", { exact: true }).fill("Roots: Shades EQ 6N + 6NB (1:1), 20 vol, 35 min");
    await ui(page).getByRole("form", { name: "Add formula" }).getByLabel("Notes (optional)").fill("Lifted fast; check at 30.");
    await ui(page).getByRole("button", { name: "Add formula entry" }).click();

    await expect(ui(page).getByRole("status")).toHaveText("Saved.");
    await expect(ui(page).getByRole("heading", { name: "Color formulas (1)" })).toBeVisible();
    const entry = ui(page).getByRole("list", { name: "Formula history" }).getByRole("listitem").first();
    await expect(entry).toContainText("Bridget Callahan");
    await expect(entry).toContainText("Roots: Shades EQ 6N + 6NB (1:1), 20 vol, 35 min");
    await expect(entry).toContainText("Lifted fast; check at 30.");
    // The form is cleared for the next entry.
    await expect(ui(page).getByLabel("Formula", { exact: true })).toHaveValue("");
  });

  test("can't open the add-client page", async ({ page }) => {
    await page.goto("/clients");
    await expect(ui(page).getByRole("link", { name: "Add client" })).toHaveCount(0);
    await page.goto("/clients/new");
    await expect(page).toHaveURL("/clients");
  });
});
