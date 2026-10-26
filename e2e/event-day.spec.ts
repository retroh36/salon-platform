import { lanesFor, saveInput, timelineOf, type BuilderState } from "@/lib/events/builder";
import { loadEventSettings, loadPackages } from "@/lib/events/load";
import { sha256 } from "@/lib/online-booking/security";
import { saveBooking } from "@/lib/scheduling/book";
import { laneSpans } from "@/lib/scheduling/events";
import { loadBookingContext } from "@/lib/scheduling/load";
import { findOpenings } from "@/lib/scheduling/openings";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { admin, SEED, signIn } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Bridal and events, stage 3: the timeline dragged in the builder and
// checked again as it moves, the booked team held on the calendar (one
// block each, with travel) so nobody is double-booked, the trial booked
// from the event, the look, the day-of sheet, and headcount changes before
// and after the cutoff.

const TZ = "America/Chicago";
const PREFIX = `Ed${Date.now().toString(36)}`;
const location = { id: SEED.location, timezone: TZ };
const today = todayIn(TZ);
const saturday = (from: number) => {
  let d = addDays(today, from);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 6) d = addDays(d, 1);
  return d;
};
const DAY = saturday(165);
// Inside the 14-day headcount cutoff.
const SOON = addDays(today, 10);
const P = { bride: "ee000000-0000-4000-8000-000000000001", maid: "ee000000-0000-4000-8000-000000000003" };

let clientId: string;
let eventId: string;
let soonId: string;
let state: BuilderState;
const appointments: string[] = [];

// A booked wedding: the bride and three bridesmaids, hair and makeup, on
// location, ready by 5pm, planned by the app's own timeline.
async function bookedEvent(title: string, date: string, team: Record<string, string>) {
  const desk = await signIn("frontdesk@mapleandash.test");
  const [packages, settings] = await Promise.all([loadPackages(admin, SEED.business), loadEventSettings(admin, SEED.business)]);
  const members = [
    { name: "Mia", partyRole: "bride" as const, packageId: P.bride, paysOwn: false, email: "", phone: "" },
    ...["Ana", "Lu", "Rae"].map((name) => ({ name, partyRole: "bridesmaid" as const, packageId: P.maid, paysOwn: false, email: "", phone: "" })),
  ];
  const s: BuilderState = {
    title,
    clientId,
    clientName: "",
    newClient: null,
    date,
    readyBy: 17 * 60,
    onLocation: true,
    venueName: "The Drake",
    venueAddress: "140 E Walton Pl, Chicago",
    travelMiles: 8,
    travelMinutes: 30,
    notes: "",
    billing: "main",
    members,
    lanes: lanesFor(members, packages, settings),
    team,
    tasks: null,
    source: "desk",
    described: "",
  };
  const tasks = timelineOf(s, packages, settings);
  const { data: id, error } = await desk.rpc("save_event", { p_event_id: null!, p_input: saveInput(s, tasks, TZ) as never });
  if (error) throw error;
  const token = `${PREFIX}-${id}`;
  await desk.rpc("send_event_proposal", { p_event_id: id, p_token_hash: sha256(token), p_channel: "email", p_to: `${PREFIX.toLowerCase()}@example.test`, p_days: 14 });
  const link = (await admin.from("event_links").select("id").eq("token_hash", sha256(token)).single()).data!;
  const e = (await admin.from("events").select("total_cents, deposit_cents").eq("id", id).single()).data!;
  const { error: booked } = await admin.rpc("accept_event_proposal", {
    p_link_id: link.id,
    p_input: { typed_name: "Mia Rossi", total_cents: e.total_cents, ip_hash: "h", card: { provider: "test", ref: "test_visa_4242", label: "Visa …4242" }, deposit: { amount_cents: e.deposit_cents, provider: "test", reference: `test_${token}` } },
  });
  if (booked) throw booked;
  return { id: id as string, state: { ...s, tasks } };
}

const TEAM = { "hair-1": SEED.staff.bridget, "hair-2": SEED.staff.shae, "makeup-1": SEED.staff.hannah, "makeup-2": SEED.staff.lois };

test.beforeAll(async () => {
  const { data } = await admin.from("clients").insert({ business_id: SEED.business, first_name: `${PREFIX}Mia`, last_name: "Rossi", email: `${PREFIX.toLowerCase()}@example.test` }).select("id").single();
  clientId = data!.id;
  ({ id: eventId, state } = await bookedEvent(`${PREFIX} Rossi wedding`, DAY, TEAM));
  ({ id: soonId } = await bookedEvent(`${PREFIX} Soon wedding`, SOON, {}));
});

