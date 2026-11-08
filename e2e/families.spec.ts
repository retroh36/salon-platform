import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test } from "./fixtures";

// Families on the client profile: the front desk links a parent and child,
// names who usually pays, and the stylist sees it without changing it.
const PREFIX = `Fam${crypto.randomUUID().slice(0, 6)}`;
const made: string[] = [];

async function client(first: string) {
  const { data, error } = await admin.from("clients").insert({ business_id: SEED.business, first_name: `${PREFIX}${first}`, last_name: "Quill", phone: `31255${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}` }).select("id").single();
  if (error) throw error;
  made.push(data.id);
  return data.id;
}

test.afterAll(async () => {
  const { data } = await admin.from("clients").select("family_id").in("id", made);
  const families = [...new Set((data ?? []).map((c) => c.family_id).filter(Boolean))] as string[];
  if (families.length) await admin.from("families").delete().in("id", families);
  await admin.from("clients").delete().in("id", made);
});

test.describe("families", () => {
  test.use({ storageState: AUTH.frontDesk });

  test("links a parent and child, with who usually pays, and unlinks them", async ({ page }) => {
    const mom = await client("Jo");
    const kid = await client("Tam");
    await page.goto(`/clients/${mom}`);
    const card = page.getByTestId("client-family");
    await expect(card).toContainText("Not linked to a family");
    await card.getByRole("button", { name: "Add family" }).click();
    const form = card.getByRole("form", { name: "Family" });
    await expect(form.getByLabel("Family name")).toHaveValue("The Quills");
    await form.getByLabel("Add someone").fill(`${PREFIX}Tam`);
    await form.getByRole("list", { name: "Matching clients" }).getByRole("button", { name: new RegExp(`${PREFIX}Tam Quill`) }).click();
    await form.getByRole("radio", { name: `${PREFIX}Jo Quill` }).check();
    await form.getByRole("button", { name: "Save" }).click();
    await expect(card.getByRole("status")).toHaveText("Family saved.");
    await expect(card).toContainText("The Quills");
    const members = card.getByRole("list", { name: "Family members" });
    await expect(members.getByRole("listitem")).toHaveCount(2);
    await expect(members.getByRole("listitem").filter({ hasText: `${PREFIX}Jo` })).toContainText("Usually pays");

    // The child's profile shows the same family, the parent as a link.
    await members.getByRole("link", { name: `${PREFIX}Tam Quill` }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${kid}`));
    // The page before stays in the document, hidden: only the shown card.
    const kidCard = page.getByTestId("client-family").filter({ visible: true });
    await expect(kidCard.getByRole("link", { name: `${PREFIX}Jo Quill` })).toBeVisible();

    // Removing the family unlinks both; each keeps their profile.
    await kidCard.getByRole("button", { name: "Edit" }).click();
    await kidCard.getByRole("button", { name: "Remove family" }).click();
    await expect(kidCard.getByRole("status")).toContainText("Family removed");
    await expect(kidCard).toContainText("Not linked to a family");
    expect((await admin.from("clients").select("family_id").in("id", [mom, kid])).data!.every((c) => c.family_id === null)).toBe(true);
  });
});
