import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Event automations: an owner adds one, an inquiry comes in, and the team's
// to-do shows on the event to tick off.

const TAG = `Auto${Date.now().toString(36)}`;
test.use({ storageState: AUTH.owner });

let event: string | null = null;

test.afterAll(async () => {
  if (event) await admin.from("events").delete().eq("id", event);
  await admin.from("event_automations").delete().eq("business_id", SEED.business).like("name", `${TAG}%`);
});

test("an inquiry adds the automation's to-do, which the desk ticks off", async ({ page }) => {
  await page.goto("/settings/events");
  const form = ui(page).getByRole("form", { name: "New automation" });
  await waitForHydration(page, "form[aria-label='New automation'] button[type=submit]");
  await form.getByLabel("Name").fill(`${TAG} call back`);
  await form.getByLabel("When").selectOption("inquiry_received");
  await form.getByLabel("Then").selectOption("task");
  await form.getByLabel("To-do", { exact: true }).fill(`${TAG} call them back`);
  await form.getByRole("button", { name: "Add automation" }).click();
  await expect(form.getByText("Automation saved.")).toBeVisible();
  await expect(ui(page).getByRole("list", { name: "Event automations" })).toContainText(`${TAG} call back`);

  const { data: location } = await admin.from("locations").select("id").eq("business_id", SEED.business).limit(1).single();
  const { data: e, error } = await admin.from("events").insert({ business_id: SEED.business, location_id: location!.id, title: `${TAG} wedding`, event_date: "2031-05-10" }).select("id").single();
  if (error) throw error;
  event = e.id;
  expect((await admin.rpc("claim_event_automations", { p_business_ids: [SEED.business] })).error).toBeNull();

  await page.goto(`/events/${event}`);
  const todos = ui(page).getByTestId("todos");
  await waitForHydration(page, "[data-testid=todos] input");
  const item = todos.getByRole("checkbox", { name: `${TAG} call them back` });
  await item.check();
  await expect.poll(async () => (await admin.from("event_todos").select("done_at").eq("event_id", event!).single()).data!.done_at).not.toBeNull();
  await expect(item).toBeChecked();
});
