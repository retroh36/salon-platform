// The AI action log: recording Denise's proposals, applying, rejecting and
// undoing them through lib/scheduling/ai-actions.ts, signed in as real staff.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applyAction, recordProposals, rejectAction, undoAction, type Proposal, type ProposalOption } from "@/lib/scheduling/ai-actions";
import { changeStatus, moveItem, saveBooking, type BookingItemInput } from "@/lib/scheduling/book";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const TZ = "America/Chicago";
const location = { id: SEED.location, timezone: TZ };
const { bridget: BRIDGET, shae: SHAE, frontDesk: FRONT_DESK } = SEED.staff;
// A Tuesday far from the seeded month. Bridget works 9-1 and 2-6, Shae 9-1
// and 1:30-5:30.
const DAY = "2031-06-10";
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let frontDesk: Client;
let bridget: Client;
let otherOwner: Client;
let services: Map<string, string>;
let clientId: string;

const appointments: string[] = [];
// One-off proposals (no subject) to remove after each test.
const oneOffs: string[] = [];
const run = crypto.randomUUID();
let subjectCount = 0;
const newSubject = () => `test:${run}:${++subjectCount}`;

function item(service: string, staffId: string, start: Date): BookingItemInput {
  return { serviceId: services.get(service)!, staffId, start, resource: { kind: "none" } };
}

async function book(items: BookingItemInput[]) {
  const result = await saveBooking(frontDesk, location, { clientId, notes: null, items });
  if (!result.ok) throw new Error(`Couldn't set up a booking: ${JSON.stringify(result)}`);
  appointments.push(result.appointmentId);
  const { data } = await admin
    .from("appointment_items")
    .select("id, appointment_id, staff_id, resource_id, starts_at, ends_at, price_cents")
    .eq("appointment_id", result.appointmentId)
    .order("starts_at");
  return data!;
}

async function itemRow(id: string) {
  const { data } = await admin.from("appointment_items").select("staff_id, resource_id, starts_at, ends_at, price_cents").eq("id", id).single();
  return data!;
}

async function action(id: string) {
  const { data } = await admin.from("ai_actions").select("*").eq("id", id).maybeSingle();
  return data;
}

// A proposal moving one item to a new stylist and/or time.
function move(row: { id: string; appointment_id: string; staff_id: string; resource_id: string | null; starts_at: string }, staffId: string, start: Date): Proposal {
  return {
    changes: [
      {
        itemId: row.id,
        appointmentId: row.appointment_id,
        from: { staffId: row.staff_id, resourceId: row.resource_id, start: new Date(row.starts_at) },
        to: { staffId, resourceId: row.resource_id, start },
      },
    ],
  };
}

const option = (summary: string, proposal: Proposal): ProposalOption => ({ summary, reason: `Because ${summary}`, proposal });

async function propose(client: Client, subject: string | null, options: ProposalOption[]) {
  return recordProposals(client, SEED.location, { feature: "conflict_resolver", subject, options });
}

beforeAll(async () => {
  other = await createOtherSalon();
  [frontDesk, bridget, otherOwner] = await Promise.all([
    signIn("frontdesk@mapleandash.test"),
    signIn("bridget@mapleandash.test"),
    signIn(other.email),
  ]);
  const { data } = await admin.from("services").select("id, name").eq("business_id", B);
  services = new Map(data!.map((s) => [s.name, s.id]));
  const { data: c } = await admin.from("clients").select("id").eq("business_id", B).order("id").limit(1).single();
  clientId = c!.id;
});

afterEach(async () => {
  await admin.from("ai_actions").delete().like("subject", `test:${run}:%`);
  if (oneOffs.length) await admin.from("ai_actions").delete().in("id", oneOffs.splice(0));
  if (appointments.length) await admin.from("appointments").delete().in("id", appointments.splice(0));
});

afterAll(async () => {
  await other?.cleanup();
});

// ---------------------------------------------------------------------------

