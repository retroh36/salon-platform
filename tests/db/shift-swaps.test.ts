// Shift swaps: only the front desk and assistants, only with someone in the
// same role; the coworker accepts, then an owner or manager approves, and
// only then do the hours change. Nobody ends up on two shifts at once or
// working through approved time off, and every step is logged.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn, weekdayOf } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const { frontDesk: SAM, jordan: JORDAN } = SEED.staff;
const started = new Date().toISOString();
const today = todayIn("America/Chicago");
// A Tuesday (Sam works 9–5, Jordan doesn't) and the Thursday after (Jordan
// works 9–5, Sam doesn't), five weeks out, clear of the demo's swaps.
const tuesday = addDays(today, 35 + ((2 - weekdayOf(addDays(today, 35)) + 7) % 7));
const thursday = addDays(tuesday, 2);
const otherTuesday = addDays(tuesday, 7);
const days = [tuesday, thursday, otherTuesday];
let sam: Client, jordan: Client, manager: Client, bridget: Client, ari: Client;

// A day's one-off hours (what a swap writes), as [start, end] pairs.
const hours = async (staffId: string, date: string) =>
  (await admin.from("staff_schedule_overrides").select("start_minute, end_minute").eq("staff_id", staffId).eq("on_date", date).order("start_minute")).data!.map((o) => [o.start_minute, o.end_minute]);

const putBack = async () => {
  await admin.from("shift_swaps").delete().eq("business_id", B).gte("created_at", started);
  await admin.from("staff_schedule_overrides").delete().in("staff_id", [SAM, JORDAN]).in("on_date", days);
  await admin.from("staff_days_off").delete().in("staff_id", [SAM, JORDAN]).in("on_date", days);
  await admin.from("staff_time_off").delete().in("staff_id", [SAM, JORDAN]).gte("created_at", started);
};

beforeAll(async () => {
  [sam, jordan, manager, bridget, ari] = await Promise.all(["frontdesk", "jordan", "manager", "bridget", "ari"].map((n) => signIn(`${n}@mapleandash.test`)));
  await putBack();
});

afterAll(async () => {
  await putBack();
  await admin.from("notifications").delete().eq("business_id", B).like("template", "shift_swap_%").gte("created_at", started);
});

const ask = (c: Client, to: string, give: string, take?: string) => c.rpc("request_shift_swap", { p_to_staff_id: to, p_give_date: give, p_take_date: take });

