import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, waitForHydration } from "./fixtures";

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
  await admin.from("client_cards").update({ authorization_id: null }).in("client_id", made);
  await admin.from("card_authorizations").delete().in("client_id", made);
  await admin.from("client_cards").delete().in("client_id", made);
  await admin.from("policy_consents").delete().in("client_id", made);
  await admin.from("outbox_messages").delete().like("body", `%${PREFIX}%`);
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

  test("a parent approves their card for their child, by link", async ({ page, browser }) => {
    const mom = await client("Ann");
    const kid = await client("Ivy");
    // Linked as the front desk would, and the parent's card on file.
    const { data: family } = await admin.from("families").insert({ business_id: SEED.business, name: `The ${PREFIX}`, payer_client_id: null }).select("id").single();
    await admin.from("clients").update({ family_id: family!.id }).in("id", [mom, kid]);
    const { data: consent } = await admin.from("policy_consents").insert({ business_id: SEED.business, client_id: mom, policy_text: "Policy.", terms: {}, channel: "link" }).select("id").single();
    await admin.from("client_cards").insert({ business_id: SEED.business, client_id: mom, provider: "test", payment_method_ref: "test_visa_4242", label: "Visa …4242", consent_id: consent!.id });

    await page.goto(`/clients/${kid}`);
    const card = page.getByTestId("client-card").filter({ visible: true });
    await expect(card.getByTestId("no-card")).toBeVisible();
    await card.getByRole("button", { name: `Use ${PREFIX}Ann's card…` }).click();
    const form = card.getByRole("form", { name: "Use a family member's card" });
    await expect(form.getByLabel(`${PREFIX}Ann's mobile number`)).not.toHaveValue("");
    await form.getByRole("button", { name: `Ask ${PREFIX}Ann` }).click();
    await expect(card.getByRole("status")).toContainText(`Sent to ${PREFIX}Ann`);
    await page.reload();
    await expect(page.getByTestId("authorization-waiting").filter({ visible: true })).toContainText(`Waiting for ${PREFIX}Ann to approve their card.`);

    // The fixed message, with the link (in the outbox until texts are live).
    const { data: sent } = await admin.from("outbox_messages").select("body").like("body", `%Hi ${PREFIX}Ann, ${PREFIX}Ivy's bookings can be held by your card on file (Visa …4242)%`);
    expect(sent).toHaveLength(1);
    const link = new URL(sent![0].body.match(/https?:\/\/\S+\/authorize\/[\w-]+/)![0]).pathname;

    // The parent, on their phone, signed out.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: { cookies: [], origins: [] } });
    try {
      const payer = await phone.newPage();
      await payer.goto(link);
      await expect(payer.getByRole("heading", { name: `Hi ${PREFIX}Ann` })).toBeVisible();
      await expect(payer.getByTestId("authorize-card")).toHaveText("Visa …4242");
      await expect(payer.getByTestId("policy")).toContainText(`Cancellation policy for ${PREFIX}Ivy's visits`);
      const approve = payer.getByRole("button", { name: "Approve" });
      await expect(approve).toBeDisabled();
      await waitForHydration(payer, "button[type=submit]");
      await payer.getByLabel("Your full name").fill(`${PREFIX}Ann Quill`);
      await payer.getByLabel(/I allow my card to hold/).check();
      await approve.click();
      await expect(payer.getByTestId("authorize-done")).toContainText(`${PREFIX}Ivy's bookings now use your card on file.`);
    } finally {
      await phone.close();
    }

    // The child's profile now has a card on file, from the parent's.
    await page.reload();
    const after = page.getByTestId("client-card").filter({ visible: true });
    await expect(after.getByTestId("card-on-file")).toHaveText(`Visa …4242 (${PREFIX}Ann's)`);
    await expect(after.getByTestId("card-authorized-by")).toContainText(`${PREFIX}Ann Quill`);
    await after.getByRole("button", { name: "Stop using this card" }).click();
    await expect(after.getByRole("status")).toContainText("no longer use that card");
    await page.reload();
    await expect(page.getByTestId("client-card").filter({ visible: true }).getByTestId("no-card")).toBeVisible();
  });
});
