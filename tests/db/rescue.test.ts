// Sick-day rescue against the database: Bridget out on a Tuesday, the plan
// (same level first, another level, a client who only sees her), applied in
// one go through the AI action log, refused as a whole when one move
// doesn't fit, undone, the covering stylist told in the app, and the
// covering stylist's length and price on the moved visit.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyRescuePlan, type RescueMoveInput } from "@/lib/rescue-apply";
import { movesOf } from "@/lib/rescue";
import { loadRescue } from "@/lib/rescue-load";
import { loadDurations, usualTimings } from "@/lib/insights/read";
import { undoAction } from "@/lib/scheduling/ai-actions";
import { saveBooking, type BookingItemInput } from "@/lib/scheduling/book";
import { reportCallOut } from "@/lib/scheduling/disruptions";
import { loadBookingContext } from "@/lib/scheduling/load";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const TZ = "America/Chicago";
const location = { id: SEED.location, timezone: TZ };
const { bridget: BRIDGET, sandra: SANDRA, shae: SHAE } = SEED.staff;
// A Tuesday far from the seeded month. Bridget works 9-1 and 2-6, Sandra
// (a Master too) 9-5, Shae (an Artisan) 9-1 and 1:30-5:30.
const DAY = "2031-06-24";
const at = (hour: number, minute = 0, day = DAY) => fromLocal(day, hour * 60 + minute, TZ)!;
const run = crypto.randomUUID().slice(0, 8);

let frontDesk: Client;
let sandra: Client;
const clients: Record<string, string> = {};
const visits: Record<string, string> = {};
let services: Map<string, string>;

async function client(key: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await admin.from("clients").insert({ business_id: B, first_name: `Rescue${key}${run}`, last_name: "Test", ...extra }).select("id").single();
  if (error) throw error;
  clients[key] = data.id;
  return data.id;
}

async function book(key: string, service: string, start: Date) {
  const item: BookingItemInput = { serviceId: services.get(service)!, staffId: BRIDGET, start, resource: { kind: "any" } };
  const result = await saveBooking(frontDesk, location, { clientId: clients[key], notes: null, items: [item] });
  if (!result.ok) throw new Error(`Couldn't book ${key}: ${JSON.stringify(result)}`);
  visits[key] = result.appointmentId;
}

const itemsOf = async (key: string) => (await admin.from("appointment_items").select("id, staff_id, starts_at, ends_at, active_minutes, price_cents").eq("appointment_id", visits[key])).data!;

beforeAll(async () => {
  frontDesk = await signIn("frontdesk@mapleandash.test");
  sandra = await signIn("sandra@mapleandash.test");
  const { data } = await admin.from("services").select("id, name").eq("business_id", B);
  services = new Map(data!.map((s) => [s.name, s.id]));
  await client("Ava");
  await client("Ben");
  await client("Cleo", { preferred_staff_id: BRIDGET, only_sees_preferred: true });
  await book("Ava", "Balayage", at(9));
  await book("Ben", "Women's Cut & Style", at(14));
  await book("Cleo", "Women's Cut & Style", at(16));
  const out = await reportCallOut(frontDesk, BRIDGET, at(0));
  if (!out.ok) throw new Error("Couldn't mark Bridget out");
});

afterAll(async () => {
  await admin.from("ai_actions").delete().like("subject", `rescue:${BRIDGET}:${DAY}:%`);
  await admin.from("appointments").delete().in("id", Object.values(visits));
  await admin.from("clients").delete().in("id", Object.values(clients));
  const { data: d } = await admin.from("schedule_disruptions").select("id, time_off_id").eq("staff_id", BRIDGET).eq("on_date", DAY);
  await admin.from("schedule_disruptions").delete().in("id", (d ?? []).map((x) => x.id));
  await admin.from("staff_time_off").delete().in("id", (d ?? []).flatMap((x) => (x.time_off_id ? [x.time_off_id] : [])));
});

const plan = () => loadRescue(frontDesk, location, B, BRIDGET, DAY, at(7));
const toInput = (moves: ReturnType<typeof movesOf>): RescueMoveInput[] => moves.map((m) => ({ appointmentId: m.appointmentId, itemId: m.itemId, staffId: m.staffId, resourceId: m.resourceId, start: m.start }));

