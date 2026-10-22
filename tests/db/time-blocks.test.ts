// Blocked time: who can block whose time, moving one day of a repeating
// block, the booking rules, and Denise moving a lunch as part of a fix.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { approveFix, undoFix } from "@/lib/denise/fixes";
import { scanDay, type Viewer } from "@/lib/denise/scan";
import { changeStatus, saveBooking, type BookingItemInput } from "@/lib/scheduling/book";
import { reportRunningLate } from "@/lib/scheduling/disruptions";
import { loadBookingContext } from "@/lib/scheduling/load";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const location = { id: L, timezone: TZ };
const { bridget: BRIDGET, shae: SHAE } = SEED.staff;
// Tuesdays far from the seeded month. Bridget works 9-1 and 2-6.
const DAY = "2031-07-08";
const NEXT = "2031-07-15";
const at = (hour: number, minute = 0, date = DAY) => fromLocal(date, hour * 60 + minute, TZ)!;
const desk: Viewer = { location, salon: "Maple & Ash Hair Studio", canBook: true };

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let frontDesk: Client;
let bridget: Client;
let gil: Client;
let otherOwner: Client;
let services: Map<string, string>;
let clientId: string;

const lunch = (staffId = BRIDGET, extra: Record<string, unknown> = {}) => ({
  business_id: B,
  location_id: L,
  staff_id: staffId,
  kind: "lunch" as const,
  start_minute: 12 * 60,
  end_minute: 12 * 60 + 30,
  on_date: DAY,
  ...extra,
});

function item(service: string, staffId: string, start: Date): BookingItemInput {
  return { serviceId: services.get(service)!, staffId, start, resource: { kind: "none" } };
}

async function clear() {
  await admin.from("time_blocks").delete().eq("location_id", L).or(`on_date.in.(${DAY},${NEXT}),starts_on.eq.${DAY}`);
  await admin.from("ai_actions").delete().like("subject", `${DAY}:%`);
  await admin.from("schedule_disruptions").delete().eq("on_date", DAY);
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
}

beforeAll(async () => {
  other = await createOtherSalon();
  [frontDesk, bridget, gil, otherOwner] = await Promise.all([
    signIn("frontdesk@mapleandash.test"),
    signIn("bridget@mapleandash.test"),
    signIn("gil@mapleandash.test"),
    signIn(other.email),
  ]);
  const { data } = await admin.from("services").select("id, name").eq("business_id", B);
  services = new Map(data!.map((s) => [s.name, s.id]));
  const { data: c } = await admin.from("clients").select("id").eq("business_id", B).order("id").limit(1).single();
  clientId = c!.id;
  await clear();
});

afterEach(clear);
afterAll(async () => {
  await other?.cleanup();
});

describe("blocking time", () => {
  it("lets stylists block their own time, the front desk anyone's, and everyone see it", async () => {
    expect((await bridget.from("time_blocks").insert(lunch())).error).toBeNull();
    expect((await bridget.from("time_blocks").insert(lunch(SHAE))).error?.code).toBe("42501");
    expect((await frontDesk.from("time_blocks").insert(lunch(SHAE))).error).toBeNull();
    const { data: seen } = await gil.from("time_blocks").select("id").eq("on_date", DAY);
    expect(seen).toHaveLength(2);
    const { data: theirs } = await otherOwner.from("time_blocks").select("id").eq("on_date", DAY);
    expect(theirs).toEqual([]);
    const { data: changed } = await gil.from("time_blocks").update({ note: "x" }).eq("on_date", DAY).select("id");
    expect(changed).toEqual([]);
  });

  it("moves one day of a repeating block, leaving the rest", async () => {
    const { data: block } = await admin
      .from("time_blocks")
      .insert(lunch(BRIDGET, { on_date: null, repeat_weekdays: [2], starts_on: DAY }))
      .select("id")
      .single();
    const { data: moved, error } = await bridget.rpc("move_time_block", { p_block_id: block!.id, p_on_date: DAY, p_start: 12 * 60 + 15, p_end: 12 * 60 + 45 });
    expect(error).toBeNull();
    expect(moved).not.toBe(block!.id);
    const ctx = await loadBookingContext(admin, location, DAY, NEXT);
    const bridgets = ctx.blocks!.filter((b) => b.staffId === BRIDGET).map((b) => [b.date, b.start.getTime()]).sort();
    expect(bridgets).toEqual([
      [DAY, at(12, 15).getTime()],
      [NEXT, at(12, 0, NEXT).getTime()],
    ]);
    // A one-off just moves.
    expect((await bridget.rpc("move_time_block", { p_block_id: moved!, p_on_date: DAY, p_start: 12 * 60 + 30, p_end: 13 * 60 })).data).toBe(moved);
    expect((await gil.rpc("move_time_block", { p_block_id: moved!, p_on_date: DAY, p_start: 600, p_end: 630 })).error?.code).toBe("42501");
  });

  it("keeps bookings out of it, except processing time", async () => {
    await admin.from("time_blocks").insert(lunch());
    const cut = await saveBooking(frontDesk, location, { clientId, notes: null, items: [item("Women's Cut & Style", BRIDGET, at(11, 30))] });
    expect(cut).toEqual({ ok: false, error: "invalid", problems: [[expect.objectContaining({ code: "staff_blocked", kind: "lunch" })]] });
    // All-over color at 11:15: busy until noon, processing over lunch, then
    // finishing 12:35-1.
    const ok = await saveBooking(frontDesk, location, { clientId, notes: null, items: [item("All-Over Color", BRIDGET, at(11, 15))] });
    expect(ok.ok).toBe(true);
  });
});

