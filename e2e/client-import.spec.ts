import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// An owner uploads a CSV, checks the columns, imports it, and undoes it.
const TAG = `Csv${Date.now().toString(36)}`;
const B = SEED.business;

test.afterAll(async () => {
  await admin.from("clients").delete().eq("business_id", B).like("first_name", `${TAG}%`);
  await admin.from("client_imports").delete().eq("business_id", B).eq("file_name", `${TAG}.csv`);
});

test.use({ storageState: AUTH.owner });

test("imports a file, says what it couldn't read, and can be undone", async ({ page }) => {
  await page.goto("/settings/import");
  await waitForHydration(page, "input[type=file]");
  const csv = `First Name,Surname,Mobile,Email\n${TAG}Ava,Lee,(872) 555-01${String(Date.now() % 100).padStart(2, "0")},${TAG}@example.test\n${TAG}Bo,Ray,123,\n,,,\n,NoFirst,,\n`;
  await ui(page).getByLabel("CSV file").setInputFiles({ name: `${TAG}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(ui(page).getByTestId("import-summary")).toContainText("2 clients to import, of 3 rows");
  await expect(ui(page).getByTestId("import-problems")).toContainText("1 with no name");
  await expect(ui(page).getByTestId("import-problems")).toContainText("1 with a phone number we can't read");
  await ui(page).getByRole("button", { name: "Import 2 clients" }).click();
  await expect(ui(page).getByRole("status")).toContainText("Added 2 clients.");
  const row = ui(page).getByTestId("past-import").filter({ hasText: `${TAG}.csv` });
  await row.getByRole("button", { name: "Undo" }).click();
  await row.getByRole("button", { name: "Yes, remove" }).click();
  await expect(row).toContainText("Undone, 2 removed");
  await expect.poll(async () => (await admin.from("clients").select("id").eq("business_id", B).like("first_name", `${TAG}%`)).data?.length).toBe(0);
});
