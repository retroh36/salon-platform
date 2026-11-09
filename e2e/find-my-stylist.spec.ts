import { addDays, fromLocal, todayIn } from "../lib/scheduling/time";
import { admin, openAllDay, SEED, throwawayStylist } from "../tests/db/helpers";
import { AUTH, expect, test, waitForHydration } from "./fixtures";

// A client takes the quiz on the booking site and gets a match to book.
const SITE = "/book/maple-and-ash";
const made: string[] = [];

test.afterAll(async () => {
  if (made.length) await admin.from("stylist_quizzes").delete().in("id", made);
});

test.describe("the client", () => {
test.use({ storageState: { cookies: [], origins: [] } });

test("the quiz suggests a service and stylists, each going to the booking flow", async ({ page }) => {
  await page.goto(SITE);
  await page.getByRole("link", { name: "Find my stylist" }).click();
  await expect(page.getByRole("heading", { name: "Find my stylist" })).toBeVisible();
  await waitForHydration(page, "button");
  const see = page.getByRole("button", { name: "See my match" });
  await expect(see).toBeDisabled();
  await page.getByRole("radiogroup", { name: "What are you looking for?" }).or(page.getByRole("group", { name: "What are you looking for?" })).getByText("Color", { exact: true }).click();
  await page.getByText("A refresh of what I have").click();
  await page.getByText("Very long", { exact: true }).click();
  await see.click();
  const result = page.getByTestId("quiz-result");
  await expect(result).toBeVisible();
  await expect(result.getByText("We suggest")).toBeVisible();
  const first = page.getByTestId("quiz-stylist").first();
  const link = first.getByRole("link", { name: /^Book with / });
  const href = (await link.getAttribute("href"))!;
  const quiz = new URL(href, "http://x").searchParams.get("quiz")!;
  made.push(quiz);
  const { data } = await admin.from("stylist_quizzes").select("business_id, flag_minutes, flag_reasons").eq("id", quiz).single();
  expect(data).toEqual({ business_id: SEED.business, flag_minutes: 15, flag_reasons: ["Very long hair"] });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`quiz=${quiz}`));
});
});

test.describe("the front desk", () => {
  const TZ = "America/Chicago";
  const DAY = addDays(todayIn(TZ), 2);
  const start = fromLocal(DAY, 19 * 60, TZ)!;
  let visitId: string;
  let clientId: string;
  let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
  let undoHours: () => Promise<void>;

  test.use({ storageState: AUTH.frontDesk });

  test.beforeAll(async () => {
    // A stylist of its own: nobody else is on their book.
    stylist = await throwawayStylist(`Quiz${Date.now().toString(36)}`);
    undoHours = await openAllDay([stylist.id], { date: DAY });
    const { data: c } = await admin.from("clients").insert({ business_id: SEED.business, first_name: "Quinn", last_name: `Quiz${Date.now().toString(36)}` }).select("id").single();
    clientId = c!.id;
    const { data: s } = await admin.from("services").select("id").eq("business_id", SEED.business).eq("name", "Women's Cut & Style").single();
    await admin.from("staff_services").insert({ business_id: SEED.business, staff_id: stylist.id, service_id: s!.id });
    const end = new Date(start.getTime() + 3_600_000);
    const { data: a } = await admin.from("appointments").insert({ business_id: SEED.business, location_id: SEED.location, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "booked" }).select("id").single();
    visitId = a!.id;
    await admin.from("appointment_items").insert({ business_id: SEED.business, location_id: SEED.location, appointment_id: visitId, service_id: s!.id, staff_id: stylist.id, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, processing_minutes: 0, finishing_minutes: 0, price_cents: 8000 });
    const { data: q } = await admin
      .from("stylist_quizzes")
      .insert({ business_id: SEED.business, appointment_id: visitId, client_id: clientId, answers: { category: "Color", change: "complete", length: "very_long", history: [], budget: "any", notes: "Ends are dry" }, flag_minutes: 15, flag_reasons: ["Very long hair"] })
      .select("id")
      .single();
    made.push(q!.id);
  });

  test.afterAll(async () => {
    await admin.from("appointments").delete().eq("id", visitId);
    await admin.from("clients").delete().eq("id", clientId);
    await undoHours();
    await stylist.remove();
  });

  test("reads the answers and adds the extra time", async ({ page }) => {
    await page.goto(`/calendar?date=${DAY}&open=${visitId}`);
    const card = page.getByTestId("visit-quiz");
    await expect(card.getByText("Ends are dry")).toBeVisible();
    await expect(card.getByTestId("quiz-flag")).toContainText("May need 15 min more: very long hair.");
    await waitForHydration(page, "[data-testid=quiz-flag] button");
    await card.getByRole("button", { name: "Add 15 min" }).click();
    await expect(card.getByText("15 min added")).toBeVisible();
    const { data } = await admin.from("appointment_items").select("active_minutes, processing_minutes, finishing_minutes").eq("appointment_id", visitId).single();
    expect(data!.active_minutes + data!.processing_minutes + data!.finishing_minutes).toBe(75);
  });
});