describe("recording proposals", () => {
  it("keeps one set of options per problem, updated in place", async () => {
    const [cut] = await book([item("Women's Cut & Style", BRIDGET, at(10))]);
    const subject = newSubject();

    const first = await propose(frontDesk, subject, [
      option("Move to 10:20", move(cut, BRIDGET, at(10, 20))),
      option("Move to Shae", move(cut, SHAE, at(10))),
      option("Move to 11:00", move(cut, BRIDGET, at(11))),
    ]);
    expect(first).toHaveLength(3);
    const top = await action(first[0]);
    expect(top).toMatchObject({ status: "proposed", rank: 1, summary: "Move to 10:20", proposed_by: FRONT_DESK, feature: "conflict_resolver" });

    // The calendar changed: two options now, the first one different.
    const second = await propose(frontDesk, subject, [option("Move to 10:30", move(cut, BRIDGET, at(10, 30))), option("Move to Shae", move(cut, SHAE, at(10)))]);
    expect(second).toEqual(first.slice(0, 2));
    expect((await action(first[0]))!.summary).toBe("Move to 10:30");
    expect(await action(first[2])).toBeNull();

    // No options left: the problem went away.
    expect(await propose(frontDesk, subject, [])).toEqual([]);
    const { count } = await admin.from("ai_actions").select("id", { count: "exact", head: true }).eq("subject", subject);
    expect(count).toBe(0);
  });

  it("doesn't propose again once rejected", async () => {
    const [cut] = await book([item("Women's Cut & Style", BRIDGET, at(10))]);
    const subject = newSubject();
    const ids = await propose(frontDesk, subject, [option("Move to 10:20", move(cut, BRIDGET, at(10, 20))), option("Move to Shae", move(cut, SHAE, at(10)))]);

    expect(await rejectAction(frontDesk, ids[1])).toEqual({ ok: true });
    for (const id of ids) expect(await action(id)).toMatchObject({ status: "rejected", decided_by: FRONT_DESK });
    expect(await propose(frontDesk, subject, [option("Move to 10:20", move(cut, BRIDGET, at(10, 20)))])).toEqual([]);
    expect(await rejectAction(frontDesk, ids[0])).toEqual({ ok: false, error: "decided" });
  });
});

