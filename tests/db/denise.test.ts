// Reporting delays and call-outs, Denise's scan of the day, and approving,
// rejecting and undoing her fixes, with the notifications they record.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { approveFix, rejectFix, undoFix } from "@/lib/denise/fixes";
import { scanDay, type Viewer } from "@/lib/denise/scan";
import { changeStatus, saveBooking, type BookingItemInput } from "@/lib/scheduling/book";
import { reportCallOut, reportRunningLate } from "@/lib/scheduling/disruptions";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const location = { id: L, timezone: TZ };
const { priya: PRIYA, ethan: ETHAN, marcus: MARCUS, frontDesk: FRONT_DESK } = SEED.staff;
// A Tuesday far from the seeded month: Priya works 9-1 and 2-6, Ethan 9-1
// and 1:30-5:30, Marcus doesn't work Tuesdays.
const DAY = "2031-06-17";
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const NOW = at(9);

const desk: Viewer = { location, salon: "Maple & Ash Hair Studio", canBook: true };
const stylistView: Viewer = { ...desk, canBook: false };

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let frontDesk: Client;
let priya: Client;
let marcus: Client;
let otherOwner: Client;
let services: Map<string, string>;
let clients: { id: string; first_name: string; last_name: string }[];

async function clearDay() {
  await admin.from("ai_actions").delete().eq("location_id", L).like("subject", `${DAY}:%`);
  await admin.from("schedule_disruptions").delete().eq("location_id", L).eq("on_date", DAY);
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
  await admin.from("staff_time_off").delete().eq("starts_on", DAY);
}

function item(service: string, staffId: string, start: Date): BookingItemInput {
  return { serviceId: services.get(service)!, staffId, start, resource: { kind: "none" } };
}

async function book(clientIndex: number, items: BookingItemInput[]) {
  const result = await saveBooking(frontDesk, location, { clientId: clients[clientIndex].id, notes: null, items });
  if (!result.ok) throw new Error(`Couldn't set up a booking: ${JSON.stringify(result)}`);
  const { data } = await admin.from("appointment_items").select("id, appointment_id, starts_at, staff_id").eq("appointment_id", result.appointmentId).order("starts_at");
  return data![0];
}

const name = (i: number) => `${clients[i].first_name} ${clients[i].last_name}`;

async function startOf(itemId: string) {
  const { data } = await admin.from("appointment_items").select("starts_at, staff_id").eq("id", itemId).single();
  return { start: new Date(data!.starts_at), staffId: data!.staff_id };
}

// Priya's 10:00 client is in the chair; client 1 is next at 11:00. Ethan
// is booked 9-1 so he can't help.
async function overrunMorning() {
  const current = await book(0, [item("Women's Cut & Style", PRIYA, at(10))]);
  await changeStatus(frontDesk, current.appointment_id, "check_in");
  const next = await book(1, [item("Women's Cut & Style", PRIYA, at(11))]);
  for (const [i, hour] of [9, 10, 11, 12].entries()) await book(2 + i, [item("Women's Cut & Style", ETHAN, at(hour))]);
  return { current, next };
}

beforeAll(async () => {
  other = await createOtherSalon();
  [frontDesk, priya, marcus, otherOwner] = await Promise.all([
    signIn("frontdesk@mapleandash.test"),
    signIn("priya@mapleandash.test"),
    signIn("marcus@mapleandash.test"),
    signIn(other.email),
  ]);
  const { data } = await admin.from("services").select("id, name").eq("business_id", B);
  services = new Map(data!.map((s) => [s.name, s.id]));
  const { data: c } = await admin.from("clients").select("id, first_name, last_name").eq("business_id", B).order("id").limit(8);
  clients = c!;
  await clearDay();
});

afterEach(clearDay);

afterAll(async () => {
  await other?.cleanup();
});

// ---------------------------------------------------------------------------