describe("marking a stylist out", () => {
  it("coming in late: time off until then, and the plan only for visits before it, before anything is saved", async () => {
    const day = "2031-07-01";
    const { loadRescue: load } = await import("@/lib/rescue-load");
    await client("Dot");
    const item: BookingItemInput = { serviceId: services.get("Women's Cut & Style")!, staffId: BRIDGET, start: at(15, 0, day), resource: { kind: "any" } };
    const booked = await saveBooking(frontDesk, location, { clientId: clients.Dot, notes: null, items: [item] });
    if (!booked.ok) throw new Error("Couldn't book Dot");
    visits.Dot = booked.appointmentId;
    try {
      // Not marked out yet: a plan for coming in at 11 has nobody; for all day, Dot.
      const late = (await load(frontDesk, location, B, BRIDGET, day, at(7, 0, day), { from: at(0, 0, day), until: at(11, 0, day) }))!;
      expect(late.out).toBeNull();
      expect(late.rows).toEqual([]);
      const all = (await load(frontDesk, location, B, BRIDGET, day, at(7, 0, day), { from: at(0, 0, day), until: null }))!;
      expect(all.rows.map((r) => r.appointmentId)).toEqual([visits.Dot]);
      const out = await reportCallOut(frontDesk, BRIDGET, at(0, 0, day), at(11, 0, day));
      expect(out.ok).toBe(true);
      const { data } = await admin.from("schedule_disruptions").select("ends_at, time_off:staff_time_off(start_minute, end_minute, note)").eq("staff_id", BRIDGET).eq("on_date", day).single();
      expect(Date.parse(data!.ends_at!)).toBe(at(11, 0, day).getTime());
      expect(data!.time_off).toMatchObject({ start_minute: 0, end_minute: 11 * 60, note: "Coming in late" });
      const marked = (await load(frontDesk, location, B, BRIDGET, day, at(7, 0, day)))!;
      expect(marked.out).toMatchObject({ allDay: false, text: "until 11am" });
      expect(marked.rows).toEqual([]);
    } finally {
      const { data: d } = await admin.from("schedule_disruptions").select("id, time_off_id").eq("staff_id", BRIDGET).eq("on_date", day);
      await admin.from("schedule_disruptions").delete().in("id", (d ?? []).map((x) => x.id));
      await admin.from("staff_time_off").delete().in("id", (d ?? []).flatMap((x) => (x.time_off_id ? [x.time_off_id] : [])));
    }
  });

  it("plans each client: the same level at the same time, another level, and their own stylist later for those who only see her", async () => {
    const p = (await plan())!;
    expect(p.out).toMatchObject({ allDay: true });
    const byVisit = new Map(p.rows.map((r) => [r.appointmentId, r]));
    const ava = byVisit.get(visits.Ava)!;
    expect(ava.choices[ava.choice]).toMatchObject({ kind: "cover", label: "Moves to Sandra, same time" });
    // Same level; and her own length for it, if Denise has learned one.
    expect(ava.choices[ava.choice].detail).toMatch(/^Same level · (Sandra is free|takes .+ longer)$/);
    const ben = byVisit.get(visits.Ben)!;
    expect(ben.choices[ben.choice]).toMatchObject({ kind: "cover", label: "Moves to Shae, same time" });
    expect(ben.choices[ben.choice].detail).toMatch(/^Artisan/);
    const cleo = byVisit.get(visits.Cleo)!;
    expect(cleo.note).toBe("Only sees Bridget: offered Bridget's next openings.");
    expect(cleo.choices.filter((c) => c.kind !== "leave").every((c) => c.kind === "reschedule" && c.label === "Reschedule with Bridget")).toBe(true);
    expect(cleo.choices[cleo.choice].kind).toBe("reschedule");
  });

  it("is all or nothing: one move that doesn't fit and nothing moves", async () => {
    const p = (await plan())!;
    const moves = toInput(movesOf(p.rows, p.rows.map((r) => r.choice)));
    // Ben on Sandra at 9, where Ava's balayage is going.
    const ben = moves.find((m) => m.appointmentId === visits.Ben)!;
    const bad = moves.map((m) => (m === ben ? { ...m, staffId: SANDRA, start: at(9).toISOString() } : m));
    const result = await applyRescuePlan(frontDesk, admin, location, B, BRIDGET, DAY, bad);
    expect(result.ok).toBe(false);
    for (const key of ["Ava", "Ben", "Cleo"]) expect((await itemsOf(key))[0].staff_id).toBe(BRIDGET);
  });

  it("applies the plan in one go, tells the covering stylist, and undoes it", async () => {
    const p = (await plan())!;
    const moves = toInput(movesOf(p.rows, p.rows.map((r) => r.choice)));
    const before = Object.fromEntries(await Promise.all(["Ava", "Ben", "Cleo"].map(async (k) => [k, (await itemsOf(k))[0]])));
    const result = await applyRescuePlan(frontDesk, admin, location, B, BRIDGET, DAY, moves);
    expect(result).toMatchObject({ ok: true, message: "3 clients moved." });
    if (!result.ok) return;

    const [ava, ben, cleo] = [(await itemsOf("Ava"))[0], (await itemsOf("Ben"))[0], (await itemsOf("Cleo"))[0]];
    expect([ava.staff_id, Date.parse(ava.starts_at)]).toEqual([SANDRA, at(9).getTime()]);
    expect([ben.staff_id, Date.parse(ben.starts_at)]).toEqual([SHAE, at(14).getTime()]);
    expect(cleo.staff_id).toBe(BRIDGET);
    expect(Date.parse(cleo.starts_at)).toBeGreaterThan(at(23).getTime());
    // Shae charges an Artisan's price; Ben's visit now says so.
    expect(ben.price_cents).toBeLessThan(before.Ben.price_cents);

    // One action in the log, the call-out dealt with, Sandra told in the app.
    const { data: action } = await admin.from("ai_actions").select("feature, status").eq("id", result.actionId).single();
    expect(action).toEqual({ feature: "rescue", status: "approved" });
    const { data: callOut } = await admin.from("schedule_disruptions").select("resolved_by_action").eq("staff_id", BRIDGET).eq("on_date", DAY).single();
    expect(callOut!.resolved_by_action).toBe(result.actionId);
    const { data: mine } = await sandra.from("notifications").select("id, body, channel").eq("ai_action_id", result.actionId);
    expect(mine).toEqual([expect.objectContaining({ channel: "app", body: expect.stringMatching(/^Bridget is out\. You have RescueAva.*'s Balayage .* at 9am\.$/) })]);
    // Only their own: Sandra doesn't see Shae's notice.
    const { count: all } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("ai_action_id", result.actionId);
    expect(all).toBe(2);
    await sandra.rpc("mark_notices_read", { p_ids: mine!.map((n) => n.id) });
    const { data: read } = await admin.from("notifications").select("read_at").eq("id", mine![0].id).single();
    expect(read!.read_at).not.toBeNull();

    const undone = await undoAction(frontDesk, location, result.actionId);
    expect(undone).toEqual({ ok: true });
    for (const k of ["Ava", "Ben", "Cleo"]) {
      const now = (await itemsOf(k))[0];
      expect([now.staff_id, now.starts_at, now.ends_at, now.active_minutes, now.price_cents]).toEqual([before[k].staff_id, before[k].starts_at, before[k].ends_at, before[k].active_minutes, before[k].price_cents]);
    }
    const { data: told } = await sandra.from("notifications").select("body").eq("ai_action_id", result.actionId).eq("template", "staff_covering_undone");
    expect(told).toEqual([{ body: expect.stringMatching(/is back with Bridget\.$/) }]);
  });

  it("moves a visit at the covering stylist's own length, and undo puts the old one back", async () => {
    // Sandra's balayage is 15 minutes longer than the menu (and stretched to
    // what Denise has learned she takes, if she has).
    const balayage = services.get("Balayage")!;
    const { data: row } = await admin.from("staff_services").select("active_minutes").eq("staff_id", SANDRA).eq("service_id", balayage).single();
    await admin.from("staff_services").update({ active_minutes: (row!.active_minutes ?? 0) + 15 }).eq("staff_id", SANDRA).eq("service_id", balayage);
    try {
      const ctx = await loadBookingContext(frontDesk, location, DAY, DAY);
      const expected = usualTimings(ctx, await loadDurations(frontDesk, B)).timingOf(SANDRA, balayage)!;
      const before = (await itemsOf("Ava"))[0];
      const p = (await plan())!;
      const ava = p.rows.find((r) => r.appointmentId === visits.Ava)!;
      const sandraAt9 = ava.choices.findIndex((c) => c.label === "Moves to Sandra, same time");
      const result = await applyRescuePlan(frontDesk, admin, location, B, BRIDGET, DAY, toInput(movesOf([ava], [sandraAt9])));
      expect(result.ok).toBe(true);
      const moved = (await itemsOf("Ava"))[0];
      expect(moved.active_minutes).toBe(expected.activeMinutes);
      expect(Date.parse(moved.ends_at) - Date.parse(moved.starts_at)).toBe((expected.activeMinutes + expected.processingMinutes + expected.finishingMinutes) * 60_000);
      if (result.ok) expect(await undoAction(frontDesk, location, result.actionId)).toEqual({ ok: true });
      const back = (await itemsOf("Ava"))[0];
      expect([back.active_minutes, back.ends_at]).toEqual([before.active_minutes, before.ends_at]);
    } finally {
      await admin.from("staff_services").update({ active_minutes: row!.active_minutes }).eq("staff_id", SANDRA).eq("service_id", balayage);
    }
  });

  it("is for the front of house", async () => {
    const stylist = await signIn("bridget@mapleandash.test");
    const p = (await plan())!;
    const result = await applyRescuePlan(stylist, admin, location, B, BRIDGET, DAY, toInput(movesOf(p.rows, p.rows.map((r) => r.choice))));
    expect(result.ok).toBe(false);
    expect((await itemsOf("Ava"))[0].staff_id).toBe(BRIDGET);
  });
});