describe("applying and undoing", () => {
  it("moves the items, records what they were, and undoes exactly", async () => {
    const [cut] = await book([item("Women's Cut & Style", BRIDGET, at(10))]);
    const before = await itemRow(cut.id);
    const ids = await propose(frontDesk, newSubject(), [
      option("Move to Shae", move(cut, SHAE, at(10, 15))),
      option("Move to 11:00", move(cut, BRIDGET, at(11))),
    ]);

    expect(await applyAction(frontDesk, location, ids[0])).toEqual({ ok: true });
    const moved = await itemRow(cut.id);
    expect(moved.staff_id).toBe(SHAE);
    expect(new Date(moved.starts_at)).toEqual(at(10, 15));
    // Shae charges the Artisan price.
    expect(moved.price_cents).toBeLessThan(before.price_cents);

    const applied = await action(ids[0]);
    expect(applied).toMatchObject({ status: "approved", decided_by: FRONT_DESK });
    expect(applied!.proposal).toMatchObject({ other_options: ["Move to 11:00"] });
    // The other option is closed.
    expect(await action(ids[1])).toBeNull();
    const { data: appt } = await admin.from("appointments").select("updated_by").eq("id", cut.appointment_id).single();
    expect(appt!.updated_by).toBe(FRONT_DESK);

    expect(await undoAction(frontDesk, location, ids[0])).toEqual({ ok: true });
    const restored = await itemRow(cut.id);
    expect({ ...restored, starts_at: new Date(restored.starts_at), ends_at: new Date(restored.ends_at) }).toEqual({
      ...before,
      starts_at: new Date(before.starts_at),
      ends_at: new Date(before.ends_at),
    });
    expect(await action(ids[0])).toMatchObject({ status: "undone", undone_by: FRONT_DESK });

    // Only once.
    expect(await undoAction(frontDesk, location, ids[0])).toEqual({ ok: false, error: "decided" });
    expect(await applyAction(frontDesk, location, ids[0])).toEqual({ ok: false, error: "decided" });
  });

  it("moves two clients together, each checked against the other", async () => {
    const [first] = await book([item("Women's Cut & Style", BRIDGET, at(10))]);
    const [second] = await book([item("Women's Cut & Style", BRIDGET, at(11))]);
    // Shifting both by an hour: the first lands where the second was.
    const both: Proposal = { changes: [...move(first, BRIDGET, at(11)).changes, ...move(second, BRIDGET, at(12)).changes] };
    const [id] = await propose(frontDesk, newSubject(), [option("Shift both", both)]);
    expect(await applyAction(frontDesk, location, id)).toEqual({ ok: true });
    expect(new Date((await itemRow(first.id)).starts_at)).toEqual(at(11));
    expect(new Date((await itemRow(second.id)).starts_at)).toEqual(at(12));

    expect(await undoAction(frontDesk, location, id)).toEqual({ ok: true });
    expect(new Date((await itemRow(first.id)).starts_at)).toEqual(at(10));
    expect(new Date((await itemRow(second.id)).starts_at)).toEqual(at(11));

    // Overlapping moves fail the rules.
    const clash: Proposal = { changes: [...move(first, BRIDGET, at(11)).changes, ...move(second, BRIDGET, at(11, 30)).changes] };
    const [bad] = await propose(frontDesk, newSubject(), [option("Clash", clash)]);
    expect(await applyAction(frontDesk, location, bad)).toEqual({ ok: false, error: "invalid", problems: [{ code: "staff_double_booked", conflictWith: first.id }] });
  });

  it("checks the booking rules again when applying", async () => {
    const [cut] = await book([item("Women's Cut & Style", BRIDGET, at(10))]);
    const [id] = await propose(frontDesk, newSubject(), [option("Move to 12:00", move(cut, BRIDGET, at(12)))]);
    // Someone books Bridget at 12 in the meantime.
    await book([item("Women's Cut & Style", BRIDGET, at(12))]);

    const result = await applyAction(frontDesk, location, id);
    expect(result).toMatchObject({ ok: false, error: "invalid", problems: [{ code: "staff_double_booked" }] });
    expect(new Date((await itemRow(cut.id)).starts_at)).toEqual(at(10));
    expect((await action(id))!.status).toBe("proposed");

    // And the rules for the stylist: Bridget's lunch is 1-2.
    const [lunch] = await propose(frontDesk, newSubject(), [option("Move to 1:00", move(cut, BRIDGET, at(13)))]);
    expect(await applyAction(frontDesk, location, lunch)).toEqual({ ok: false, error: "invalid", problems: [{ code: "staff_unavailable", reason: "not_working" }] });
  });

  it("refuses a proposal when the visit moved or the client checked in since", async () => {
    const [cut] = await book([item("Women's Cut & Style", BRIDGET, at(10))]);
    const movedSince = await propose(frontDesk, newSubject(), [option("Move to 11:00", move(cut, BRIDGET, at(11)))]);

    expect(await moveItem(frontDesk, location, { itemId: cut.id, staffId: BRIDGET, start: at(10, 30) })).toMatchObject({ ok: true });
    expect(await applyAction(frontDesk, location, movedSince[0])).toEqual({ ok: false, error: "stale" });

    // Proposed again from where it is now, but the client has checked in.
    const [fresh] = await propose(frontDesk, newSubject(), [option("Move to Shae", move({ ...cut, starts_at: at(10, 30).toISOString() }, SHAE, at(10, 30)))]);
    expect(await changeStatus(frontDesk, cut.appointment_id, "check_in")).toEqual({ ok: true });
    expect(await applyAction(frontDesk, location, fresh)).toEqual({ ok: false, error: "stale" });
    expect((await itemRow(cut.id)).staff_id).toBe(BRIDGET);
  });

  it("undo checks the old place is still free, and that nothing changed since", async () => {
    const [cut] = await book([item("Women's Cut & Style", BRIDGET, at(10))]);
    const [first, second] = await Promise.all([
      propose(frontDesk, newSubject(), [option("Move to 11:00", move(cut, BRIDGET, at(11)))]),
      propose(frontDesk, newSubject(), [option("Move to 15:00", move({ ...cut, starts_at: at(11).toISOString() }, BRIDGET, at(15)))]),
    ]);
    expect(await applyAction(frontDesk, location, first[0])).toEqual({ ok: true });

    // Someone takes 10:00 with Bridget: undo would double-book Bridget.
    const [taken] = await book([item("Women's Cut & Style", BRIDGET, at(10))]);
    expect(await undoAction(frontDesk, location, first[0])).toMatchObject({ ok: false, error: "invalid", problems: [{ code: "staff_double_booked" }] });
    await admin.from("appointments").delete().eq("id", taken.appointment_id);

    // It moved again after: undoing the first move would lose the second.
    expect(await applyAction(frontDesk, location, second[0])).toEqual({ ok: true });
    expect(await undoAction(frontDesk, location, first[0])).toEqual({ ok: false, error: "stale" });
    expect(new Date((await itemRow(cut.id)).starts_at)).toEqual(at(15));

    // Undo in order works.
    expect(await undoAction(frontDesk, location, second[0])).toEqual({ ok: true });
    expect(await undoAction(frontDesk, location, first[0])).toEqual({ ok: true });
    expect(new Date((await itemRow(cut.id)).starts_at)).toEqual(at(10));
  });

  it("books a new visit once a client is chosen, and undo removes it", async () => {
    const proposal: Proposal = {
      changes: [],
      book: { clientId: null, items: [{ serviceId: services.get("Women's Cut & Style")!, staffId: BRIDGET, resourceId: null, start: at(14) }] },
    };
    const [id] = await recordProposals(frontDesk, SEED.location, { feature: "ask_denise", subject: null, options: [option("Cut with Bridget at 2", proposal)] });
    oneOffs.push(id);

    expect(await applyAction(frontDesk, location, id)).toEqual({ ok: false, error: "needs_client" });
    expect(await applyAction(frontDesk, location, id, { clientId })).toEqual({ ok: true });
    const applied = await action(id);
    const created = (applied!.previous_state as { created_appointment_id: string }).created_appointment_id;
    appointments.push(created);
    const { data: appt } = await admin.from("appointments").select("client_id, created_by, appointment_items(staff_id, starts_at)").eq("id", created).single();
    expect(appt).toMatchObject({ client_id: clientId, created_by: FRONT_DESK, appointment_items: [{ staff_id: BRIDGET }] });

    expect(await undoAction(frontDesk, location, id)).toEqual({ ok: true });
    const { data: gone } = await admin.from("appointments").select("id").eq("id", created).maybeSingle();
    expect(gone).toBeNull();
  });

  it("books with the length Denise proposed (the stylist's usual time)", async () => {
    const timing = { activeMinutes: 80, processingMinutes: 0, finishingMinutes: 0 };
    const proposal: Proposal = {
      changes: [],
      book: { clientId, items: [{ serviceId: services.get("Women's Cut & Style")!, staffId: BRIDGET, resourceId: null, start: at(16), timing }] },
    };
    const [id] = await recordProposals(frontDesk, SEED.location, { feature: "ask_denise", subject: null, options: [option("Cut with Bridget at 4", proposal)] });
    oneOffs.push(id);
    expect(await applyAction(frontDesk, location, id)).toEqual({ ok: true });
    const created = ((await action(id))!.previous_state as { created_appointment_id: string }).created_appointment_id;
    appointments.push(created);
    const { data: line } = await admin.from("appointment_items").select("active_minutes, processing_minutes, finishing_minutes, ends_at").eq("appointment_id", created).single();
    expect(line).toMatchObject({ active_minutes: 80, processing_minutes: 0, finishing_minutes: 0 });
    expect(new Date(line!.ends_at)).toEqual(new Date(at(16).getTime() + 80 * 60_000));
  });

  it("won't undo a booking once the client has checked in", async () => {
    const proposal: Proposal = {
      changes: [],
      book: { clientId, items: [{ serviceId: services.get("Women's Cut & Style")!, staffId: BRIDGET, resourceId: null, start: at(15) }] },
    };
    const [id] = await recordProposals(frontDesk, SEED.location, { feature: "ask_denise", subject: null, options: [option("Cut", proposal)] });
    oneOffs.push(id);
    expect(await applyAction(frontDesk, location, id)).toEqual({ ok: true });
    const created = ((await action(id))!.previous_state as { created_appointment_id: string }).created_appointment_id;
    appointments.push(created);
    expect(await changeStatus(frontDesk, created, "check_in")).toEqual({ ok: true });
    expect(await undoAction(frontDesk, location, id)).toEqual({ ok: false, error: "stale" });
  });

  it("refuses a save made against an out-of-date calendar", async () => {
    const [cut] = await book([item("Women's Cut & Style", BRIDGET, at(10))]);
    const [id] = await propose(frontDesk, newSubject(), [option("Move to 11:00", move(cut, BRIDGET, at(11)))]);
    const { data: loc } = await admin.from("locations").select("calendar_version").eq("id", SEED.location).single();
    const { error } = await frontDesk.rpc("apply_ai_action", { p_action_id: id, p_expected_version: loc!.calendar_version - 1, p_client_id: null! });
    expect(error?.code).toBe("40001");
    expect((await action(id))!.status).toBe("proposed");
  });
});

