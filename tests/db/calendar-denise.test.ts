// Undoing a check-in (who can, what it clears, the record it leaves) and a
// no-show, each
// person's calendar zoom, and dismissing items from Denise's brief and panel.
// Run with `npm run test:db` after `npm run seed:demo`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { undoCheckIn } from "@/lib/scheduling/book";
import { addDays, fromLocal } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
// In the past, so checked-in visits don't look upcoming to the seed checks
// running alongside.
const DAY = "2025-09-10";

let owner: Client, frontDesk: Client, bridget: Client;
let otherOwner: Client;
let clientId: string;
let serviceId: string;

// Each on a day of its own, 10 to 11: the database never double-books
// Bridget.
let visits = 0;
async function visit(status: "checked_in" | "completed" | "booked") {
  const day = addDays(DAY, ++visits);
  const at = (h: number) => fromLocal(day, h * 60, TZ)!;
  const { data: a, error } = await admin
    .from("appointments")
    .insert({ business_id: B, location_id: L, client_id: clientId, starts_at: at(10).toISOString(), ends_at: at(11).toISOString(), status, checked_in_at: status === "booked" ? null : at(10).toISOString() })
    .select("id")
    .single();
  expect(error).toBeNull();
  const { data: item } = await admin
    .from("appointment_items")
    .insert({
      business_id: B,
      location_id: L,
      appointment_id: a!.id,
      service_id: serviceId,
      staff_id: SEED.staff.bridget,
      starts_at: at(10).toISOString(),
      ends_at: at(11).toISOString(),
      active_minutes: 60,
      price_cents: 0,
      started_at: status === "booked" ? null : at(10).toISOString(),
      finished_at: status === "completed" ? at(11).toISOString() : null,
    })
    .select("id")
    .single();
  return { appointmentId: a!.id, itemId: item!.id };
}

beforeAll(async () => {
  [owner, frontDesk, bridget] = await Promise.all([signIn("owner@mapleandash.test"), signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  const other = await createOtherSalon();
  otherOwner = await signIn(other.email);
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: "Undo", last_name: "Test" }).select("id").single();
  clientId = c!.id;
  const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single();
  serviceId = s!.id;
});

afterAll(async () => {
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("denise_dismissals").delete().eq("location_id", L).eq("day", DAY);
  await admin.from("staff").update({ calendar_zoom: "comfortable" }).eq("id", SEED.staff.frontDesk);
});

describe("undoing a check-in", () => {
  it("goes back to booked, clears the times tapped in, and records who did it", async () => {
    const { appointmentId, itemId } = await visit("checked_in");
    expect(await undoCheckIn(frontDesk, appointmentId)).toEqual({ ok: true });

    const { data: a } = await admin.from("appointments").select("status, checked_in_at, updated_by").eq("id", appointmentId).single();
    expect(a).toEqual({ status: "booked", checked_in_at: null, updated_by: SEED.staff.frontDesk });
    const { data: item } = await admin.from("appointment_items").select("started_at, finished_at").eq("id", itemId).single();
    expect(item).toEqual({ started_at: null, finished_at: null });

    const { data: events } = await frontDesk.from("appointment_events").select("kind, staff_id, detail").eq("appointment_id", appointmentId);
    expect(events).toHaveLength(1);
    expect(events![0]).toMatchObject({ kind: "check_in_undone", staff_id: SEED.staff.frontDesk });
    expect((events![0].detail as { times: unknown[] }).times).toHaveLength(1);
  });

  it("isn't for stylists, other salons, or visits that aren't checked in", async () => {
    const { appointmentId } = await visit("checked_in");
    expect(await undoCheckIn(bridget, appointmentId)).toEqual({ ok: false, error: "forbidden" });
    expect((await otherOwner.rpc("undo_check_in", { p_appointment_id: appointmentId })).error?.code).toBe("42501");
    // Stylists don't see the record either.
    expect((await bridget.from("appointment_events").select("id")).data).toEqual([]);

    // After checkout it's voiding the sale instead.
    const done = await visit("completed");
    expect(await undoCheckIn(owner, done.appointmentId)).toEqual({ ok: false, error: "not_allowed" });
    expect((await owner.rpc("undo_check_in", { p_appointment_id: done.appointmentId })).error?.code).toBe("55000");
    const booked = await visit("booked");
    expect((await owner.rpc("undo_check_in", { p_appointment_id: booked.appointmentId })).error?.code).toBe("55000");
  });

  it("can't be written to the record directly", async () => {
    const { appointmentId } = await visit("booked");
    const { error } = await owner.from("appointment_events").insert({ business_id: B, appointment_id: appointmentId, kind: "check_in_undone" });
    expect(error?.code).toBe("42501");
  });
});