describe("reporting", () => {
  it("records an overrun for a client who's checked in, and a late client otherwise", async () => {
    const { current, next } = await overrunMorning();

    const over = await reportRunningLate(priya, current.id, 20); // Priya, on her own visit
    expect(over.ok).toBe(true);
    const late = await reportRunningLate(frontDesk, next.id, 10);
    expect(late.ok).toBe(true);

    const { data } = await admin.from("schedule_disruptions").select("kind, minutes, item_id, appointment_id, on_date, reported_by").order("kind");
    const mine = data!.filter((d) => d.on_date === DAY);
    expect(mine).toEqual([
      { kind: "overrun", minutes: 20, item_id: current.id, appointment_id: current.appointment_id, on_date: DAY, reported_by: PRIYA },
      { kind: "client_late", minutes: 10, item_id: null, appointment_id: next.appointment_id, on_date: DAY, reported_by: FRONT_DESK },
    ]);

    // A new estimate replaces the old one.
    const again = await reportRunningLate(frontDesk, current.id, 30);
    expect(again).toEqual(over);
    const { data: updated } = await admin.from("schedule_disruptions").select("minutes").eq("id", over.ok ? over.id : "").single();
    expect(updated!.minutes).toBe(30);
  });

  it("only lets the front of house, or a stylist on the visit, report it", async () => {
    const { current } = await overrunMorning();
    expect(await reportRunningLate(marcus, current.id, 20)).toEqual({ ok: false, error: "forbidden" });
    expect(await reportRunningLate(otherOwner, current.id, 20)).toEqual({ ok: false, error: "forbidden" });
    expect(await reportRunningLate(frontDesk, current.id, 7)).toEqual({ ok: false, error: "invalid" });
    await changeStatus(frontDesk, current.appointment_id, "check_out");
    expect(await reportRunningLate(frontDesk, current.id, 20)).toEqual({ ok: false, error: "over" });
  });

  it("records a call-out as approved time off for the rest of the day", async () => {
    const { data: before } = await admin.from("locations").select("calendar_version").eq("id", L).single();
    const result = await reportCallOut(frontDesk, PRIYA, at(11, 42));
    expect(result.ok).toBe(true);

    const { data: off } = await admin.from("staff_time_off").select("start_minute, end_minute, status, starts_on, ends_on, decided_by").eq("staff_id", PRIYA).eq("starts_on", DAY).single();
    expect(off).toEqual({ start_minute: 11 * 60 + 40, end_minute: 1440, status: "approved", starts_on: DAY, ends_on: DAY, decided_by: FRONT_DESK });
    const { data: after } = await admin.from("locations").select("calendar_version").eq("id", L).single();
    expect(after!.calendar_version).toBeGreaterThan(before!.calendar_version);

    // Reported twice: still one.
    expect(await reportCallOut(frontDesk, PRIYA, at(12))).toEqual(result);
    // Stylists can report themselves, not others.
    expect(await reportCallOut(priya, ETHAN, at(12))).toEqual({ ok: false, error: "forbidden" });
    expect((await reportCallOut(marcus, MARCUS, at(12))).ok).toBe(true);
  });
});

