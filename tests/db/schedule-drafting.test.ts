// Denise's draft of next month: worked out by our code from the published
// schedule (approved time off taken out, front desk gaps covered), proposed
// through the AI action log, applied by an owner or manager into the draft
// (nobody else's hours change until a week is published), and undone back
// to the draft as it was.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { draftMonth, nextMonth } from "@/lib/coverage";
import { loadCoverage } from "@/lib/coverage-load";
import { todayIn } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const TZ = "America/Chicago";
const started = new Date().toISOString();
const { from, to, month } = nextMonth(todayIn(TZ));
let manager: Client;
let frontDesk: Client;
// The demo's own drafts next month (Sandra's Saturday can fall in it), put back after.
let demoDrafts: { business_id: string; location_id: string; staff_id: string; on_date: string; shifts: unknown; updated_by: string | null }[] = [];

const record = async (c: Client, days: { staff_id: string; on_date: string; shifts: { start: number; end: number }[] }[]) =>
  (await c.rpc("record_ai_proposals", {
    p_location_id: SEED.location,
    p_feature: "schedule_draft",
    p_subject: `schedule_draft:${month}:test-${Math.random()}`,
    p_options: [{ summary: "Test draft", reason: "Test", proposal: { month, days, filled: [], left: [] } }],
  })).data![0];

beforeAll(async () => {
  [manager, frontDesk] = await Promise.all([signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  demoDrafts = (await admin.from("schedule_drafts").select("business_id, location_id, staff_id, on_date, shifts, updated_by").eq("location_id", SEED.location).gte("on_date", from).lte("on_date", to)).data!;
});

afterAll(async () => {
  await admin.from("ai_actions").delete().eq("business_id", B).eq("feature", "schedule_draft").gte("created_at", started);
  await admin.from("schedule_drafts").delete().eq("location_id", SEED.location).gte("on_date", from).lte("on_date", to);
  if (demoDrafts.length) await admin.from("schedule_drafts").insert(demoDrafts as never);
  await admin.from("staff_time_off").delete().eq("business_id", B).gte("created_at", started);
});

describe("drafting next month", () => {
  it("takes approved time off out of the published hours", async () => {
    // Gil's usual Tuesday, given as approved time off in next month.
    const coverage = await loadCoverage(manager, { id: SEED.location, timezone: TZ }, from, to, { drafts: false });
    const tuesday = coverage.days.find((d) => d.cells.find((c) => c.staffId === SEED.staff.gil)?.shifts.length && d.date >= from)!;
    const off = await admin.from("staff_time_off").insert({
      business_id: B, staff_id: SEED.staff.gil, starts_on: tuesday.date, ends_on: tuesday.date, reason: "vacation", status: "approved",
      requested_by: SEED.staff.gil, decided_by: SEED.staff.manager, decided_at: new Date().toISOString(),
    });
    expect(off.error).toBeNull();
    const again = await loadCoverage(manager, { id: SEED.location, timezone: TZ }, from, to, { drafts: false });
    const { changes } = draftMonth(again.people, again.days);
    expect(changes).toContainEqual({ staffId: SEED.staff.gil, date: tuesday.date, shifts: [] });
  });

  it("is applied into the draft by a manager, never published, and undone to what the draft was", async () => {
    // Sam has a draft day already; Jordan doesn't.
    const day = `${month}-10`;
    await admin.from("schedule_drafts").insert({ business_id: B, location_id: SEED.location, staff_id: SEED.staff.frontDesk, on_date: day, shifts: [{ start: 600, end: 900 }], updated_by: SEED.staff.manager });
    const id = await record(manager, [
      { staff_id: SEED.staff.frontDesk, on_date: day, shifts: [{ start: 540, end: 780 }] },
      { staff_id: SEED.staff.jordan, on_date: day, shifts: [{ start: 960, end: 1200 }] },
    ]);
    // The front desk can't apply it.
    expect((await frontDesk.rpc("apply_schedule_draft_action", { p_action_id: id })).error?.code).toBe("42501");
    const { data: version } = await admin.from("locations").select("calendar_version").eq("id", SEED.location).single();
    expect((await manager.rpc("apply_schedule_draft_action", { p_action_id: id })).error).toBeNull();
    const drafts = async () =>
      (await admin.from("schedule_drafts").select("staff_id, shifts").eq("on_date", day).in("staff_id", [SEED.staff.frontDesk, SEED.staff.jordan]).order("staff_id")).data;
    expect(await drafts()).toEqual([
      { staff_id: SEED.staff.frontDesk, shifts: [{ start: 540, end: 780 }] },
      { staff_id: SEED.staff.jordan, shifts: [{ start: 960, end: 1200 }] },
    ]);
    // Nothing published: no one-off hours, and the calendar hasn't moved.
    expect((await admin.from("staff_schedule_overrides").select("id").eq("on_date", day).in("staff_id", [SEED.staff.frontDesk, SEED.staff.jordan])).data).toEqual([]);
    expect((await admin.from("locations").select("calendar_version").eq("id", SEED.location).single()).data).toEqual(version);
    expect((await manager.rpc("apply_schedule_draft_action", { p_action_id: id })).error?.message).toBe("This suggestion was already decided");

    expect((await manager.rpc("undo_schedule_draft_action", { p_action_id: id })).error).toBeNull();
    expect(await drafts()).toEqual([{ staff_id: SEED.staff.frontDesk, shifts: [{ start: 600, end: 900 }] }]);
    expect((await admin.from("ai_actions").select("status").eq("id", id).single()).data!.status).toBe("undone");
  });

  it("refuses a draft with days that have passed", async () => {
    const id = await record(manager, [{ staff_id: SEED.staff.frontDesk, on_date: "2020-01-07", shifts: [] }]);
    expect((await manager.rpc("apply_schedule_draft_action", { p_action_id: id })).error?.message).toBe("Some of those days have passed. Ask Denise for a new draft.");
  });
});
