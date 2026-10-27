import type { Page } from "@playwright/test";
import { fromLocal, todayIn } from "@/lib/scheduling/time";
import { admin, countFor, SEED, throwawayStylist } from "../tests/db/helpers";
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
  return ui(page).getByRole("table", { name: "Clients" }).locator("tbody").getByRole("row");
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
    await form.getByLabel("Preferred stylist", { exact: true }).selectOption({ label: "Sandra Whitfield" });
    await expect(form.getByLabel("Signed on")).toBeDisabled();
    await form.getByLabel("Consent form signed").check();
    await expect(form.getByLabel("Signed on")).toBeEnabled();
    await form.getByLabel("Signed on").fill("2026-01-15");
    await form.getByRole("button", { name: "Add client" }).click();

    await expect(form.getByRole("alert")).toHaveText("Fix the highlighted fields.");
    await expect(form.getByText("Enter a 10-digit phone number.")).toBeVisible();
    await expect(form.getByText("Enter a valid email address.")).toBeVisible();
    await expect(form.getByLabel("First name")).toHaveValue(`${PREFIX} Rosa`);
    await expect(form.getByLabel("Preferred stylist", { exact: true })).toHaveValue(SEED.staff.sandra);
    await expect(form.getByLabel("Consent form signed")).toBeChecked();
    await expect(form.getByLabel("Signed on")).toHaveValue("2026-01-15");

    await form.getByLabel("Phone", { exact: true }).fill("312 555 0177");
    await form.getByLabel("Email", { exact: true }).fill("rosa.delgado@example.com");
    await form.getByRole("button", { name: "Add client" }).click();

    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
    await expect(ui(page).getByRole("heading", { level: 1 })).toHaveText(`${PREFIX} Rosa Delgado`);
    await expect(ui(page).getByTestId("client-contact")).toHaveText(/\(312\) 555-0177\s*rosa\.delgado@example\.com/);
    await expect(ui(page).getByRole("note", { name: "Allergies" })).toContainText("Fragrance sensitivity");

    // Findable straight away.
    await openClients(page);
    await ui(page).getByRole("searchbox", { name: "Search clients" }).fill("0177");
    await expect(results(page).filter({ hasText: `${PREFIX} Rosa Delgado` })).toBeVisible();
  });

  test("edit a client's details from the profile, opening the form only when asked", async ({ page }) => {
    const { data } = await admin
      .from("clients")
      .insert({ business_id: SEED.business, first_name: `${PREFIX} Edit`, last_name: "Me", phone: "(312) 555-0178", notes: "Keep me." })
      .select("id")
      .single();
    await page.goto(`/clients/${data!.id}`);
    // View mode: the contact details are text (tap to call), no form.
    await expect(ui(page).getByRole("link", { name: "(312) 555-0178" })).toHaveAttribute("href", "tel:(312) 555-0178");
    await expect(ui(page).getByLabel("First name")).toHaveCount(0);

    await ui(page).getByRole("link", { name: "Edit details" }).click();
    await expect(page).toHaveURL(`/clients/${data!.id}/edit`);
    await waitForHydration(page, "input[name=first_name]");
    // Notes aren't in the details form: they're on the profile.
    await expect(ui(page).getByLabel("Notes", { exact: true })).toHaveCount(0);
    await ui(page).getByLabel("Phone", { exact: true }).fill("(312) 555-0179");
    await ui(page).getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(`/clients/${data!.id}`);
    await expect(ui(page).getByRole("link", { name: "(312) 555-0179" })).toBeVisible();
    // Saving the details leaves the notes as they were.
    await expect(ui(page).getByTestId("notes-text")).toHaveText("Keep me.");
  });

  test("notes save at the top of the profile and say who changed them", async ({ page }) => {
    const { data } = await admin.from("clients").insert({ business_id: SEED.business, first_name: `${PREFIX} Notes`, last_name: "Client", allergies: "Latex: nitrile gloves only." }).select("id").single();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/clients/${data!.id}`);
    await waitForHydration(page, "[data-testid=notes-text]");

    // Allergies first, at the very top, then the header, then the notes,
    // above the history.
    const top = async (selector: string) => (await page.locator(selector).filter({ visible: true }).first().boundingBox())!.y;
    const alert = ui(page).getByRole("note", { name: "Allergies" });
    await expect(alert).toContainText("Latex: nitrile gloves only.");
    expect(await top("[data-testid=allergy-alert]")).toBeLessThan(await top("[data-testid=client-header]"));
    expect(await top("[data-testid=client-header]")).toBeLessThan(await top("[data-testid=client-notes]"));
    expect(await top("[data-testid=client-notes]")).toBeLessThan(await top("[role=tablist]"));

    const notes = ui(page).getByTestId("client-notes");
    await expect(notes.getByTestId("notes-text")).toHaveText(/No notes yet/);
    await notes.getByTestId("notes-text").click();
    await notes.getByRole("textbox", { name: "Notes" }).fill("Prefers a quiet chair. Always offer an oat latte.");
    await expect(notes.getByRole("status")).toHaveText("Notes saved.");
    await expect(notes.getByTestId("notes-edited")).toHaveText(/^Edited by Sam Rivera on /);
    await notes.getByRole("button", { name: "Done" }).click();
    await expect(notes.getByTestId("notes-text")).toHaveText("Prefers a quiet chair. Always offer an oat latte.");

    await page.reload();
    await expect(ui(page).getByTestId("notes-text")).toHaveText("Prefers a quiet chair. Always offer an oat latte.");
    await expect(ui(page).getByTestId("notes-edited")).toHaveText(/^Edited by Sam Rivera on /);
  });

  test("the side column is a card each, today's visit is under Today, and the counts say what they count", async ({ page }) => {
    const { data: c } = await admin.from("clients").insert({ business_id: SEED.business, first_name: `${PREFIX} Cards`, last_name: "Client", notes: "Likes it short." }).select("id").single();
    // Its own stylist, so the visits never clash with the demo calendar.
    const stylist = await throwawayStylist(`${PREFIX} Cards`);
    const { data: svc } = await admin.from("services").select("id, active_minutes, price_cents").eq("business_id", SEED.business).eq("name", "Blowout").single();
    const visit = async (start: Date, status: "completed" | "canceled" | "checked_in") => {
      const end = new Date(start.getTime() + svc!.active_minutes * 60_000);
      const { data: a } = await admin
        .from("appointments")
        .insert({ business_id: SEED.business, location_id: SEED.location, client_id: c!.id, starts_at: start.toISOString(), ends_at: end.toISOString(), status, created_by: SEED.staff.frontDesk, ...(status === "canceled" && { canceled_at: start.toISOString(), cancel_reason: "Test" }), ...(status === "checked_in" && { checked_in_at: start.toISOString() }) })
        .select("id")
        .single();
      const { error } = await admin.from("appointment_items").insert({ business_id: SEED.business, location_id: SEED.location, appointment_id: a!.id, service_id: svc!.id, staff_id: stylist.id, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: svc!.active_minutes, processing_minutes: 0, finishing_minutes: 0, price_cents: svc!.price_cents });
      if (error) throw error;
    };
    const day = 86_400_000;
    // In the chair today since its booked time (which may be over).
    const dayStart = fromLocal(todayIn("America/Chicago"), 0, "America/Chicago")!;
    const here = new Date(Math.max(dayStart.getTime() + 60_000, Date.now() - 90 * 60_000));
    try {
      await visit(new Date(Date.now() - 60 * day), "completed");
      await visit(new Date(Date.now() - 30 * day), "completed");
      await visit(new Date(Date.now() - 20 * day), "canceled");
      await visit(here, "checked_in");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/clients/${c!.id}`);
      await waitForHydration(page, "[data-testid=notes-text]");

      // Today first, then the past; the tab's count is every visit, summed up.
      const visits = ui(page).getByTestId("client-visits");
      expect(await visits.locator("section").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["Today visits", "Past visits"]);
      await expect(visits.getByRole("region", { name: "Today visits" })).toContainText("Here now");
      await expect(visits.getByTestId("visits-summary")).toHaveText("4 visits: 2 completed, 1 today, 1 cancelled");
      await expect(ui(page).getByRole("tab", { name: /^Visits/ })).toContainText("4");
      // At a glance counts completed visits, and says so.
      const glance = ui(page).getByTestId("client-glance");
      await expect(glance.locator("[data-stat=visits]")).toHaveText(/Completed visits\s*2/);
      await expect(glance.locator("[data-stat=next]")).toContainText("Today");
      await expect(glance.getByTestId("last-visit")).toBeVisible();

      // A card each, in order, 12px corners, with the action in the corner.
      const aside = ui(page).getByRole("complementary", { name: "About this client" });
      const order = ["client-glance", "client-details", "client-packages", "client-memberships", "client-rewards", "client-card", "client-policy", "client-messages"];
      const shown = await aside.locator(":scope > section").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
      expect(shown.slice(0, 2)).toEqual(["client-glance", "client-details"]);
      expect(shown).toEqual(order.filter((t) => shown.includes(t)));
      expect(shown).toContain("client-messages");
      for (const radius of await aside.locator(":scope > section").evaluateAll((els) => els.map((e) => getComputedStyle(e).borderRadius))) expect(radius).toBe("12px");
      await expect(aside.getByTestId("client-details").getByRole("link", { name: /^Edit .*details$/ })).toHaveAttribute("href", `/clients/${c!.id}/edit`);
      // Messages as on/off rows.
      await expect(aside.getByRole("switch", { name: "Visit texts" })).toBeVisible();
      await expect(aside.getByTestId("offer-consent")).toContainText("Offer emails");

      // Notes: the box is the way in (no separate button), by click or key.
      await expect(ui(page).getByRole("button", { name: "Edit notes" })).toHaveCount(0);
      await ui(page).getByTestId("notes-text").focus();
      await page.keyboard.press("Enter");
      await expect(ui(page).getByRole("textbox", { name: "Notes" })).toHaveValue("Likes it short.");

      // Narrow: the cards stack under the history.
      await page.setViewportSize({ width: 800, height: 900 });
      const [tabs, glanceBox] = await Promise.all([ui(page).getByRole("tablist").boundingBox(), glance.boundingBox()]);
      expect(glanceBox!.y).toBeGreaterThan(tabs!.y);
    } finally {
      await admin.from("appointments").delete().eq("client_id", c!.id);
      await stylist.remove();
    }
  });

  test("Book on the profile starts a booking for the client on the calendar", async ({ page }) => {
    const { data } = await admin.from("clients").insert({ business_id: SEED.business, first_name: `${PREFIX} Book`, last_name: "Client", phone: "(312) 555-0186", allergies: "Fragrance" }).select("id").single();
    await page.goto(`/clients/${data!.id}`);
    await ui(page).getByRole("link", { name: "Book", exact: true }).click();
    const form = page.getByRole("form", { name: "New booking" });
    await expect(form.getByRole("region", { name: "Client" })).toContainText(`${PREFIX} Book Client`);
    await expect(form.getByRole("region", { name: "Client" })).toContainText("Fragrance");
    // The address is tidied, so a reload doesn't start another.
    await expect(page).toHaveURL(/\/calendar(\?date=[\d-]+)?$/);
  });

  test("patch tests and formulas open their add forms only when asked, and the tab is remembered", async ({ page }) => {
    const { data } = await admin.from("clients").insert({ business_id: SEED.business, first_name: `${PREFIX} Tabs`, last_name: "Client" }).select("id").single();
    await page.goto(`/clients/${data!.id}`);
    await waitForHydration(page, "[role=tab]");
    const history = ui(page).getByRole("region", { name: "History" });

    // No history: one quiet line each, no blank forms.
    await expect(history.getByText("No visits yet.")).toBeVisible();
    await history.getByRole("tab", { name: /^Patch tests/ }).click();
    await expect(history.getByText("No patch tests yet.")).toBeVisible();
    await expect(history.getByRole("form", { name: "Record patch test" })).toHaveCount(0);

    await history.getByRole("button", { name: "Add patch test" }).click();
    const form = history.getByRole("form", { name: "Record patch test" });
    await expect(form).toBeVisible();
    await form.getByLabel("Products tested").fill("Shades EQ 6N + processing solution");
    await form.getByRole("button", { name: "Record patch test" }).click();
    // Saved: the form closes and the test is listed.
    await expect(form).toHaveCount(0);
    await expect(history.getByRole("list", { name: "Patch test history" })).toContainText("Shades EQ 6N + processing solution");

    await history.getByRole("tab", { name: /^Formulas/ }).click();
    await expect(history.getByText("No formulas yet.")).toBeVisible();
    await expect(history.getByRole("form", { name: "Add formula" })).toHaveCount(0);
    await history.getByRole("button", { name: "Add formula" }).click();
    await expect(history.getByRole("form", { name: "Add formula" })).toBeVisible();
    await history.getByRole("button", { name: "Cancel" }).click();
    await expect(history.getByRole("form", { name: "Add formula" })).toHaveCount(0);

    // The next profile opens on the tab last used.
    await page.reload();
    await expect(ui(page).getByRole("tab", { name: /^Formulas/ })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("front desk sorting", () => {
  test.use({ storageState: AUTH.frontDesk, viewport: { width: 1440, height: 900 } });

  // A column's figures, top to bottom.
  const column = async (page: Page, n: number) => (await results(page).locator(`td:nth-child(${n})`).allInnerTexts()).map((t) => t.trim());
  const money = (t: string) => (t === "—" ? -1 : Number(t.replace(/[$,]/g, "")));

  test("shows each client's last and next visit, usual stylist and spend, and sorts by any of them", async ({ page }) => {
    await openClients(page);
    const table = ui(page).getByRole("table", { name: "Clients" });
    await expect(table.getByRole("columnheader")).toHaveText(["Name", "Phone", "Last visit", "Next visit", "Usual stylist", "Spend"].map((h) => new RegExp(`^\\W?${h}`)));
    await expect(table.getByRole("columnheader", { name: /^Name/ })).toHaveAttribute("aria-sort", "ascending");

    // Biggest spenders first, then the other way round.
    await table.getByRole("link", { name: "Spend" }).click();
    await expect(page).toHaveURL(/sort=spend&dir=desc/);
    await expect(table.getByRole("columnheader", { name: /^Spend/ })).toHaveAttribute("aria-sort", "descending");
    const spend = (await column(page, 6)).map(money);
    expect(spend.length).toBeGreaterThan(10);
    expect(spend).toEqual([...spend].sort((a, b) => b - a));
    expect(spend[0]).toBeGreaterThan(0);
    await table.getByRole("link", { name: "Spend" }).click();
    await expect(page).toHaveURL(/sort=spend&dir=asc/);

    // Most recent visit first, matching the database.
    await table.getByRole("link", { name: "Last visit" }).click();
    await expect(page).toHaveURL(/sort=last_visit&dir=desc/);
    const first = results(page).first();
    const id = (await first.getByRole("link").first().getAttribute("href"))!.split("/").pop()!;
    const { data: latest } = await admin
      .from("appointments")
      .select("client_id, starts_at")
      .eq("business_id", SEED.business)
      .eq("status", "completed")
      .order("starts_at", { ascending: false })
      .limit(1)
      .single();
    const { data: mine } = await admin.from("appointments").select("starts_at").eq("client_id", id).eq("status", "completed").order("starts_at", { ascending: false }).limit(1).single();
    expect(mine!.starts_at).toBe(latest!.starts_at);

    // Searching keeps the sort.
    await ui(page).getByRole("searchbox", { name: "Search clients" }).fill("a");
    await expect(page).toHaveURL(/q=a&sort=last_visit&dir=desc/);
  });
});

test.describe("stylists", () => {
  test.use({ storageState: AUTH.stylist });

  test("see their clients' visits and usual stylist, but no spend", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openClients(page);
    const table = ui(page).getByRole("table", { name: "Clients" });
    await expect(table.getByRole("columnheader", { name: /^Usual stylist/ })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /^Spend/ })).toHaveCount(0);
    await page.goto("/clients?sort=spend&dir=desc");
    await expect(table.getByRole("columnheader", { name: /^Name/ })).toHaveAttribute("aria-sort", "descending");
  });

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
    await waitForHydration(page, "[role=tab]");

    // The same layout, read-only: notes at the top with no editing, no
    // Edit details or Book.
    await expect(ui(page).getByTestId("notes-text")).toHaveText("Growing out bangs.");
    await expect(ui(page).getByRole("button", { name: "Edit notes" })).toHaveCount(0);
    await expect(ui(page).getByRole("link", { name: "Edit details" })).toHaveCount(0);
    await expect(ui(page).getByRole("link", { name: "Book" })).toHaveCount(0);
    await expect(ui(page).getByLabel("First name")).toHaveCount(0);
    // No money for stylists.
    await expect(ui(page).getByTestId("client-stats").locator("[data-stat=spend]")).toHaveCount(0);

    await ui(page).getByRole("tab", { name: /^Formulas/ }).click();
    await expect(ui(page).getByText("No formulas yet.")).toBeVisible();
    await ui(page).getByRole("button", { name: "Add formula" }).click();
    await waitForHydration(page, "textarea[name=formula]");

    // An empty formula is rejected.
    await ui(page).getByRole("button", { name: "Save formula" }).click();
    await expect(ui(page).getByText("Enter the formula.")).toBeVisible();

    await ui(page).getByLabel("Formula", { exact: true }).fill("Roots: Shades EQ 6N + 6NB (1:1), 20 vol, 35 min");
    await ui(page).getByRole("form", { name: "Add formula" }).getByLabel("Notes (optional)").fill("Lifted fast; check at 30.");
    await ui(page).getByRole("button", { name: "Save formula" }).click();

    // Saved: the form closes and the newest formula is on top, marked.
    await expect(ui(page).getByRole("form", { name: "Add formula" })).toHaveCount(0);
    const entry = ui(page).getByTestId("latest-formula");
    await expect(entry).toContainText("Latest");
    await expect(entry).toContainText("Bridget Callahan");
    await expect(entry).toContainText("Roots: Shades EQ 6N + 6NB (1:1), 20 vol, 35 min");
    await expect(entry).toContainText("Lifted fast; check at 30.");
  });

  test("can't open the add-client page", async ({ page }) => {
    await page.goto("/clients");
    await expect(ui(page).getByRole("link", { name: "Add client" })).toHaveCount(0);
    await page.goto("/clients/new");
    await expect(page).toHaveURL("/clients");
  });
});