describe("Denise's fixes", () => {
  it("finds an overrun, proposes moving the next client, applies, notifies and undoes", async () => {
    const { current, next } = await overrunMorning();
    await reportRunningLate(frontDesk, current.id, 20);

    const state = await scanDay(frontDesk, desk, DAY, { now: NOW });
    expect(state.conflicts).toHaveLength(1);
    const [conflict] = state.conflicts;
    expect(conflict.headline).toBe("Priya's running 20 minutes late.");
    expect(conflict.itemIds).toEqual([current.id, next.id]);
    const [top] = conflict.options;
    expect(top.summary).toBe(`${name(1)} 11:00 → 11:20`);
    expect(top.intro).toBe(`I found a fix that only moves one client: ${name(1)} 11:00 → 11:20. Want me to apply it?`);
    expect(top.reason).toBe(`${clients[1].first_name} starts 20 minutes later and stays with Priya. Nothing else on the calendar changes.`);
    expect(top.actionId).toBeTruthy();

    // Logged as a proposal, with what it would send.
    const { data: logged } = await admin.from("ai_actions").select("status, feature, summary, proposal").eq("id", top.actionId!).single();
    expect(logged).toMatchObject({ status: "proposed", feature: "conflict_resolver", summary: top.summary });

    // Scanning again keeps the same proposal.
    const again = await scanDay(frontDesk, desk, DAY, { now: NOW });
    expect(again.conflicts[0].options[0].actionId).toBe(top.actionId);

    const approved = await approveFix(frontDesk, desk, top.actionId!, { now: NOW });
    expect(approved).toEqual({ ok: true, date: DAY, message: `Done — ${clients[1].first_name} has been moved and notified.` });
    expect(await startOf(next.id)).toEqual({ start: at(11, 20), staffId: PRIYA });

    const { data: sent } = await admin.from("notifications").select("client_id, staff_id, template, body, status, appointment_id").eq("ai_action_id", top.actionId!);
    expect(sent).toHaveLength(2);
    expect(sent).toContainEqual(
      expect.objectContaining({
        client_id: clients[1].id,
        template: "time_change",
        status: "pending",
        appointment_id: next.appointment_id,
        body: `Hi ${clients[1].first_name}, it's Maple & Ash Hair Studio. Your appointment today has moved from 11am to 11:20am, still with Priya. Reply or call us if that doesn't work. See you soon!`,
      }),
    );
    expect(sent).toContainEqual(expect.objectContaining({ staff_id: PRIYA, template: "staff_schedule_change", body: `${name(1)}'s Women's Cut & Style has moved from 11am to 11:20am.` }));

    // All clear now.
    expect((await scanDay(frontDesk, desk, DAY, { now: NOW })).conflicts).toEqual([]);

    // Undo: back exactly, the unsent notices canceled, and the conflict back.
    expect(await undoFix(frontDesk, desk, top.actionId!, NOW)).toEqual({ ok: true, date: DAY, message: `Undone — ${clients[1].first_name} is back at 11:00.` });
    expect(await startOf(next.id)).toEqual({ start: at(11), staffId: PRIYA });
    const { data: canceled } = await admin.from("notifications").select("status").eq("ai_action_id", top.actionId!);
    expect(canceled!.map((n) => n.status)).toEqual(["canceled", "canceled"]);
    const after = await scanDay(frontDesk, desk, DAY, { now: NOW });
    expect(after.conflicts).toHaveLength(1);
    expect(after.conflicts[0].options[0].actionId).not.toBe(top.actionId);
  });

  it("tells clients it's back when a notice already went out", async () => {
    const { current } = await overrunMorning();
    await reportRunningLate(frontDesk, current.id, 20);
    const [top] = (await scanDay(frontDesk, desk, DAY, { now: NOW })).conflicts[0].options;
    await approveFix(frontDesk, desk, top.actionId!, { now: NOW });
    // Pretend the client's text was sent.
    await admin.from("notifications").update({ status: "sent" }).eq("ai_action_id", top.actionId!).eq("template", "time_change");

    expect((await undoFix(frontDesk, desk, top.actionId!, NOW)).ok).toBe(true);
    const { data } = await admin.from("notifications").select("template, status, body, client_id").eq("ai_action_id", top.actionId!).order("created_at");
    expect(data!.map((n) => [n.template, n.status])).toEqual(
      expect.arrayContaining([
        ["time_change", "sent"],
        ["staff_schedule_change", "canceled"],
        ["time_change_undone", "pending"],
      ]),
    );
    expect(data).toHaveLength(3);
    expect(data!.find((n) => n.template === "time_change_undone")!.body).toContain("back at 11am with Priya");
  });

  it("moves a late client's visit and marks the report resolved, until undone", async () => {
    const visit = await book(1, [item("Women's Cut & Style", PRIYA, at(11))]);
    const late = await reportRunningLate(frontDesk, visit.id, 15);
    const state = await scanDay(frontDesk, desk, DAY, { now: NOW });
    const [conflict] = state.conflicts;
    expect(conflict.headline).toBe(`${name(1)} is running 15 minutes late.`);
    expect(conflict.options[0].summary).toBe(`${name(1)} 11:00 → 11:15`);

    expect((await approveFix(frontDesk, desk, conflict.options[0].actionId!, { now: NOW })).ok).toBe(true);
    const { data: resolved } = await admin.from("schedule_disruptions").select("resolved_by_action").eq("id", late.ok ? late.id : "").single();
    expect(resolved!.resolved_by_action).toBe(conflict.options[0].actionId);
    // Not shifted twice.
    expect((await scanDay(frontDesk, desk, DAY, { now: NOW })).conflicts).toEqual([]);

    await undoFix(frontDesk, desk, conflict.options[0].actionId!, NOW);
    const { data: reopened } = await admin.from("schedule_disruptions").select("resolved_by_action").eq("id", late.ok ? late.id : "").single();
    expect(reopened!.resolved_by_action).toBeNull();
    expect((await scanDay(frontDesk, desk, DAY, { now: NOW })).conflicts).toHaveLength(1);
  });

  it("hands a stylist's clients to others when they're out", async () => {
    const cut = await book(1, [item("Women's Cut & Style", PRIYA, at(12))]);
    await reportCallOut(frontDesk, PRIYA, at(11));
    const [conflict] = (await scanDay(frontDesk, desk, DAY, { now: at(11) })).conflicts;
    expect(conflict.headline).toBe("Priya is out for the rest of the day.");
    expect(conflict.options[0].summary).toBe(`${name(1)} → Ethan at 12:00`);
    expect((await approveFix(frontDesk, desk, conflict.options[0].actionId!, { now: at(11) })).ok).toBe(true);
    expect(await startOf(cut.id)).toEqual({ start: at(12), staffId: ETHAN });
  });

  it("re-checks the rules when approving, and doesn't propose a rejected fix again", async () => {
    const { current } = await overrunMorning();
    await reportRunningLate(frontDesk, current.id, 20);
    const [conflict] = (await scanDay(frontDesk, desk, DAY, { now: NOW })).conflicts;

    // Someone books Priya at 12:05 in the meantime, where the fix needs her.
    await book(6, [item("Bang Trim", PRIYA, at(12, 5))]);
    const result = await approveFix(frontDesk, desk, conflict.options[0].actionId!, { now: NOW });
    expect(result).toEqual({ ok: false, message: "That doesn't work any more: The stylist already has a client then. I'll look again." });

    // Rejected: gone, and not proposed again.
    const [fresh] = (await scanDay(frontDesk, desk, DAY, { now: NOW })).conflicts;
    expect(await rejectFix(frontDesk, fresh.options[0].actionId!)).toEqual({ ok: true });
    expect((await scanDay(frontDesk, desk, DAY, { now: NOW })).conflicts).toEqual([]);
  });

  it("shows stylists the same conflicts without recording or approving anything", async () => {
    const { current } = await overrunMorning();
    await reportRunningLate(frontDesk, current.id, 20);
    const state = await scanDay(priya, stylistView, DAY, { now: NOW });
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts[0].options.every((o) => o.actionId === null)).toBe(true);
    const { count } = await admin.from("ai_actions").select("id", { count: "exact", head: true }).like("subject", `${DAY}:%`);
    expect(count).toBe(0);
  });

  it("uses Claude's explanation for new fixes, and keeps it while the fix is unchanged", async () => {
    const { current } = await overrunMorning();
    await reportRunningLate(frontDesk, current.id, 20);
    const calls: unknown[] = [];
    const explain = async (facts: unknown[]) => {
      calls.push(...facts);
      return facts.map(() => "A friendly explanation.");
    };
    const first = await scanDay(frontDesk, desk, DAY, { now: NOW, explain });
    expect(first.conflicts[0].options[0].reason).toBe("A friendly explanation.");
    const asked = calls.length;
    expect(asked).toBeGreaterThan(0);
    // Only first names reach Claude.
    expect(JSON.stringify(calls)).not.toContain(clients[1].last_name);

    const second = await scanDay(frontDesk, desk, DAY, { now: NOW, explain });
    expect(second.conflicts[0].options[0].reason).toBe("A friendly explanation.");
    expect(calls.length).toBe(asked);
  });
});