describe("who can swap", () => {
  it("is the front desk and assistants, with someone in the same role", async () => {
    expect((await ask(bridget, SEED.staff.gil, tuesday)).error?.code).toBe("42501");
    expect((await ask(manager, SAM, tuesday)).error?.code).toBe("42501");
    const cross = await ask(sam, SEED.staff.ari, tuesday);
    expect(cross.error?.message).toBe("Swaps are with someone in the same role.");
    expect((await ask(sam, JORDAN, thursday)).error?.message).toMatch(/^You aren't working on /);
  });
});

describe("giving a day", () => {
  it("waits for the coworker, then a manager, and only then changes the hours", async () => {
    const asked = await ask(sam, JORDAN, tuesday);
    expect(asked.error).toBeNull();
    const id = asked.data!;
    // Others can't see it; the coworker is told.
    expect((await ari.from("shift_swaps").select("id").eq("id", id)).data).toEqual([]);
    expect((await admin.from("notifications").select("body").eq("staff_id", JORDAN).eq("template", "shift_swap_asked").gte("created_at", started)).data![0].body).toMatch(/^Sam asked you to take their .* shift \(9am–5pm\)/);

    // Not before the coworker accepts, and only they can.
    expect((await manager.rpc("decide_shift_swap", { p_swap_id: id, p_approve: true })).error?.message).toBe("That swap isn't waiting for approval.");
    expect((await sam.rpc("answer_shift_swap", { p_swap_id: id, p_accept: true })).error?.code).toBe("42501");
    expect((await jordan.rpc("answer_shift_swap", { p_swap_id: id, p_accept: true })).error).toBeNull();
    // Agreed, but nothing changes until a manager approves.
    expect((await admin.from("staff_days_off").select("id").eq("staff_id", SAM).eq("on_date", tuesday)).data).toEqual([]);

    // The front desk doesn't approve; a manager does, with a reason to decline.
    expect((await sam.rpc("decide_shift_swap", { p_swap_id: id, p_approve: true })).error?.code).toBe("42501");
    expect((await manager.rpc("decide_shift_swap", { p_swap_id: id, p_approve: false })).error?.message).toBe("Say why it's declined.");
    expect((await manager.rpc("decide_shift_swap", { p_swap_id: id, p_approve: true })).error).toBeNull();
    expect((await admin.from("staff_days_off").select("id").eq("staff_id", SAM).eq("on_date", tuesday)).data).toHaveLength(1);
    expect(await hours(JORDAN, tuesday)).toEqual([[540, 1020]]);

    const { data: log } = await admin.from("shift_swap_events").select("kind, by_staff_id").eq("swap_id", id).order("created_at");
    expect(log!.map((e) => [e.kind, e.by_staff_id])).toEqual([["asked", SAM], ["accepted", JORDAN], ["approved", SEED.staff.manager]]);
    const { data: told } = await admin.from("notifications").select("staff_id").eq("template", "shift_swap_decided").gte("created_at", started);
    expect(new Set(told!.map((n) => n.staff_id))).toEqual(new Set([SAM, JORDAN]));
    expect((await manager.rpc("decide_shift_swap", { p_swap_id: id, p_approve: true })).error?.message).toBe("That swap isn't waiting for approval.");
  });

  it("trades days both ways", async () => {
    await putBack();
    const id = (await ask(sam, JORDAN, tuesday, thursday)).data!;
    expect((await jordan.rpc("answer_shift_swap", { p_swap_id: id, p_accept: true })).error).toBeNull();
    expect((await manager.rpc("decide_shift_swap", { p_swap_id: id, p_approve: true })).error).toBeNull();
    expect(await hours(SAM, thursday)).toEqual([[540, 1020]]);
    expect((await admin.from("staff_days_off").select("id").eq("staff_id", JORDAN).eq("on_date", thursday)).data).toHaveLength(1);
  });
});

describe("the rules", () => {
  it("never puts someone on two shifts at once", async () => {
    await putBack();
    await admin.from("staff_schedule_overrides").insert({ business_id: B, staff_id: JORDAN, on_date: otherTuesday, start_minute: 960, end_minute: 1200 });
    expect((await ask(sam, JORDAN, otherTuesday)).error?.message).toMatch(/^Jordan is already working then on /);
  });

  it("never has someone working through approved time off, even if it's approved after they accept", async () => {
    await putBack();
    const id = (await ask(sam, JORDAN, otherTuesday)).data!;
    expect((await jordan.rpc("answer_shift_swap", { p_swap_id: id, p_accept: true })).error).toBeNull();
    const off = await admin.from("staff_time_off").insert({
      business_id: B, staff_id: JORDAN, starts_on: otherTuesday, ends_on: otherTuesday, reason: "vacation", status: "approved",
      requested_by: JORDAN, decided_by: SEED.staff.manager, decided_at: new Date().toISOString(),
    });
    expect(off.error).toBeNull();
    expect((await manager.rpc("decide_shift_swap", { p_swap_id: id, p_approve: true })).error?.message).toMatch(/^Jordan has time off on /);
    expect((await ask(sam, JORDAN, tuesday)).error).toBeNull();
  });

  it("is refused once the hours it was asked for have changed", async () => {
    await putBack();
    const id = (await ask(sam, JORDAN, tuesday)).data!;
    await admin.from("staff_schedule_overrides").insert({ business_id: B, staff_id: SAM, on_date: tuesday, start_minute: 600, end_minute: 1020 });
    expect((await jordan.rpc("answer_shift_swap", { p_swap_id: id, p_accept: true })).error?.message).toBe("The schedule for those days has changed since it was asked. Ask again.");
    // The asker can still take it back; the coworker can say no.
    expect((await sam.rpc("cancel_shift_swap", { p_swap_id: id })).error).toBeNull();
    expect((await admin.from("shift_swaps").select("status").eq("id", id).single()).data!.status).toBe("canceled");
  });
});
