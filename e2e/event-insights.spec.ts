import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Bridal and events, stage 4, on the demo events: Denise's brief flags
// what could go wrong with the events coming up (each linking to the event
// and dismissable), the board shows every stage, and the report adds them
// up for owners.

test.use({ storageState: AUTH.owner, viewport: { width: 1440, height: 2600 } });

test.afterAll(async () => {
  await admin.from("denise_dismissals").delete().eq("location_id", SEED.location).like("item_key", "event:%");
});

test("Denise's brief flags the events coming up, each one linking to its event", async ({ page }) => {
  await page.goto("/dashboard");
  const events = ui(page).getByTestId("brief-events");
  await expect(events.getByRole("heading", { name: /Events coming up/ })).toBeVisible();
  const rossi = events.getByRole("link").filter({ hasText: "A payment didn't go through. Try the card again, or send a card link." });
  await expect(rossi).toContainText(/Rossi wedding (today|tomorrow|in \d days)/);
  await expect(events).toContainText("The trial isn't booked yet.");
  await expect(events).toContainText("Nola has time off then. Choose someone else.");

  await waitForHydration(page, "[data-testid=brief-events] button");
  const trial = events.getByRole("button", { name: /^Dismiss Okafor wedding in \d+ days: The trial isn't booked yet\.$/ });
  await trial.click();
  await expect(events).not.toContainText("The trial isn't booked yet.");
  await expect(events).toContainText("Nola has time off then.");

  await rossi.click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  await expect(ui(page).getByRole("heading", { level: 1 })).toHaveText("Rossi wedding");
  await expect(ui(page)).toContainText("The look");
});

test("the board shows the demo events at every stage", async ({ page }) => {
  await page.goto("/events");
  const main = ui(page);
  await expect(main.getByTestId("column-inquiry")).toContainText("Alvarez quinceañera");
  await expect(main.getByTestId("column-inquiry")).toContainText("Linh's wedding");
  await expect(main.getByTestId("column-proposal_sent")).toContainText("Patel wedding");
  await expect(main.getByTestId("column-booked")).toContainText("Okafor wedding");
  await expect(main.getByTestId("column-trial_done")).toContainText("Rossi wedding");
  await expect(main.getByTestId("column-event_day")).toContainText("Brooks wedding");
  await expect(main.getByTestId("column-completed")).toContainText("Harper wedding");
  await expect(main.getByTestId("column-lost")).toContainText("Went with another salon");
});

test("the report adds up event value, conversion and deposits", async ({ page }) => {
  const { data: patel } = await admin.from("events").select("deposit_cents").eq("title", "Patel wedding").single();
  await page.goto("/reports");
  const card = ui(page).getByRole("region", { name: "Bridal and events" });
  const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
  await expect(card.getByTestId("event-deposits-waiting")).toHaveText(dollars(patel!.deposit_cents));
  await expect(card).toContainText("1 proposal out");
  await expect(card.getByRole("table", { name: "Events by month" }).getByTestId("event-month").first()).toBeVisible();
});
