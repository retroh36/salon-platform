// Bridal and events, the day: a booked event holds each team member's time
// on the calendar (travel included), so the booking rules keep clients off
// it and nobody can change the hold but the event; a team member who's
// become busy comes off it; the trial is a visit linked to the event, and
// checking it out marks the event Trial done; the look is saved by the team;
// and completing the event makes one sale, so the work, the team's share of
// the service charge and travel, and every payment flow into payroll.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkItem } from "@/lib/scheduling/booking";
import { saveBooking } from "@/lib/scheduling/book";
import { loadBookingContext } from "@/lib/scheduling/load";
import { findOpenings } from "@/lib/scheduling/openings";
import { addDays, fromLocal, todayIn, weekdayOf } from "@/lib/scheduling/time";
import { sha256 } from "@/lib/online-booking/security";
import { admin, SEED, signIn, type Client } from "./helpers";

const TZ = "America/Chicago";
const location = { id: SEED.location, timezone: TZ };
const P = { bride: "ee000000-0000-4000-8000-000000000001", maidHair: "ee000000-0000-4000-8000-000000000002" };
const today = todayIn(TZ);
// A Tuesday to Saturday about two months out.
let DATE = addDays(today, 60);
while (![2, 3, 4, 5, 6].includes(weekdayOf(DATE))) DATE = addDays(DATE, 1);
const at = (date: string, minute: number) => fromLocal(date, minute, TZ)!.toISOString();

let desk: Client;
let bridget: Client;
let gil: Client;
let clientId: string;
let otherClientId: string;
let eventId: string;
let todayEventId: string;
const appointments: string[] = [];
const sales: string[] = [];

// Bride: hair with Bridget, makeup with Hannah; a bridesmaid's hair with
// Bridget first. On location, 30 minutes' travel.
const input = (date: string, base: number, over: Record<string, unknown> = {}) => ({
  title: "Day test wedding",
  client_id: clientId,
  event_date: date,
  ready_by: at(date, base + 225),
  on_location: true,
  travel_miles: 25,
  travel_minutes: 30,
  members: [
    { name: "Mia", party_role: "bride", package_id: P.bride },
    { name: "Lu", party_role: "bridesmaid", package_id: P.maidHair },
  ],
  tasks: [
    { member: "2", kind: "hair", role: "hair", lane: 1, staff_id: SEED.staff.bridget, starts_at: at(date, base), ends_at: at(date, base + 45) },
    { member: "1", kind: "hair", role: "hair", lane: 1, staff_id: SEED.staff.bridget, starts_at: at(date, base + 55), ends_at: at(date, base + 145) },
    { member: "1", kind: "makeup", role: "makeup", lane: 1, staff_id: SEED.staff.hannah, starts_at: at(date, base + 145), ends_at: at(date, base + 220) },
  ],
  ...over,
});

async function book(id: string, token: string) {
  const { error: sent } = await desk.rpc("send_event_proposal", { p_event_id: id, p_token_hash: sha256(token), p_channel: "email", p_to: "day-test@example.test", p_days: 14 });
  if (sent) throw sent;
  const link = (await admin.from("event_links").select("id").eq("token_hash", sha256(token)).single()).data!;
  const e = (await admin.from("events").select("total_cents, deposit_cents").eq("id", id).single()).data!;
  const { error } = await admin.rpc("accept_event_proposal", {
    p_link_id: link.id,
    p_input: { typed_name: "Mia Rossi", total_cents: e.total_cents, ip_hash: "h", card: { provider: "test", ref: "test_visa_4242", label: "Visa …4242" }, deposit: { amount_cents: e.deposit_cents, provider: "test", reference: `test_ch_${token}` } },
  });
  if (error) throw error;
}

const holds = async (id: string) =>
  (await admin.from("time_blocks").select("id, staff_id, kind, start_minute, end_minute, on_date").eq("event_id", id).order("start_minute")).data!;

beforeAll(async () => {
  [desk, bridget, gil] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test"), signIn("gil@mapleandash.test")]);
  const { data: c } = await admin
    .from("clients")
    .insert([
      { business_id: SEED.business, first_name: "Dayof", last_name: "Tester", email: "day-test@example.test" },
      { business_id: SEED.business, first_name: "Other", last_name: "Client" },
    ])
    .select("id, first_name");
  clientId = c!.find((x) => x.first_name === "Dayof")!.id;
  otherClientId = c!.find((x) => x.first_name === "Other")!.id;
  const { data: id, error } = await desk.rpc("save_event", { p_event_id: null!, p_input: input(DATE, 690) as never });
  if (error) throw error;
  eventId = id;
});

