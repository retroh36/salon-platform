import { addDays, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Bridal and events: setting one up fast (Denise drafts it from one line,
// staff check it and save an Inquiry), and an inquiry from the booking site
// the desk opens in the builder.

const TZ = "America/Chicago";
const PREFIX = `Ev${Date.now().toString(36)}`;
// A Saturday well clear of the demo month.
const DAY = (() => {
  let d = addDays(todayIn(TZ), 150);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 6) d = addDays(d, 1);
  return d;
})();
const SAID = new Date(`${DAY}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

let clientId: string;

test.beforeAll(async () => {
  const { data } = await admin.from("clients").insert({ business_id: SEED.business, first_name: `${PREFIX}Mia`, last_name: "Rossi", email: `${PREFIX.toLowerCase()}@example.test` }).select("id").single();
  clientId = data!.id;
});

test.afterAll(async () => {
  await admin.from("events").delete().eq("business_id", SEED.business).or(`title.ilike.${PREFIX}%,client_id.eq.${clientId}`);
  await admin.from("events").delete().eq("business_id", SEED.business).ilike("title", `${PREFIX}%`);
  const { data: inquiries } = await admin.from("clients").select("id").ilike("first_name", `${PREFIX}%`);
  const ids = (inquiries ?? []).map((c) => c.id);
  await admin.from("events").delete().in("client_id", ids);
  await admin.from("clients").delete().in("id", ids);
});

test.use({ viewport: { width: 1440, height: 1100 } });

test("Denise drafts an event from one line; the desk checks it and saves an Inquiry", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.frontDesk });
  await page.goto("/events");
  await ui(page).getByRole("link", { name: "New event" }).click();
  await waitForHydration(page, "input[placeholder^='June 14']");
  const main = ui(page);
  await main.getByLabel("Describe it to Denise").fill(`${SAID} wedding, ready by 2pm, bride plus 5 bridesmaids hair and makeup, at the Grand Hotel`);
  await main.getByRole("button", { name: "Draft it" }).click();
  await expect(main.getByTestId("denise-drafted")).toContainText("I've filled in 6 people");

  // The draft: the date, ready-by, where, the party with packages.
  await expect(main.getByLabel("Date")).toHaveValue(DAY);
  await expect(main.getByLabel("Ready by")).toHaveValue("14:00");
  await expect(main.getByLabel("Venue")).toHaveValue("The Grand Hotel");
  await expect(main.getByTestId("party-member")).toHaveCount(6);
  await expect(main.getByLabel("Package for Bride", { exact: true })).toHaveValue("ee000000-0000-4000-8000-000000000001");
  await expect(main.getByLabel("Package for Bridesmaid 3", { exact: true })).toHaveValue("ee000000-0000-4000-8000-000000000003");
  // $450 + 5 × $220, a 20% service charge and the $75 travel fee; 30% to book.
  await expect(main.getByTestId("total")).toHaveText("$1,935");
  await expect(main.getByTestId("deposit")).toHaveText("$580.50");
  // The timeline, back from 2pm, with a team suggested for each artist.
  await expect(main.getByTestId("hair-lanes")).toHaveText("2");
  await expect(main.getByTestId("timeline")).toContainText("Ready by 2pm");
  await expect(main.getByLabel("Hair artist 1")).not.toHaveValue("");

  // Adjust: one more bridesmaid with one tap, and a name.
  await main.getByRole("button", { name: "+ Bridesmaid" }).click();
  await expect(main.getByTestId("party-member")).toHaveCount(7);
  await main.getByLabel("Name of person 1").fill("Mia");
  await main.getByLabel("Name", { exact: true }).fill(`${PREFIX} Rossi wedding`);
  await main.getByLabel("Find a client").fill(`${PREFIX}mia`);
  await main.getByRole("list", { name: "Matching clients" }).getByRole("button").first().click();

  await main.getByRole("button", { name: "Save as inquiry" }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  await expect(ui(page).getByRole("heading", { name: `${PREFIX} Rossi wedding` })).toBeVisible();
  await expect(ui(page).getByText("Inquiry", { exact: true })).toBeVisible();
  await expect(ui(page).getByTestId("party").getByRole("listitem")).toHaveCount(7);
  await expect(ui(page).getByTestId("timeline")).toContainText("Mia · Hair");

  const { data: saved } = await admin.from("events").select("status, source, event_members(count), event_tasks(count)").ilike("title", `${PREFIX} Rossi%`).single();
  expect(saved).toMatchObject({ status: "inquiry", source: "denise", event_members: [{ count: 7 }] });
  await page.close();
});

test("an inquiry from the booking site opens in the builder with the party started", async ({ browser }) => {
  const site = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await site.goto("/book/maple-and-ash");
  await site.getByRole("link", { name: "Planning a wedding or event?" }).click();
  await waitForHydration(site, "input[type=date]");
  await site.getByLabel("Date").fill(DAY);
  await site.getByLabel("Ready by").fill("11:00");
  await site.getByLabel("Where").fill("Lakeside Barn, Geneva");
  await site.getByLabel("How many people need hair or makeup?").fill("4");
  await site.getByLabel("First name").fill(`${PREFIX}Ines`);
  await site.getByLabel("Last name").fill("Park");
  await site.getByLabel("Email").fill(`${PREFIX.toLowerCase()}.ines@example.test`);
  await site.getByRole("button", { name: "Send inquiry" }).click();
  await expect(site.getByTestId("inquiry-sent")).toContainText("has your inquiry");
  await site.close();

  const page = await browser.newPage({ storageState: AUTH.frontDesk });
  await page.goto("/events");
  await ui(page).getByRole("link", { name: new RegExp(`${PREFIX}Ines's wedding`) }).click();
  await expect(ui(page).getByText("Nobody in the party yet. They asked for: hair and makeup.")).toBeVisible();
  await ui(page).getByRole("link", { name: "Edit event" }).click();
  await waitForHydration(page, "input[aria-label='Name of person 1']");
  await expect(ui(page).getByText(/From the booking site: 4 people, hair and makeup/)).toBeVisible();
  await expect(ui(page).getByTestId("party-member")).toHaveCount(4);
  await expect(ui(page).getByLabel("Venue")).toHaveValue("Lakeside Barn, Geneva");
  await expect(ui(page).getByLabel("Ready by")).toHaveValue("11:00");
  await ui(page).getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  await expect(ui(page).getByTestId("party").getByRole("listitem")).toHaveCount(4);
  await page.close();
});

test("an owner sets up event packages and bridal settings", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.owner });
  await page.goto("/settings/events");
  await waitForHydration(page, "form[aria-label='New event package'] input");
  await expect(ui(page).getByRole("list", { name: "Event packages" })).toContainText("Bride hair + makeup");
  const form = ui(page).getByRole("form", { name: "New event package" });
  await form.getByLabel("Name").fill(`${PREFIX} Groom grooming`);
  await form.getByLabel("Usually for").selectOption("groom");
  await form.getByLabel("Hair (minutes)").fill("30");
  await form.getByLabel("Price ($)").fill("85");
  await form.getByRole("button", { name: "Add package" }).click();
  await expect(form.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(ui(page).getByRole("list", { name: "Event packages" })).toContainText(`${PREFIX} Groom grooming`);
  await expect(ui(page).getByLabel("Contract terms")).toHaveValue(/Booking\. Your date is held/);
  await admin.from("event_packages").delete().ilike("name", `${PREFIX}%`);
  await page.close();
});
