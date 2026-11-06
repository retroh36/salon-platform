// Client reports (/clients/reports): filters set by hand, the same columns
// every time, saved to run again, downloaded (logged); a stylist gets only
// their own clients, no spend and no download.
import { admin, SEED, throwawayStylist } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";
import { encodeReport, EMPTY_REPORT } from "@/lib/client-reports";

const B = SEED.business;
const L = SEED.location;
const TAG = `Cr${Date.now().toString(36)}`;
let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
let regular: string;
let colorId: string;

async function completedVisit(client: string, day: string) {
  const start = new Date(`${day}T15:00:00Z`);
  const end = new Date(start.getTime() + 60 * 60_000);
  const { data: a, error } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: client, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "completed" }).select("id").single();
  if (error) throw error;
  const { error: e } = await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a.id, service_id: colorId, staff_id: stylist.id, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: 9000 });
  if (e) throw e;
}

test.beforeAll(async () => {
  stylist = await throwawayStylist(`${TAG}Rae`);
  colorId = (await admin.from("services").select("id").eq("business_id", B).eq("category", "Color").limit(1).single()).data!.id;
  await admin.from("staff_services").insert({ business_id: B, staff_id: stylist.id, service_id: colorId });
  regular = (await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Ava`, last_name: "Report" }).select("id").single()).data!.id;
  for (const day of ["2019-02-05", "2019-05-07", "2019-09-10"]) await completedVisit(regular, day);
});

test.afterAll(async () => {
  await admin.from("saved_reports").delete().like("name", `${TAG}%`);
  await admin.from("appointments").delete().eq("client_id", regular);
  await admin.from("clients").delete().eq("id", regular);
  await admin.from("staff_services").delete().eq("staff_id", stylist.id);
  await stylist.remove();
});

test.describe("a manager", () => {
  test.use({ storageState: AUTH.manager });

  test("builds a report by hand, saves it, runs it again and downloads it", async ({ page }) => {
    await page.goto("/clients");
    await ui(page).getByRole("link", { name: "Client reports" }).click();
    await expect(page).toHaveURL(/\/clients\/reports$/);
    const form = ui(page).getByRole("form", { name: "Report filters" });
    await waitForHydration(page, "form[aria-label='Report filters'] select");

    await form.getByRole("group", { name: "Categories" }).getByLabel("Color", { exact: true }).check();
    await form.getByRole("group", { name: "Stylists" }).getByLabel(`${TAG}Rae`).check();
    await form.getByRole("combobox", { name: /^Counted from/ }).selectOption({ label: "On a date…" });
    await form.getByLabel("Counted from: date").fill("2019-01-01");
    await form.getByRole("combobox", { name: /^Until/ }).selectOption({ label: "On a date…" });
    await form.getByLabel("Until: date").fill("2020-01-01");
    await form.getByLabel("At least (visits)").fill("3");
    await form.getByRole("combobox", { name: /^No visit since/ }).selectOption({ label: "Start of this year" });
    await form.getByRole("button", { name: "Run report" }).click();

    const results = ui(page).getByRole("region", { name: /Results/ });
    await expect(results).toContainText(`Clients with 3 or more Color visits with ${TAG}Rae from Jan 1, 2019 until Jan 1, 2020, and no visit since the start of this year.`);
    const table = results.getByRole("table", { name: "Report", exact: true });
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table.getByRole("row").nth(1)).toContainText(`${TAG}Ava Report`);
    await expect(table.getByRole("row").nth(1)).toContainText("Sep 10, 2019");

    // Downloaded, and logged first.
    const download = page.waitForEvent("download");
    await results.getByRole("button", { name: "Export CSV" }).click();
    const csv = (await (await (await download).createReadStream()).toArray()).join("");
    expect(csv.split("\r\n")[0]).toBe("First name,Last name,Phone,Visits counted,Last visit,Next visit,Usual stylist,Spend");
    expect(csv).toContain(`${TAG}Ava,Report,,3,2019-09-10,,,`);
    await expect.poll(async () => (await admin.from("data_exports").select("row_counts").eq("business_id", B).order("created_at", { ascending: false }).limit(1).single()).data?.row_counts).toEqual({ client_report: 1 });

    // Saved, shared, and run again from the list.
    await results.getByTestId("save-report").click();
    const save = ui(page).getByRole("form", { name: "Save report" });
    await save.getByLabel("Name").fill(`${TAG} Lapsed color`);
    await save.getByLabel("Share with the team").check();
    await save.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\?saved=/);
    await expect(ui(page).getByRole("heading", { level: 1 })).toHaveText(`${TAG} Lapsed color`);
    const saved = ui(page).getByRole("table", { name: "Saved reports" });
    await expect(saved.getByRole("row", { name: new RegExp(`${TAG} Lapsed color`) })).toContainText("Shared");
    await expect(ui(page).getByRole("table", { name: "Report", exact: true }).getByRole("row")).toHaveCount(2);

    await saved.getByRole("button", { name: `Remove ${TAG} Lapsed color` }).click();
    await expect(page).toHaveURL(/\/clients\/reports$/);
    await expect(ui(page).getByRole("table", { name: "Saved reports" })).toHaveCount(0);
  });
});

test.describe("a stylist", () => {
  test.use({ storageState: AUTH.stylist });

  test("gets only their own clients, with no stylists, spend or download", async ({ page }) => {
    const report = encodeReport({ ...EMPTY_REPORT, categories: ["Color"], from: "2019-01", to: "2020-01", minVisits: 3 });
    await page.goto(`/clients/reports?r=${report}`);
    const form = ui(page).getByRole("form", { name: "Report filters" });
    await expect(form.getByRole("group", { name: "Categories" }).getByLabel("Color", { exact: true })).toBeChecked();
    await expect(form.getByRole("group", { name: "Stylists" })).toHaveCount(0);
    await expect(form.getByLabel("Spent at least ($)")).toHaveCount(0);
    await expect(ui(page).getByText("No clients match")).toBeVisible();
    await expect(ui(page).getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  });
});