afterAll(async () => {
  for (const id of appointments) await admin.from("appointments").delete().eq("id", id);
  await admin.from("events").delete().in("id", [eventId, todayEventId].filter(Boolean));
  for (const id of sales) await admin.from("sales").delete().eq("id", id);
  await admin.from("notifications").delete().eq("business_id", SEED.business).in("template", ["event_booked", "event_staff_needed"]);
  await admin.from("outbox_messages").delete().eq("to_address", "day-test@example.test");
  await admin.from("clients").delete().in("id", [clientId, otherClientId]);
});

describe("the calendar", () => {
  it("holds nothing for an inquiry; once booked, each team member's time from travel and call time to travel back", async () => {
    expect(await holds(eventId)).toEqual([]);
    await book(eventId, `day-${eventId}`);
    const list = await holds(eventId);
    // Bridget: first person at 11:30, less 15 minutes to set up and 30 to
    // travel; done at 1:55, plus travel back. Hannah: 1:55 to 3:10.
    expect(list.map((b) => [b.staff_id, b.kind, b.on_date, b.start_minute, b.end_minute])).toEqual([
      [SEED.staff.bridget, "event", DATE, 690 - 45, 835 + 30],
      [SEED.staff.hannah, "event", DATE, 835 - 45, 910 + 30],
    ]);
  });

  it("keeps clients off the hold, by the booking rules", async () => {
    const ctx = await loadBookingContext(desk, location, DATE, DATE);
    const { data: offered } = await admin.from("staff_services").select("service_id").eq("staff_id", SEED.staff.bridget).limit(1).single();
    const check = checkItem(ctx, { serviceId: offered!.service_id, staffId: SEED.staff.bridget, start: new Date(at(DATE, 720)) });
    expect(check.valid).toBe(false);
    expect(!check.valid && check.problems).toContainEqual(expect.objectContaining({ code: "staff_blocked", kind: "event" }));
  });

  it("can't be moved, changed or removed except through the event", async () => {
    const [hold] = await holds(eventId);
    expect((await desk.from("time_blocks").update({ start_minute: 600 }).eq("id", hold.id)).error).toMatchObject({ hint: "event" });
    expect((await desk.from("time_blocks").delete().eq("id", hold.id)).error).toMatchObject({ hint: "event" });
    expect((await desk.rpc("move_time_block", { p_block_id: hold.id, p_on_date: DATE, p_start: 600, p_end: 700 })).error).not.toBeNull();
    const made = await desk.from("time_blocks").insert({ business_id: SEED.business, location_id: SEED.location, staff_id: SEED.staff.gil, kind: "event", start_minute: 600, end_minute: 700, on_date: DATE, event_id: eventId });
    expect(made.error).not.toBeNull();
    expect((await holds(eventId)).length).toBe(2);
  });

  it("follows the event: a later timeline moves the holds, Lost takes them off", async () => {
    expect((await desk.rpc("save_event", { p_event_id: eventId, p_input: input(DATE, 720) as never })).error).toBeNull();
    expect((await holds(eventId)).map((b) => b.start_minute)).toEqual([720 - 45, 865 - 45]);
    expect((await desk.rpc("set_event_status", { p_event_id: eventId, p_status: "lost", p_reason: "Testing" })).error).toBeNull();
    expect(await holds(eventId)).toEqual([]);
    await desk.rpc("set_event_status", { p_event_id: eventId, p_status: "inquiry", p_reason: "" });
    await book(eventId, `day-again-${eventId}`);
    expect((await holds(eventId)).length).toBe(2);
  });

  it("takes someone who's become busy off the event and tells the desk (service role only)", async () => {
    expect((await desk.rpc("release_event_staff", { p_event_id: eventId, p_staff_ids: [SEED.staff.hannah] })).error).not.toBeNull();
    expect((await admin.rpc("release_event_staff", { p_event_id: eventId, p_staff_ids: [SEED.staff.hannah] })).error).toBeNull();
    expect((await holds(eventId)).map((b) => b.staff_id)).toEqual([SEED.staff.bridget]);
    const { data: tasks } = await admin.from("event_tasks").select("staff_id").eq("event_id", eventId).eq("role", "makeup");
    expect(tasks!.every((t) => t.staff_id === null)).toBe(true);
    const { data: told } = await admin.from("notifications").select("body").eq("template", "event_staff_needed").eq("staff_id", SEED.staff.frontDesk);
    expect(told!.some((n) => n.body.includes("Hannah"))).toBe(true);
    // Back on for the rest of the tests.
    expect((await desk.rpc("save_event", { p_event_id: eventId, p_input: input(DATE, 720) as never })).error).toBeNull();
  });
});

