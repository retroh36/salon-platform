// A task Denise prepared ("change Tasha's cut to 50 minutes") as a card in
// her chat: Confirm changes the times, Undo puts them back, and what came of
// it stays with the card after a reload. (Her reading of the question needs
// the real API, which browser tests never call: the card is put in her
// conversation as she'd leave it, over a proposal recorded as hers.)
import { admin, SEED, throwawayStylist } from "../tests/db/helpers";
import { AUTH, expect, test } from "./fixtures";

const B = SEED.business;
let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
let cut: string;
let actionId: string;

const ownCut = async () => (await admin.from("staff_services").select("active_minutes").eq("staff_id", stylist.id).eq("service_id", cut).single()).data?.active_minutes ?? null;

test.beforeAll(async () => {
  stylist = await throwawayStylist(`Tasha${Date.now().toString(36)}`);
  cut = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single()).data!.id;
  await admin.from("staff_services").insert({ business_id: B, staff_id: stylist.id, service_id: cut });
  const { data, error } = await admin
    .from("ai_actions")
    .insert({
      business_id: B,
      location_id: SEED.location,
      feature: "task",
      summary: "Tasha's Women's Cut & Style: 50 min",
      reason: "New bookings with Tasha use this; visits already booked keep their own.",
      proposed_by: SEED.staff.manager,
      proposal: { kind: "service_times", staff_id: stylist.id, changes: [{ service_id: cut, from: null, to: { active: 50, processing: 0, finishing: 0 } }] },
    })
    .select("id")
    .single();
  if (error) throw error;
  actionId = data.id;
});

test.afterAll(async () => {
  await admin.from("ai_actions").delete().eq("id", actionId);
  await admin.from("staff_services").delete().eq("staff_id", stylist.id);
  await stylist.remove();
});

test.use({ storageState: AUTH.manager });

test("a manager confirms a task from Denise's chat, then undoes it", async ({ page }) => {
  const chat = [
    { role: "user", text: "Change Tasha's cut to 50 minutes" },
    {
      role: "denise",
      text: "I've prepared Tasha's Women's Cut & Style at 50 min. Confirm it below.",
      tasks: [{ actionId, summary: "Tasha's Women's Cut & Style: 50 min", lines: ["Women's Cut & Style: 1 hr → 50 min"], reason: "New bookings with Tasha use this; visits already booked keep their own." }],
    },
  ];
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, value);
    },
    [`maestra:denise:${SEED.staff.manager}`, JSON.stringify({ chat, open: false, min: false })],
  );
  await page.goto("/team");
  await page.getByTestId("denise-sidebar-launcher").click();
  const card = page.getByTestId("denise-task");
  await expect(card).toContainText("Women's Cut & Style: 1 hr → 50 min");
  expect(await ownCut()).toBeNull();

  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card).toContainText("Done. New bookings use the new times.");
  expect(await ownCut()).toBe(50);

  // What came of it stays with the card.
  await page.getByTestId("denise-sidebar-launcher").click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await page.getByTestId("denise-sidebar-launcher").click();
  await expect(card.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  await card.getByRole("button", { name: "Undo" }).click();
  await expect(card).toContainText("Undone. The times are back as they were.");
  expect(await ownCut()).toBeNull();
  await expect(card.getByRole("button", { name: "Undo" })).toHaveCount(0);
});