test.afterAll(async () => {
  for (const id of appointments) await admin.from("appointments").delete().eq("id", id);
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("events").delete().in("id", [eventId, soonId].filter(Boolean));
  await admin.from("outbox_messages").delete().eq("to_address", `${PREFIX.toLowerCase()}@example.test`);
  await admin.from("clients").delete().eq("id", clientId);
});

test.use({ viewport: { width: 1440, height: 1100 } });

test.describe.serial("an event's day", () => {
  test("the timeline drags and is checked again as it moves; the booked team can't be double-booked", async ({ browser }) => {
    // A client booked with Bridget earlier that day.
    const desk = await signIn("frontdesk@mapleandash.test");
    const hair1 = laneSpans(state.tasks!).find((s) => s.role === "hair" && s.lane === 1)!;
    const { data: offered } = await admin.from("staff_services").select("service_id").eq("staff_id", SEED.staff.bridget);
    const ctx = await loadBookingContext(desk, location, DAY, DAY);
    // The latest free time that ends before her hold starts.
    const opening = offered!
      .flatMap((o) => findOpenings(ctx, { serviceId: o.service_id, date: DAY, staffIds: [SEED.staff.bridget], from: 9 * 60, limit: 100 }).map((x) => ({ ...x, serviceId: o.service_id })))
      .filter((x) => x.startMinute + x.minutes <= hair1.call - 30)
      .sort((x, y) => y.startMinute - x.startMinute)[0];
    expect(opening).toBeTruthy();
    const saved = await saveBooking(desk, location, { clientId, notes: null, items: [{ serviceId: opening.serviceId, staffId: SEED.staff.bridget, resource: { kind: "any" }, start: opening.start }] });
    expect(saved.ok).toBe(true);
    if (saved.ok) appointments.push(saved.appointmentId);

    const page = await browser.newPage({ storageState: AUTH.frontDesk });
    await page.goto(`/events/${eventId}/edit`);
    await waitForHydration(page, "[data-task]");
    const main = ui(page);
    const chart = main.getByTestId("timeline-chart");
    await expect(chart.locator("[data-lane-row]")).toHaveCount(4);
    await expect(main.getByLabel("Hair artist 1")).toHaveValue(SEED.staff.bridget);

    // Drag the bride's makeup onto a bridesmaid's: checked while it moves.
    const first = state.tasks!.filter((t) => t.role === "makeup" && t.kind !== "touch_up").sort((a, b) => a.start - b.start)[0];
    const brideMakeup = chart.locator("[data-task='1-makeup']");
    const target = chart.locator(`[data-task='${first.member}-makeup']`);
    await chart.scrollIntoViewIfNeeded();
    const from = (await brideMakeup.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + 10, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y + from.height / 2, { steps: 3 });
    await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 8 });
    await expect(main.getByTestId("drag-problems")).toBeVisible();
    await page.mouse.up();
    await expect(main.getByRole("alert").filter({ hasText: /two people at once|two chairs|isn't ready|finishes after the bride/ })).toBeVisible();
    await expect(main.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await main.getByRole("button", { name: "Work it out again" }).click();
    await expect(main.getByTestId("drag-problems")).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Save changes" })).toBeEnabled();

    // Bridget's first person, moved earlier with the keyboard until her day
    // reaches the client she has booked: her lane says so, and saving the
    // booked event refuses.
    const firstHair = state.tasks!.filter((t) => t.role === "hair" && t.lane === 1).sort((a, b) => a.start - b.start)[0];
    const bar = chart.locator(`[data-task='${firstHair.member}-hair']`);
    const steps = Math.ceil((hair1.call - 30 - (opening.startMinute + opening.minutes)) / 15) + 1;
    await bar.focus();
    for (let i = 0; i < steps; i++) await page.keyboard.press("Shift+ArrowLeft");
    await expect(main.getByText(/Bridget has clients booked then\./)).toBeVisible();
    await main.getByRole("button", { name: "Save changes" }).click();
    await expect(main.getByRole("alert").filter({ hasText: "Bridget has clients booked then. Choose someone else or move the timeline." })).toBeVisible();
    await page.close();
    // That client's visit is gone again for the tests after.
    if (saved.ok) await admin.from("appointments").delete().eq("id", saved.appointmentId);
  });

  test("each of the team has one event block on the calendar, with travel, opening the event", async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH.frontDesk });
    await page.goto(`/calendar?date=${DAY}`);
    const holds = ui(page).locator("[data-time-block=event]");
    await expect(holds).toHaveCount(4);
    await expect(holds.first()).toHaveAttribute("aria-label", new RegExp(`^Event: ${PREFIX} Rossi wedding, .*including 30 min travel each way`));
    await expect(holds.first().locator("[data-travel]")).toHaveCount(2);
    await holds.first().click();
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
    await page.close();
  });

  test("the desk books the trial from the event; the team saves the look; the day-of sheet is ready to print", async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH.frontDesk });
    await page.goto(`/events/${eventId}`);
    await waitForHydration(page, "form[aria-label='Book trial'] button");
    const trial = ui(page).getByRole("form", { name: "Book trial" });
    await trial.getByRole("button", { name: "Find times" }).click();
    const times = trial.getByRole("list", { name: "Free times" }).getByRole("button");
    await expect(times.first()).toBeVisible();
    await times.first().click();
    await expect(ui(page).getByTestId("trials")).toContainText("Booked");
    await expect(ui(page).getByRole("form", { name: "Book trial" })).toHaveCount(0);

    await ui(page).getByLabel("Notes on the look").fill("Low textured bun, face-framing pieces");
    await expect(ui(page).getByText("Saved", { exact: true })).toBeVisible();

    await ui(page).getByRole("link", { name: "Day-of sheet" }).click();
    const sheet = page.getByTestId("day-sheet");
    await expect(sheet.getByRole("heading", { name: `${PREFIX} Rossi wedding` })).toBeVisible();
    await expect(sheet).toContainText("The Drake, 140 E Walton Pl, Chicago");
    await expect(sheet.getByRole("columnheader", { name: "Leave" })).toBeVisible();
    await expect(sheet.getByRole("row").filter({ hasText: "Bridget" }).first()).toBeVisible();
    await expect(sheet.getByTestId("running-order")).toContainText("Touch-ups");
    await expect(sheet.getByTestId("running-order")).toContainText("Everyone ready");
    await expect(sheet).toContainText("Low textured bun, face-framing pieces");
    await expect(ui(page).getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
    await page.close();
  });

  test("headcount: before the cutoff the desk adds someone and everything follows; after it, a manager", async ({ browser }) => {
    const before = (await admin.from("events").select("total_cents").eq("id", eventId).single()).data!.total_cents;
    const page = await browser.newPage({ storageState: AUTH.frontDesk });
    await page.goto(`/events/${eventId}/edit`);
    await waitForHydration(page, "[data-task]");
    await ui(page).getByRole("button", { name: "+ Bridesmaid" }).click();
    await ui(page).getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
    await expect(ui(page).getByTestId("party").getByRole("listitem")).toHaveCount(5);
    const after = (await admin.from("events").select("total_cents").eq("id", eventId).single()).data!.total_cents;
    expect(after).toBeGreaterThan(before);
    // The payments follow the new total.
    const { data: payments } = await admin.from("event_payments").select("amount_cents").eq("event_id", eventId).in("status", ["paid", "scheduled"]);
    expect(payments!.reduce((a, p) => a + p.amount_cents, 0)).toBe(after);
    await page.close();

    // Inside the cutoff: locked for the desk, open to a manager.
    const deskPage = await browser.newPage({ storageState: AUTH.frontDesk });
    await deskPage.goto(`/events/${soonId}/edit`);
    await expect(ui(deskPage).getByText("The headcount cutoff has passed. An owner or manager can change the party now.")).toBeVisible();
    await deskPage.close();
    const managerPage = await browser.newPage({ storageState: AUTH.manager });
    await managerPage.goto(`/events/${soonId}/edit`);
    await waitForHydration(managerPage, "[data-task]");
    await ui(managerPage).getByRole("button", { name: "+ Bridesmaid" }).click();
    await ui(managerPage).getByRole("button", { name: "Save changes" }).click();
    await expect(managerPage).toHaveURL(new RegExp(`/events/${soonId}$`));
    await expect(ui(managerPage).getByTestId("party").getByRole("listitem")).toHaveCount(5);
    await managerPage.close();
  });
});