describe("the trial and the look", () => {
  it("links a visit for this client, and checking it out marks the event Trial done", async () => {
    const { data: trial } = await admin.from("event_settings").select("trial_service_id").eq("business_id", SEED.business).single();
    // Two free times for the trial, the way the event page finds them.
    let day = addDays(today, 14);
    let open: ReturnType<typeof findOpenings> = [];
    for (let i = 0; i < 14 && open.length < 2; i++, day = addDays(day, 1)) {
      const all = findOpenings(await loadBookingContext(desk, location, day, day), { serviceId: trial!.trial_service_id!, date: day, step: 15, limit: 100 });
      // The first, and one that doesn't overlap it.
      const second = all.find((o) => o.staffId !== all[0].staffId || o.startMinute >= all[0].startMinute + all[0].minutes);
      open = all[0] && second ? [all[0], second] : [];
    }
    expect(open.length).toBe(2);
    const saved = await saveBooking(desk, location, { clientId: otherClientId, notes: null, items: [{ serviceId: trial!.trial_service_id!, staffId: open[0].staffId, resource: { kind: "any" }, start: open[0].start }] });
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
    if (!saved.ok) return;
    appointments.push(saved.appointmentId);
    // Not this event's client.
    expect((await desk.rpc("link_event_trial", { p_event_id: eventId, p_appointment_id: saved.appointmentId })).error?.code).toBe("22023");

    const mine = await saveBooking(desk, location, { clientId, notes: "Trial", items: [{ serviceId: trial!.trial_service_id!, staffId: open[1].staffId, resource: { kind: "any" }, start: open[1].start }] });
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    appointments.push(mine.appointmentId);
    expect((await bridget.rpc("link_event_trial", { p_event_id: eventId, p_appointment_id: mine.appointmentId })).error?.code).toBe("42501");
    expect((await desk.rpc("link_event_trial", { p_event_id: eventId, p_appointment_id: mine.appointmentId })).error).toBeNull();
    expect((await admin.from("appointments").select("event_id").eq("id", mine.appointmentId).single()).data!.event_id).toBe(eventId);

    expect((await admin.from("appointments").update({ status: "completed" }).eq("id", mine.appointmentId)).error).toBeNull();
    expect((await admin.from("events").select("status").eq("id", eventId).single()).data!.status).toBe("trial_done");
    // Trial done still holds the day.
    expect((await holds(eventId)).length).toBe(2);
  });

  it("saves the look for the team on the event, and nobody else", async () => {
    expect((await bridget.rpc("save_event_look", { p_event_id: eventId, p_notes: "Low textured bun, pins left side" })).error).toBeNull();
    expect((await gil.rpc("save_event_look", { p_event_id: eventId, p_notes: "Nope" })).error?.code).toBe("P0002");
    expect((await admin.from("events").select("look_notes").eq("id", eventId).single()).data!.look_notes).toBe("Low textured bun, pins left side");
    expect((await bridget.rpc("add_event_photo", { p_event_id: eventId, p_path: `${SEED.business}/${eventId}/${crypto.randomUUID()}.jpg` })).error?.message).toMatch(/Upload the photo first/);
  });
});