describe("who can see and approve", () => {
  it("lets only the front of house record, approve, reject and read proposals", async () => {
    const [cut] = await book([item("Women's Cut & Style", BRIDGET, at(10))]);
    const [id] = await propose(frontDesk, newSubject(), [option("Move to 11:00", move(cut, BRIDGET, at(11)))]);

    await expect(propose(bridget, newSubject(), [option("Move", move(cut, BRIDGET, at(11)))])).rejects.toMatchObject({ code: "42501" });
    expect(await applyAction(bridget, location, id)).toEqual({ ok: false, error: "not_found" }); // can't even see it
    expect(await rejectAction(bridget, id)).toEqual({ ok: false, error: "not_found" });
    const { data: seen } = await bridget.from("ai_actions").select("id").eq("id", id);
    expect(seen).toEqual([]);

    // Another salon sees nothing and can't act on it.
    const { data: theirs } = await otherOwner.from("ai_actions").select("id").eq("id", id);
    expect(theirs).toEqual([]);
    const { error: otherApply } = await otherOwner.rpc("apply_ai_action", { p_action_id: id, p_expected_version: 0, p_client_id: null! });
    expect(otherApply?.code).toBe("42501");
    await expect(recordProposals(otherOwner, SEED.location, { feature: "conflict_resolver", subject: null, options: [] })).rejects.toMatchObject({ code: "42501" });

    expect((await action(id))!.status).toBe("proposed");
    expect(new Date((await itemRow(cut.id)).starts_at)).toEqual(at(10));
  });

  it("refuses direct writes to the log", async () => {
    const [cut] = await book([item("Women's Cut & Style", BRIDGET, at(10))]);
    const [id] = await propose(frontDesk, newSubject(), [option("Move to 11:00", move(cut, BRIDGET, at(11)))]);

    const insert = await frontDesk.from("ai_actions").insert({ business_id: B, location_id: SEED.location, feature: "x", summary: "x", reason: "", proposal: {} });
    expect(insert.error?.code).toBe("42501");
    const { data: updated } = await frontDesk.from("ai_actions").update({ status: "approved" }).eq("id", id).select("id");
    expect(updated ?? []).toEqual([]);
    const { data: deleted } = await frontDesk.from("ai_actions").delete().eq("id", id).select("id");
    expect(deleted ?? []).toEqual([]);
    expect((await action(id))!.status).toBe("proposed");
  });
});
