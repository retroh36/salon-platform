// Time-off requests: staff ask for themselves (flagged when short notice or
// in a blackout, owners and managers told), only owners and managers
// decide (a decline needs a reason, and the person is told), every step is
// logged, approving leaves booked clients for the inbox to plan, and
// marking the stylist out that day uses the approved time off.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, fromLocal, todayIn, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { loadRequestsInbox } from "@/lib/time-off-requests-load";
import { admin, SEED, signIn, type Client } from "./helpers";

const TZ = "America/Chicago";
const B = SEED.business;
const today = todayIn(TZ);
const started = new Date().toISOString();
let manager: Client;
let frontDesk: Client;
let bridget: Client;
let gil: Client;
let notice: number;

const ask = (c: Client, startsOn: LocalDate, endsOn = startsOn, note?: string) =>
  c.rpc("request_time_off", { p_starts_on: startsOn, p_ends_on: endsOn, p_reason: "vacation", p_note: note });

beforeAll(async () => {
  [manager, frontDesk, bridget, gil] = await Promise.all(
    ["manager", "frontdesk", "bridget", "gil"].map((n) => signIn(`${n}@mapleandash.test`)),
  );
  const { data } = await admin.from("businesses").select("time_off_notice_days").eq("id", B).single();
  notice = data!.time_off_notice_days;
});

afterAll(async () => {
  await admin.from("schedule_disruptions").delete().eq("business_id", B).gte("created_at", started);
  await admin.from("staff_time_off").delete().eq("business_id", B).gte("created_at", started);
  await admin.from("time_off_blackouts").delete().eq("business_id", B).gte("created_at", started);
  await admin.from("time_off_events").delete().eq("business_id", B).gte("created_at", started);
  await admin.from("notifications").delete().eq("business_id", B).in("template", ["time_off_requested", "time_off_decided"]).gte("created_at", started);
  await admin.from("businesses").update({ time_off_notice_days: notice }).eq("id", B);
});

describe("asking", () => {
  it("flags short notice and blackouts, and tells owners and managers", async () => {
    await admin.from("businesses").update({ time_off_notice_days: 14 }).eq("id", B);
    const far = addDays(today, 200);
    expect((await admin.from("time_off_blackouts").insert({ business_id: B, starts_on: addDays(far, 2), ends_on: addDays(far, 5), label: "Test blackout" })).error).toBeNull();

    const soon = await ask(bridget, addDays(today, 3), addDays(today, 3), "Wedding");
    const later = await ask(bridget, far);
    const blackout = await ask(bridget, addDays(far, 4), addDays(far, 6));
    for (const r of [soon, later, blackout]) expect(r.error).toBeNull();
    const { data } = await admin.from("staff_time_off").select("id, status, short_notice, in_blackout, requested_by").in("id", [soon.data!, later.data!, blackout.data!]).order("starts_on");
    expect(data!.map((r) => [r.status, r.short_notice, r.in_blackout, r.requested_by])).toEqual([
      ["requested", true, false, SEED.staff.bridget],
      ["requested", false, false, SEED.staff.bridget],
      ["requested", false, true, SEED.staff.bridget],
    ]);
    const { data: told } = await admin.from("notifications").select("staff_id, body").eq("template", "time_off_requested").gte("created_at", started);
    expect(new Set(told!.map((n) => n.staff_id))).toEqual(new Set([SEED.staff.owner, SEED.staff.manager]));
    expect(told!.some((n) => n.body.includes("Bridget asked for time off") && n.body.includes("blackout"))).toBe(true);

    // Not in the past; and nobody asks for someone else.
    expect((await ask(bridget, addDays(today, -1))).error?.code).toBe("22023");
    expect((await gil.from("staff_time_off").insert({ business_id: B, staff_id: SEED.staff.bridget, requested_by: SEED.staff.gil, starts_on: far, ends_on: far, reason: "vacation" })).error?.code).toBe("42501");
    // Stylists don't see each other's requests; managers do.
    expect((await gil.from("staff_time_off").select("id").eq("id", later.data!)).data).toEqual([]);
    expect((await manager.from("staff_time_off").select("id").eq("id", later.data!)).data).toHaveLength(1);
  });
});