describe("who can see reports and notifications", () => {
  it("shows reports to the team, notifications to the front of house, nothing to other salons", async () => {
    const { current } = await overrunMorning();
    await reportRunningLate(frontDesk, current.id, 20);
    const [top] = (await scanDay(frontDesk, desk, DAY, { now: NOW })).conflicts[0].options;
    await approveFix(frontDesk, desk, top.actionId!, { now: NOW });

    const { data: seenByStylist } = await marcus.from("schedule_disruptions").select("id").eq("on_date", DAY);
    expect(seenByStylist).toHaveLength(1);
    const { data: notesByStylist } = await marcus.from("notifications").select("id").eq("ai_action_id", top.actionId!);
    expect(notesByStylist).toEqual([]);
    const { data: notesByDesk } = await frontDesk.from("notifications").select("id").eq("ai_action_id", top.actionId!);
    expect(notesByDesk).toHaveLength(2);

    const { data: theirReports } = await otherOwner.from("schedule_disruptions").select("id").eq("on_date", DAY);
    expect(theirReports).toEqual([]);
    const { data: theirNotes } = await otherOwner.from("notifications").select("id");
    expect(theirNotes).toEqual([]);

    // No direct writes.
    const insert = await frontDesk.from("schedule_disruptions").insert({ business_id: B, location_id: L, kind: "call_out", on_date: DAY, staff_id: ETHAN, starts_at: at(12).toISOString() });
    expect(insert.error?.code).toBe("42501");
    const note = await frontDesk.from("notifications").insert({ business_id: B, location_id: L, staff_id: ETHAN, template: "x", body: "x" });
    expect(note.error?.code).toBe("42501");
  });
});