describe("undoing a no-show", () => {
  const status = async (id: string) => (await admin.from("appointments").select("status").eq("id", id).single()).data!.status;
  const version = async () => (await admin.from("locations").select("calendar_version").eq("id", L).single()).data!.calendar_version;

  it("goes back to what it was (confirmed here), with who marked and undid it", async () => {
    const { appointmentId } = await visit("booked");
    await admin.from("appointments").update({ status: "confirmed" }).eq("id", appointmentId);
    expect((await frontDesk.rpc("set_appointment_status", { p_appointment_id: appointmentId, p_status: "no_show", p_reason: "" })).error).toBeNull();
    expect((await frontDesk.rpc("undo_no_show", { p_appointment_id: appointmentId, p_expected_version: await version() })).error).toBeNull();
    expect(await status(appointmentId)).toBe("confirmed");
    const { data: events } = await frontDesk.from("appointment_events").select("kind, staff_id, detail").eq("appointment_id", appointmentId).order("created_at");
    expect(events).toEqual([
      { kind: "no_show", staff_id: SEED.staff.frontDesk, detail: { from: "confirmed" } },
      { kind: "no_show_undone", staff_id: SEED.staff.frontDesk, detail: { to: "confirmed" } },
    ]);
  });

  it("refuses a stale calendar, stylists, other salons, and visits that aren't no-shows", async () => {
    const { appointmentId } = await visit("booked");
    await admin.from("appointments").update({ status: "no_show" }).eq("id", appointmentId);
    const v = await version();
    expect((await frontDesk.rpc("undo_no_show", { p_appointment_id: appointmentId, p_expected_version: v - 1 })).error?.code).toBe("40001");
    expect((await bridget.rpc("undo_no_show", { p_appointment_id: appointmentId, p_expected_version: v })).error?.code).toBe("42501");
    expect((await otherOwner.rpc("undo_no_show", { p_appointment_id: appointmentId, p_expected_version: v })).error?.code).toBe("42501");
    expect(await status(appointmentId)).toBe("no_show");
    const booked = await visit("booked");
    expect((await owner.rpc("undo_no_show", { p_appointment_id: booked.appointmentId, p_expected_version: v })).error?.code).toBe("55000");
  });
});