describe("deciding", () => {
  it("is for owners and managers, a decline needs a reason, and the person is told", async () => {
    const id = (await ask(bridget, addDays(today, 210))).data!;
    for (const c of [frontDesk, bridget, gil]) {
      expect((await c.rpc("decide_time_off", { p_time_off_id: id, p_decision: "approved" })).error?.code).toBe("42501");
    }
    expect((await manager.rpc("decide_time_off", { p_time_off_id: id, p_decision: "declined" })).error?.message).toMatch(/Say why/);
    expect((await manager.rpc("decide_time_off", { p_time_off_id: id, p_decision: "declined", p_reason: "Two others are off then." })).error).toBeNull();
    expect((await manager.rpc("decide_time_off", { p_time_off_id: id, p_decision: "approved" })).error?.message).toMatch(/already been decided/);

    const { data: row } = await admin.from("staff_time_off").select("status, decline_reason, decided_by").eq("id", id).single();
    expect(row).toEqual({ status: "declined", decline_reason: "Two others are off then.", decided_by: SEED.staff.manager });
    const { data: told } = await admin.from("notifications").select("body").eq("staff_id", SEED.staff.bridget).eq("template", "time_off_decided").gte("created_at", started);
    expect(told!.map((n) => n.body)).toContainEqual(expect.stringMatching(/was declined: Two others are off then\.$/));
    // Their own decline reason is theirs to read.
    expect((await bridget.from("staff_time_off").select("decline_reason").eq("id", id).single()).data?.decline_reason).toBe("Two others are off then.");
  });

  it("logs every step, kept after the time off is gone", async () => {
    const id = (await ask(bridget, addDays(today, 220))).data!;
    expect((await bridget.from("staff_time_off").delete().eq("id", id)).error).toBeNull();
    const approved = (await ask(bridget, addDays(today, 221))).data!;
    await manager.rpc("decide_time_off", { p_time_off_id: approved, p_decision: "approved" });
    await manager.from("staff_time_off").delete().eq("id", approved);

    const kinds = async (timeOff: string) => (await admin.from("time_off_events").select("kind, by_staff_id").eq("time_off_id", timeOff).order("created_at")).data!.map((e) => [e.kind, e.by_staff_id]);
    expect(await kinds(id)).toEqual([
      ["requested", SEED.staff.bridget],
      ["withdrawn", SEED.staff.bridget],
    ]);
    expect(await kinds(approved)).toEqual([
      ["requested", SEED.staff.bridget],
      ["approved", SEED.staff.manager],
      ["removed", SEED.staff.manager],
    ]);
    // Bridget reads her own log; Gil doesn't; nobody writes it.
    expect((await bridget.from("time_off_events").select("id").eq("time_off_id", id)).data).toHaveLength(2);
    expect((await gil.from("time_off_events").select("id").eq("time_off_id", id)).data).toEqual([]);
    expect((await manager.from("time_off_events").insert({ business_id: B, time_off_id: id, staff_id: SEED.staff.bridget, kind: "approved", starts_on: today, ends_on: today })).error?.code).toBe("42501");
  });
});

describe("approving with clients booked", () => {
  it("shows them in the inbox, keeps them booked, and marking out uses the approved time off", async () => {
    // A day from tomorrow on with Bridget's demo clients.
    const { data: items } = await admin
      .from("appointment_items")
      .select("starts_at, appointment:appointments!inner(status)")
      .eq("staff_id", SEED.staff.bridget)
      .gte("starts_at", fromLocal(addDays(today, 1), 0, TZ)!.toISOString())
      .in("appointment.status", ["booked", "confirmed"])
      .order("starts_at")
      .limit(1);
    const date = toLocal(new Date(items![0].starts_at), TZ).date;
    const id = (await ask(bridget, date)).data!;

    const inbox = await loadRequestsInbox(manager, { id: SEED.location, timezone: TZ }, today);
    const request = inbox.pending.find((r) => r.id === id)!;
    expect(request.shortNotice).toBe(true);
    expect(request.visits.length).toBeGreaterThan(0);
    expect(request.visits.every((v) => v.date === date)).toBe(true);
    const booked = request.visits.length;

    expect((await manager.rpc("decide_time_off", { p_time_off_id: id, p_decision: "approved" })).error).toBeNull();
    const after = await loadRequestsInbox(manager, { id: SEED.location, timezone: TZ }, today);
    expect(after.pending.find((r) => r.id === id)).toBeUndefined();
    expect(after.decided.find((r) => r.id === id)!.visits).toHaveLength(booked);

    // Marking her out that day (the Mark out panel's "Mark out only") adds no second time off.
    const out = await manager.rpc("report_call_out", { p_staff_id: SEED.staff.bridget, p_from: fromLocal(date, 0, TZ)!.toISOString() });
    expect(out.error).toBeNull();
    const { data: disruption } = await admin.from("schedule_disruptions").select("time_off_id").eq("id", out.data!).single();
    expect(disruption!.time_off_id).toBe(id);
    const { data: offThatDay } = await admin.from("staff_time_off").select("id").eq("staff_id", SEED.staff.bridget).lte("starts_on", date).gte("ends_on", date).eq("status", "approved");
    expect(offThatDay!.map((t) => t.id)).toEqual([id]);
  });
});