describe("completing an event", () => {
  it("refuses before the day, and before everything's paid", async () => {
    expect((await desk.rpc("complete_event", { p_event_id: eventId })).error).toMatchObject({ code: "55000" });
    // Tomorrow's event, very early (out of everyone's way), booked, then
    // moved to today as if the day had come.
    const tomorrow = addDays(today, 1);
    const { data: id, error } = await desk.rpc("save_event", { p_event_id: null!, p_input: { ...input(tomorrow, 180), title: "Day test today" } as never });
    if (error) throw error;
    todayEventId = id;
    await book(todayEventId, `day-today-${todayEventId}`);
    await admin.from("events").update({ event_date: today }).eq("id", todayEventId);
    expect((await bridget.rpc("complete_event", { p_event_id: todayEventId })).error?.code).toBe("42501");
    expect((await desk.rpc("complete_event", { p_event_id: todayEventId })).error).toMatchObject({ code: "55000", hint: "unpaid" });
  });

  it("makes one sale: each artist's work, the team's share of fees as tips, every payment, into payroll", async () => {
    // The rest collected.
    await admin.from("event_payments").update({ status: "paid", paid_at: new Date().toISOString(), provider: "test", provider_reference: "test_ch_rest", card_label: "Visa …4242" }).eq("event_id", todayEventId).eq("status", "scheduled");
    const e = (await admin.from("events").select("*").eq("id", todayEventId).single()).data!;
    const { data: saleId, error } = await desk.rpc("complete_event", { p_event_id: todayEventId });
    expect(error).toBeNull();
    sales.push(saleId!);

    const { data: sale } = await admin.from("sales").select("subtotal_cents, tax_cents, tip_cents, total_cents, client_id, sale_items(description, staff_id, unit_price_cents, tax_cents, total_cents, commission_pct), sale_tips(staff_id, amount_cents), payments(amount_cents, method, processor)").eq("id", saleId!).single();
    expect(sale).toMatchObject({ total_cents: e.total_cents, tax_cents: e.tax_cents, client_id: clientId });
    expect(sale!.subtotal_cents + sale!.tax_cents + sale!.tip_cents).toBe(e.total_cents);
    expect(sale!.payments.reduce((a, p) => a + p.amount_cents, 0)).toBe(e.total_cents);
    expect(sale!.payments.every((p) => p.method === "card" && p.processor === "test")).toBe(true);

    // The bride's package split between her artists; each line with a
    // stylist has a commission rate recorded.
    const lines = sale!.sale_items;
    const miaHair = lines.find((l) => l.description.startsWith("Mia") && l.description.includes("(hair)"))!;
    const miaMakeup = lines.find((l) => l.description.startsWith("Mia") && l.description.includes("(makeup)"))!;
    expect(miaHair.staff_id).toBe(SEED.staff.bridget);
    expect(miaMakeup.staff_id).toBe(SEED.staff.hannah);
    expect(miaHair.unit_price_cents + miaMakeup.unit_price_cents).toBe(45000);
    expect(lines.find((l) => l.description.startsWith("Lu"))).toMatchObject({ staff_id: SEED.staff.bridget, unit_price_cents: 12000 });
    for (const l of lines.filter((x) => x.staff_id)) expect(l.commission_pct).not.toBeNull();

    // The whole service charge (the salon gives the team all of it) and
    // half the travel fee go to the team as tips; the rest of travel and
    // the early start are the salon's.
    const tips = new Map(sale!.sale_tips.map((t) => [t.staff_id, t.amount_cents]));
    expect([...tips.keys()].sort()).toEqual([SEED.staff.bridget, SEED.staff.hannah].sort());
    expect(sale!.tip_cents).toBe(e.service_charge_cents + Math.floor((e.travel_fee_cents * 50 + 50) / 100));
    expect(lines.find((l) => l.description === "Travel")).toMatchObject({ staff_id: null, unit_price_cents: e.travel_fee_cents - Math.floor((e.travel_fee_cents * 50 + 50) / 100) });
    expect(lines.find((l) => l.description === "Early start")?.unit_price_cents).toBe(e.early_fee_cents);
    // Bridget did more of the work, so more of the service charge.
    expect(tips.get(SEED.staff.bridget)!).toBeGreaterThan(tips.get(SEED.staff.hannah)!);

    expect((await admin.from("events").select("status, sale_id").eq("id", todayEventId).single()).data).toEqual({ status: "completed", sale_id: saleId });
    expect((await desk.rpc("complete_event", { p_event_id: todayEventId })).error?.code).toBe("55000");
    // Completed events keep the record of the day on the calendar.
    expect((await holds(todayEventId)).length).toBe(2);

    // Payroll sees Bridget's work and tips from it.
    const manager = await signIn("manager@mapleandash.test");
    const from = fromLocal(today, 0, TZ)!.toISOString();
    const to = fromLocal(addDays(today, 1), 0, TZ)!.toISOString();
    const { data: payroll, error: pe } = await manager.rpc("payroll_sales", { p_business_id: SEED.business, p_from: from, p_to: to, p_staff_id: SEED.staff.bridget });
    expect(pe).toBeNull();
    expect(JSON.stringify(payroll)).toContain(saleId!);
  });
});
