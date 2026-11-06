// The time clock: clocking yourself in and out (only while the salon uses
// it), a clock-in left open over 18 hours kept as a missed clock-out, the
// front-desk iPad (service role, after the PIN check), managers fixing
// punches with a reason, logged, who reads what, and reminders recorded
// once per shift.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, signIn, SEED, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const GIL = SEED.staff.gil;
const OWNER = SEED.staff.owner;
const started = new Date().toISOString();
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
let gil: Client;
let manager: Client;
let frontDesk: Client;
let wasOn = true;

async function clearGil() {
  await admin.from("time_clock_entries").delete().eq("staff_id", GIL);
}

beforeAll(async () => {
  [gil, manager, frontDesk] = await Promise.all([signIn("gil@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  wasOn = (await admin.from("businesses").select("time_clock").eq("id", B).single()).data!.time_clock;
  await admin.from("businesses").update({ time_clock: true }).eq("id", B);
});

afterAll(async () => {
  await clearGil();
  await admin.from("time_clock_entries").delete().eq("staff_id", OWNER).gte("created_at", started);
  await admin.from("time_clock_reminders").delete().eq("staff_id", GIL).gte("created_at", started);
  await admin.from("notifications").delete().eq("staff_id", GIL).in("template", ["clock_in_reminder", "clock_out_reminder"]).gte("created_at", started);
  await admin.from("businesses").update({ time_clock: wasOn }).eq("id", B);
});

describe("clocking yourself in and out", () => {
  beforeAll(clearGil);

  it("opens a punch, refuses a second, closes it, and logs both", async () => {
    const first = await gil.rpc("clock_in", { p_business_id: B });
    expect(first.error).toBeNull();
    expect((await gil.rpc("clock_in", { p_business_id: B })).error?.hint).toBe("already_in");
    const out = await gil.rpc("clock_out", { p_business_id: B });
    expect(out.error).toBeNull();
    expect((await gil.rpc("clock_out", { p_business_id: B })).error?.hint).toBe("not_in");
    const id = (first.data as { entry_id: string }).entry_id;
    const { data: events } = await admin.from("time_clock_events").select("kind, source, by_staff_id").eq("entry_id", id).order("created_at");
    expect(events).toEqual([
      { kind: "clock_in", source: "own", by_staff_id: GIL },
      { kind: "clock_out", source: "own", by_staff_id: GIL },
    ]);
  });

  it("is refused while the salon doesn't use the time clock", async () => {
    await admin.from("businesses").update({ time_clock: false }).eq("id", B);
    try {
      expect((await gil.rpc("clock_in", { p_business_id: B })).error?.hint).toBe("clock_off");
    } finally {
      await admin.from("businesses").update({ time_clock: true }).eq("id", B);
    }
  });

  it("keeps a clock-in left open since yesterday as a missed clock-out, and starts afresh", async () => {
    await clearGil();
    const { data: stale } = await admin.from("time_clock_entries").insert({ business_id: B, location_id: L, staff_id: GIL, clock_in: hoursAgo(20) }).select("id").single();
    expect((await gil.rpc("clock_in", { p_business_id: B })).error).toBeNull();
    const { data } = await admin.from("time_clock_entries").select("id, clock_out, missed_out").eq("staff_id", GIL).order("clock_in");
    expect(data!.map((e) => [e.id === stale!.id, e.clock_out, e.missed_out])).toEqual([
      [true, null, true],
      [false, null, false],
    ]);
  });

  it("can't be written directly", async () => {
    const { error } = await gil.from("time_clock_entries").insert({ business_id: B, location_id: L, staff_id: GIL, clock_in: hoursAgo(1) });
    expect(error).not.toBeNull();
  });
});

describe("the front-desk iPad", () => {
  it("is for the server only, after the PIN check", async () => {
    expect((await frontDesk.rpc("clock_at_desk", { p_token_hash: "x", p_staff_id: GIL })).error).not.toBeNull();
    // A device that isn't registered clocks nobody.
    expect((await admin.rpc("clock_at_desk", { p_token_hash: "not-a-device", p_staff_id: GIL })).error?.code).toBe("42501");
  });
});

describe("a manager fixing punches", () => {
  beforeAll(clearGil);

  it("adds, changes and removes with a reason, each logged with who and what it was", async () => {
    const at = (h: number) => hoursAgo(h);
    expect((await frontDesk.rpc("save_time_entry", { p_business_id: B, p_entry_id: null as unknown as string, p_staff_id: GIL, p_clock_in: at(10), p_clock_out: at(2), p_reason: "Forgot" })).error?.code).toBe("42501");
    expect((await manager.rpc("save_time_entry", { p_business_id: B, p_entry_id: null as unknown as string, p_staff_id: GIL, p_clock_in: at(10), p_clock_out: at(2), p_reason: "" })).error?.hint).toBe("reason");

    const added = await manager.rpc("save_time_entry", { p_business_id: B, p_entry_id: null as unknown as string, p_staff_id: GIL, p_clock_in: at(10), p_clock_out: at(2), p_reason: "Forgot to clock in" });
    expect(added.error).toBeNull();
    const id = added.data!;
    // Overlapping another punch is refused.
    expect((await manager.rpc("save_time_entry", { p_business_id: B, p_entry_id: null as unknown as string, p_staff_id: GIL, p_clock_in: at(5), p_clock_out: at(3), p_reason: "Again" })).error?.hint).toBe("overlap");
    // Not in the future.
    expect((await manager.rpc("save_time_entry", { p_business_id: B, p_entry_id: id, p_staff_id: GIL, p_clock_in: at(-1), p_clock_out: null as unknown as string, p_reason: "Later" })).error?.hint).toBe("times");

    expect((await manager.rpc("save_time_entry", { p_business_id: B, p_entry_id: id, p_staff_id: GIL, p_clock_in: at(9), p_clock_out: at(2), p_reason: "Came in at 9" })).error).toBeNull();
    expect((await manager.rpc("save_time_entry", { p_business_id: B, p_entry_id: id, p_staff_id: GIL, p_clock_in: at(9), p_clock_out: null as unknown as string, p_reason: "Wrong person", p_remove: true })).error).toBeNull();

    const { data: events } = await admin.from("time_clock_events").select("kind, reason, source, by_staff_id, was_in").eq("staff_id", GIL).in("kind", ["added", "changed", "removed"]).gte("created_at", started).order("created_at");
    expect(events!.map((e) => [e.kind, e.reason, e.source, e.by_staff_id === SEED.staff.manager, e.was_in !== null])).toEqual([
      ["added", "Forgot to clock in", "manager", true, false],
      ["changed", "Came in at 9", "manager", true, true],
      ["removed", "Wrong person", "manager", true, true],
    ]);
    expect((await admin.from("time_clock_entries").select("id").eq("id", id)).data).toEqual([]);
  });

  it("never lets a manager change an owner's hours", async () => {
    const { error } = await manager.rpc("save_time_entry", { p_business_id: B, p_entry_id: null as unknown as string, p_staff_id: OWNER, p_clock_in: hoursAgo(10), p_clock_out: hoursAgo(2), p_reason: "Covering" });
    expect(error?.code).toBe("42501");
  });
});

describe("who reads punches", () => {
  it("is yourself, and the team's for managers; the front desk sees only their own", async () => {
    await clearGil();
    await gil.rpc("clock_in", { p_business_id: B });
    expect((await gil.from("time_clock_entries").select("staff_id")).data!.every((e) => e.staff_id === GIL)).toBe(true);
    expect((await manager.from("time_clock_entries").select("staff_id").eq("staff_id", GIL)).data!.length).toBe(1);
    expect((await frontDesk.from("time_clock_entries").select("staff_id").eq("staff_id", GIL)).data).toEqual([]);
    expect((await frontDesk.from("time_clock_events").select("staff_id").eq("staff_id", GIL)).data).toEqual([]);
  });
});

describe("reminders", () => {
  it("are recorded once per shift as an app notice, by the server only", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const args = { p_staff_id: GIL, p_on_date: day, p_kind: "in", p_shift_start: 540, p_body: "Your shift started at 9:00am and you haven't clocked in." };
    expect((await gil.rpc("record_clock_reminder", args)).error).not.toBeNull();
    await admin.from("time_clock_reminders").delete().eq("staff_id", GIL).eq("on_date", day);
    expect((await admin.rpc("record_clock_reminder", args)).data).toBe(true);
    expect((await admin.rpc("record_clock_reminder", args)).data).toBe(false);
    const { data } = await gil.from("notifications").select("template, channel").eq("staff_id", GIL).eq("template", "clock_in_reminder").gte("created_at", started);
    expect(data).toEqual([{ template: "clock_in_reminder", channel: "app" }]);
  });
});
