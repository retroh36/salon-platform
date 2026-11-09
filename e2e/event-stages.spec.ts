import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// The Events board's stages: an owner adds one, and an event goes in it.

const NAME = `Venue ${Date.now().toString(36)}`;
test.use({ storageState: AUTH.owner });

let event: string;
let before: { id: string; name: string; kind: string | null }[];

test.beforeAll(async () => {
  const { data } = await admin.from("event_stages").select("id, name, kind").eq("business_id", SEED.business).order("position");
  before = data!;
  const { data: location } = await admin.from("locations").select("id").eq("business_id", SEED.business).limit(1).single();
  const { data: e, error } = await admin.from("events").insert({ business_id: SEED.business, location_id: location!.id, title: `${NAME} wedding`, event_date: "2031-06-07" }).select("id").single();
  if (error) throw error;
  event = e.id;
});

test.afterAll(async () => {
  await admin.from("events").delete().eq("id", event);
  await admin.from("event_stages").delete().eq("business_id", SEED.business).is("kind", null);
  for (const [position, s] of before.entries()) await admin.from("event_stages").update({ name: s.name, position }).eq("id", s.id);
});

test("an owner adds a stage, and an event goes in it and comes back out", async ({ page }) => {
  await page.goto("/settings/events");
  const editor = ui(page).getByTestId("event-stages");
  await waitForHydration(page, "[data-testid=event-stages] button");
  await editor.getByRole("button", { name: "Add stage" }).click();
  await editor.getByRole("textbox", { name: "Stage name" }).fill(NAME);
  await editor.getByRole("button", { name: "Save stages" }).click();
  await expect(editor.getByText("Stages saved.")).toBeVisible();

  await page.goto("/events");
  const pipeline = ui(page).getByRole("list", { name: "Pipeline" });
  await expect(pipeline.getByRole("heading", { name: new RegExp(NAME) })).toBeVisible();

  await page.goto(`/events/${event}`);
  await waitForHydration(page, "select");
  const stage = ui(page).getByRole("combobox", { name: "Stage" });
  await stage.selectOption({ label: NAME });
  await expect.poll(async () => (await admin.from("events").select("stage_id").eq("id", event).single()).data!.stage_id).not.toBeNull();

  await page.goto("/events");
  const own = ui(page).getByRole("list", { name: "Pipeline" }).locator("> li").filter({ has: page.getByRole("heading", { name: new RegExp(NAME) }) });
  await expect(own.getByText(`${NAME} wedding`)).toBeVisible();
});