describe("Denise and lunch", () => {
  it("shifts a lunch a little to fix an overrun, and undo puts it back", async () => {
    // A repeating lunch at noon; Bridget's 10:00 runs 20 over into 11:00.
    const { data: block } = await admin.from("time_blocks").insert(lunch(BRIDGET, { on_date: null, repeat_weekdays: [2], starts_on: DAY })).select("id").single();
    const book = async (hour: number, staffId = BRIDGET) => {
      const r = await saveBooking(frontDesk, location, { clientId, notes: null, items: [item("Women's Cut & Style", staffId, at(hour))] });
      if (!r.ok) throw new Error(JSON.stringify(r));
      return r.appointmentId;
    };
    const current = await book(10);
    await book(11);
    for (const h of [9, 10, 11, 12]) await book(h, SHAE);
    await changeStatus(frontDesk, current, "check_in");
    const { data: item10 } = await admin.from("appointment_items").select("id").eq("appointment_id", current).single();
    await reportRunningLate(frontDesk, item10!.id, 20);

    const [conflict] = (await scanDay(frontDesk, desk, DAY, { now: at(9) })).conflicts;
    const [top] = conflict.options;
    expect(top.summary).toMatch(/11:00 → 11:20; Bridget's lunch 12:00 → 12:20$/);
    expect(top.reason).toContain("Bridget takes lunch at 12:20 instead of 12:00.");

    expect((await approveFix(frontDesk, desk, top.actionId!, { now: at(9) })).ok).toBe(true);
    let ctx = await loadBookingContext(admin, location, DAY, NEXT);
    expect(ctx.blocks!.filter((b) => b.staffId === BRIDGET).map((b) => [b.date, b.start.getTime()]).sort()).toEqual([
      [DAY, at(12, 20).getTime()],
      [NEXT, at(12, 0, NEXT).getTime()],
    ]);
    const { data: told } = await admin.from("notifications").select("body").eq("ai_action_id", top.actionId!).eq("template", "staff_block_moved");
    expect(told).toEqual([{ body: "Your lunch today has moved from noon to 12:20pm." }]);

    expect((await undoFix(frontDesk, desk, top.actionId!, at(9))).ok).toBe(true);
    ctx = await loadBookingContext(admin, location, DAY, NEXT);
    expect(ctx.blocks!.filter((b) => b.staffId === BRIDGET).map((b) => [b.date, b.start.getTime()]).sort()).toEqual([
      [DAY, at(12).getTime()],
      [NEXT, at(12, 0, NEXT).getTime()],
    ]);
    const { count } = await admin.from("time_blocks").select("id", { count: "exact", head: true }).eq("staff_id", BRIDGET).eq("on_date", DAY);
    expect(count).toBe(0);
    expect(block).toBeTruthy();
  });

  it("won't move training", async () => {
    await admin.from("time_blocks").insert(lunch(BRIDGET, { kind: "training" }));
    const r = await bridget.rpc("record_ai_proposals", { p_location_id: L, p_feature: "conflict_resolver", p_subject: `${DAY}:x`, p_options: [] });
    expect(r.error?.code).toBe("42501");
    // The apply hook refuses a proposal that moves it.
    const { data: training } = await admin.from("time_blocks").select("id").eq("on_date", DAY).single();
    const { data: ids } = await frontDesk.rpc("record_ai_proposals", {
      p_location_id: L,
      p_feature: "conflict_resolver",
      p_subject: `${DAY}:training`,
      p_options: [{ summary: "Move training", reason: "", proposal: { changes: [], block_moves: [{ block_id: training!.id, on_date: DAY, from: { start: 720, end: 750 }, to: { start: 740, end: 770 } }] } }],
    });
    const { data: loc } = await admin.from("locations").select("calendar_version").eq("id", L).single();
    const { error } = await frontDesk.rpc("apply_ai_action", { p_action_id: ids![0], p_expected_version: loc!.calendar_version, p_client_id: null! });
    expect(error?.code).toBe("55000");
  });
});