describe("notices for a moved visit", () => {
  const userOf = async (c: Client) => (await c.auth.getUser()).data.user!.id;
  const record = async (c: Client, appointmentId: string, notices: unknown[]) =>
    admin.rpc("record_visit_notices_for_user", { p_user_id: await userOf(c), p_appointment_id: appointmentId, p_notices: notices as never });

  it("are recorded by our server for the front of house, to the visit's own client and the salon's staff, from the move templates only", async () => {
    const { appointmentId } = await visit("booked");
    const notices = [
      { template: "visit_moved", body: "Hi, your appointment has moved.", client_id: clientId, staff_id: null },
      { template: "staff_visit_moved", body: "A visit has moved.", client_id: null, staff_id: SEED.staff.bridget },
    ];
    expect((await record(frontDesk, appointmentId, notices)).data).toBe(2);
    const { data } = await admin.from("notifications").select("template, client_id, staff_id").eq("appointment_id", appointmentId).order("template");
    expect(data).toEqual([
      { template: "staff_visit_moved", client_id: null, staff_id: SEED.staff.bridget },
      { template: "visit_moved", client_id: clientId, staff_id: null },
    ]);
    expect((await record(bridget, appointmentId, notices)).error?.code).toBe("42501");
    expect((await record(otherOwner, appointmentId, notices)).error?.code).toBe("42501");
    const { data: other } = await admin.from("clients").insert({ business_id: B, first_name: "Notice", last_name: "Other" }).select("id").single();
    try {
      expect((await record(frontDesk, appointmentId, [{ ...notices[0], client_id: other!.id }])).error?.code).toBe("22023");
    } finally {
      await admin.from("clients").delete().eq("id", other!.id);
    }
    expect((await record(frontDesk, appointmentId, [{ ...notices[0], template: "anything" }])).error?.code).toBe("22023");
    await admin.from("notifications").delete().eq("appointment_id", appointmentId);
  });

  it("can't be sent in by anyone signed in, with words of their own", async () => {
    const { appointmentId } = await visit("booked");
    // The move notices' function is the server's alone.
    const direct = await frontDesk.rpc("record_visit_notices_for_user", {
      p_user_id: await userOf(frontDesk),
      p_appointment_id: appointmentId,
      p_notices: [{ template: "visit_moved", body: "Free haircut, reply with your card number", client_id: clientId, staff_id: null }] as never,
    });
    expect(direct.error).not.toBeNull();
    // And a proposal carrying notices is refused from the browser.
    const forged = await frontDesk.rpc("record_ai_proposals", {
      p_location_id: L,
      p_feature: "conflict_resolver",
      p_subject: `notice-test:${appointmentId}`,
      p_options: [{ summary: "x", reason: "", proposal: { changes: [], notifications: [{ appointment_id: appointmentId, client_id: clientId, staff_id: null, template: "time_change", body: "Free haircut, reply with your card number" }] } }],
    });
    expect(forged.error?.code).toBe("42501");
    expect((await admin.from("notifications").select("id").eq("appointment_id", appointmentId)).data).toEqual([]);
  });
});

describe("calendar zoom", () => {
  it("is each person's own, and only the three levels", async () => {
    expect((await frontDesk.rpc("set_calendar_zoom", { p_zoom: "detailed" })).error).toBeNull();
    const { data } = await admin.from("staff").select("id, calendar_zoom").in("id", [SEED.staff.frontDesk, SEED.staff.bridget]);
    expect(Object.fromEntries(data!.map((s) => [s.id, s.calendar_zoom]))).toEqual({ [SEED.staff.frontDesk]: "detailed", [SEED.staff.bridget]: "comfortable" });
    expect((await frontDesk.rpc("set_calendar_zoom", { p_zoom: "huge" })).error?.code).toBe("23514");
  });
});

describe("dismissing Denise's items", () => {
  it("keeps them gone for the location, once each, front of house only", async () => {
    expect((await frontDesk.rpc("dismiss_denise_item", { p_location_id: L, p_day: DAY, p_key: "late:abc" })).error).toBeNull();
    expect((await owner.rpc("dismiss_denise_item", { p_location_id: L, p_day: DAY, p_key: "late:abc" })).error).toBeNull();
    const { data } = await owner.from("denise_dismissals").select("item_key, dismissed_by").eq("day", DAY);
    expect(data).toEqual([{ item_key: "late:abc", dismissed_by: SEED.staff.frontDesk }]);

    expect((await bridget.rpc("dismiss_denise_item", { p_location_id: L, p_day: DAY, p_key: "noshow:x" })).error?.code).toBe("42501");
    expect((await otherOwner.rpc("dismiss_denise_item", { p_location_id: L, p_day: DAY, p_key: "noshow:x" })).error?.code).toBe("42501");
    expect((await otherOwner.from("denise_dismissals").select("id")).data).toEqual([]);
    expect((await bridget.from("denise_dismissals").select("id")).data).toEqual([]);
  });
});
