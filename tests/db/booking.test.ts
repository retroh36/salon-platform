// Booking, editing, moving and status changes through lib/scheduling/book.ts
// and the database functions behind it, signed in as real staff.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { changeStatus, moveItem, saveBooking, saveNotes, type BookingItemInput } from "@/lib/scheduling/book";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const TZ = "America/Chicago";
const location = { id: SEED.location, timezone: TZ };
const { bridget: BRIDGET, shae: SHAE, gil: GIL, frontDesk: FRONT_DESK, manager: MANAGER } = SEED.staff;
const CHAIR = (n: number) => `f0000000-0000-4000-8000-00000000000${n}`;
// A Tuesday far from the seeded month. Bridget works 9-1 and 2-6, Shae 9-1
// and 1:30-5:30.
const DAY = "2031-06-03";
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let frontDesk: Client;
let manager: Client;
let bridget: Client;
let gil: Client;
let otherOwner: Client;
let services: Map<string, string>;
let clientId: string;

const created: string[] = [];

function item(service: string, staffId: string, start: Date, extra: Partial<BookingItemInput> = {}): BookingItemInput {
  return { serviceId: services.get(service)!, staffId, start, resource: { kind: "any" }, ...extra };
}

async function book(client: Client, items: BookingItemInput[], notes: string | null = null) {
  const result = await saveBooking(client, location, { clientId, notes, items });
  if (result.ok) created.push(result.appointmentId);
  return result;
}

async function appointment(id: string) {
  const { data } = await admin
    .from("appointments")
    .select("status, notes, starts_at, ends_at, created_by, updated_by, cancel_reason, canceled_at, appointment_items(id, service_id, staff_id, resource_id, starts_at, price_cents, active_minutes)")
    .eq("id", id)
    .single();
  data!.appointment_items.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return data!;
}

beforeAll(async () => {
  other = await createOtherSalon();
  [frontDesk, manager, bridget, gil, otherOwner] = await Promise.all([
    signIn("frontdesk@mapleandash.test"),
    signIn("manager@mapleandash.test"),
    signIn("bridget@mapleandash.test"),
    signIn("gil@mapleandash.test"),
    signIn(other.email),
  ]);
  const { data } = await admin.from("services").select("id, name").eq("business_id", B);
  services = new Map(data!.map((s) => [s.name, s.id]));
  const { data: c } = await admin.from("clients").select("id").eq("business_id", B).order("id").limit(1).single();
  clientId = c!.id;
});

afterEach(async () => {
  if (created.length) await admin.from("appointments").delete().in("id", created.splice(0));
});

afterAll(async () => {
  await other?.cleanup();
});

// ---------------------------------------------------------------------------

describe("booking", () => {
  it("books a visit with two stylists, recording who booked it", async () => {
    const result = await book(
      frontDesk,
      [item("All-Over Color", BRIDGET, at(10)), item("Blowout", SHAE, at(11, 45))],
      "First visit",
    );
    expect(result.ok).toBe(true);
    const a = await appointment(result.ok ? result.appointmentId : "");
    expect(a).toMatchObject({
      status: "booked",
      notes: "First visit",
      created_by: FRONT_DESK,
      updated_by: FRONT_DESK,
      starts_at: "2031-06-03T15:00:00+00:00",
      ends_at: "2031-06-03T17:30:00+00:00",
    });
    // Bridget's color price (15% over the menu's $130) and the first free chairs.
    expect(a.appointment_items.map((i) => [i.staff_id, i.resource_id, i.price_cents])).toEqual([
      [BRIDGET, CHAIR(1), 15000],
      [SHAE, CHAIR(1), 4500], // Shae's Artisan price for a blowout
    ]);
  });

  it("books into a processing gap with another chair, and refuses a double-booking", async () => {
    await book(frontDesk, [item("All-Over Color", BRIDGET, at(10))]);

    const gap = await book(frontDesk, [item("Bang Trim", BRIDGET, at(10, 45))]);
    expect(gap.ok).toBe(true);
    const trim = await appointment(gap.ok ? gap.appointmentId : "");
    expect(trim.appointment_items[0].resource_id).toBe(CHAIR(2));

    const clash = await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10, 30))]);
    expect(clash).toEqual({ ok: false, error: "invalid", problems: [[expect.objectContaining({ code: "staff_double_booked" })]] });
  });

  it("reports problems for each service in the visit", async () => {
    const result = await book(frontDesk, [
      item("Women's Cut & Style", BRIDGET, at(12, 30)), // into the lunch break between shifts
      item("Skin Fade", SHAE, at(14)), // Shae doesn't do fades
      item("Blowout", SHAE, at(15), { resource: { kind: "exact", id: CHAIR(1) } }),
    ]);
    expect(result).toEqual({
      ok: false,
      error: "invalid",
      problems: [[{ code: "staff_unavailable", reason: "not_working" }], [{ code: "service_not_offered" }], []],
    });
    const { count } = await admin.from("appointments").select("id", { count: "exact", head: true }).gte("starts_at", "2031-06-03").lt("starts_at", "2031-06-04");
    expect(count).toBe(0);
  });

  it("says when every chair is taken", async () => {
    // Every chair busy 10-10:30 (set up directly; no stylists needed).
    const { data: a } = await admin
      .from("appointments")
      .insert({ business_id: B, location_id: SEED.location, starts_at: at(10).toISOString(), ends_at: at(10, 30).toISOString() })
      .select("id")
      .single();
    created.push(a!.id);
    const { error } = await admin.from("appointment_items").insert(
      [1, 2, 3, 4, 5, 6, 7].map((n) => ({
        business_id: B,
        location_id: SEED.location,
        appointment_id: a!.id,
        service_id: services.get("Men's Cut")!,
        staff_id: GIL,
        resource_id: CHAIR(n),
        starts_at: at(10).toISOString(),
        ends_at: at(10, 30).toISOString(),
        active_minutes: 30,
        price_cents: 4500,
      })),
    );
    expect(error).toBeNull();

    expect(await book(frontDesk, [item("Bang Trim", BRIDGET, at(10))])).toEqual({ ok: false, error: "invalid", problems: [[{ code: "no_free_resource" }]] });
    // Without a chair, or once a chair frees up, it fits.
    expect((await book(frontDesk, [item("Bang Trim", BRIDGET, at(10), { resource: { kind: "none" } })])).ok).toBe(true);
    expect((await book(frontDesk, [item("Bang Trim", BRIDGET, at(10, 30))])).ok).toBe(true);
  });
});

describe("two people booking the same slot at once", () => {
  it("lets exactly one of them have it", async () => {
    const results = await Promise.all([
      book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))]),
      book(manager, [item("Women's Cut & Style", BRIDGET, at(10, 30))]),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({
      ok: false,
      error: "invalid",
      problems: [[expect.objectContaining({ code: "staff_double_booked" })]],
    });
  });

  it("refuses a save checked against an out-of-date calendar", async () => {
    const { data } = await admin.from("locations").select("calendar_version").eq("id", SEED.location).single();
    await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))]);
    const { error } = await frontDesk.rpc("save_appointment", {
      p_location_id: SEED.location,
      p_appointment_id: null!,
      p_client_id: clientId,
      p_notes: "",
      p_items: [{ service_id: services.get("Women's Cut & Style"), staff_id: BRIDGET, resource_id: null, starts_at: at(10).toISOString() }],
      p_expected_version: data!.calendar_version,
    });
    expect(error?.code).toBe("40001");
  });
});

describe("editing", () => {
  it("changes services, keeps unchanged items, and records who changed it", async () => {
    const booked = await book(frontDesk, [item("All-Over Color", BRIDGET, at(10)), item("Blowout", SHAE, at(11, 45))]);
    const id = booked.ok ? booked.appointmentId : "";
    const before = await appointment(id);
    const [color, blowout] = before.appointment_items;

    // Swap the blowout for a cut with Shae, drop nothing, add a gloss later.
    const result = await saveBooking(manager, location, {
      appointmentId: id,
      clientId,
      notes: "Changed",
      items: [
        { id: color.id, serviceId: color.service_id, staffId: BRIDGET, start: at(10), resource: { kind: "exact", id: color.resource_id! } },
        { id: blowout.id, serviceId: services.get("Women's Cut & Style")!, staffId: SHAE, start: at(11, 45), resource: { kind: "any" } },
      ],
    });
    expect(result.ok).toBe(true);
    const after = await appointment(id);
    expect(after.updated_by).toBe(MANAGER);
    expect(after.created_by).toBe(FRONT_DESK);
    expect(after.notes).toBe("Changed");
    expect(after.appointment_items.map((i) => i.id)).toEqual([color.id, blowout.id]);
    expect(after.appointment_items[1].service_id).toBe(services.get("Women's Cut & Style"));
    expect(after.ends_at).toBe("2031-06-03T17:45:00+00:00");

    // Removing an item.
    await saveBooking(manager, location, {
      appointmentId: id,
      clientId,
      notes: null,
      items: [{ id: color.id, serviceId: color.service_id, staffId: BRIDGET, start: at(10), resource: { kind: "exact", id: color.resource_id! } }],
    });
    expect((await appointment(id)).appointment_items).toHaveLength(1);
  });

  it("keeps an item's booked timing when the menu changes", async () => {
    const booked = await book(frontDesk, [item("Gloss / Toner", BRIDGET, at(10))]);
    const id = booked.ok ? booked.appointmentId : "";
    const gloss = services.get("Gloss / Toner")!;
    await admin.from("services").update({ active_minutes: 30 }).eq("id", gloss);
    try {
      const moved = await moveItem(frontDesk, location, { itemId: (await appointment(id)).appointment_items[0].id, staffId: BRIDGET, start: at(11) });
      expect(moved.ok).toBe(true);
      expect((await appointment(id)).appointment_items[0].active_minutes).toBe(15);
    } finally {
      await admin.from("services").update({ active_minutes: 15 }).eq("id", gloss);
    }
  });

  it("can't change a visit that's checked out or canceled", async () => {
    const booked = await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))]);
    const id = booked.ok ? booked.appointmentId : "";
    await changeStatus(frontDesk, id, "check_in");
    await changeStatus(frontDesk, id, "check_out");
    const [only] = (await appointment(id)).appointment_items;
    expect(await moveItem(frontDesk, location, { itemId: only.id, staffId: BRIDGET, start: at(11) })).toEqual({ ok: false, error: "not_editable" });
  });
});

describe("two people editing the same visit", () => {
  it("refuses an edit made from what the visit was before someone else changed it, so nothing is silently undone", async () => {
    const booked = await book(frontDesk, [item("Blowout", SHAE, at(14))], "Fine hair");
    const id = booked.ok ? booked.appointmentId : "";
    const [opened] = (await appointment(id)).appointment_items;
    const seen = { notes: "Fine hair", items: [{ id: opened.id, serviceId: opened.service_id, staffId: SHAE, start: at(14) }] };

    // Meanwhile the manager moves her to 3:00 (a drag, or Denise's fix).
    expect((await moveItem(manager, location, { itemId: opened.id, staffId: SHAE, start: at(15) })).ok).toBe(true);

    // The front desk saves the edit they opened at 2:00, changing the notes.
    const stale = await saveBooking(frontDesk, location, {
      appointmentId: id,
      clientId,
      notes: "Fine hair, likes it warm",
      items: [{ id: opened.id, serviceId: opened.service_id, staffId: SHAE, start: at(14), resource: { kind: "any" } }],
      seen,
    });
    expect(stale).toEqual({ ok: false, error: "changed" });
    const after = await appointment(id);
    expect([after.appointment_items[0].starts_at, after.notes]).toEqual([at(15).toISOString().replace(".000Z", "+00:00"), "Fine hair"]);

    // Opened again, from what it is now, the edit saves.
    const fresh = await saveBooking(frontDesk, location, {
      appointmentId: id,
      clientId,
      notes: "Fine hair, likes it warm",
      items: [{ id: opened.id, serviceId: opened.service_id, staffId: SHAE, start: at(15), resource: { kind: "any" } }],
      seen: { notes: "Fine hair", items: [{ ...seen.items[0], start: at(15) }] },
    });
    expect(fresh.ok).toBe(true);
  });
});

describe("moving", () => {
  it("moves an item to another time and stylist, keeping its chair when free", async () => {
    const booked = await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))]);
    const id = booked.ok ? booked.appointmentId : "";
    const [cut] = (await appointment(id)).appointment_items;

    const result = await moveItem(manager, location, { itemId: cut.id, staffId: SHAE, start: at(14) });
    expect(result.ok).toBe(true);
    const after = await appointment(id);
    expect(after.appointment_items[0]).toMatchObject({ staff_id: SHAE, resource_id: cut.resource_id, starts_at: "2031-06-03T19:00:00+00:00" });
    expect(after.updated_by).toBe(MANAGER);
    // Shae's price (the Artisan rate) now applies.
    expect(after.appointment_items[0].price_cents).toBe(7000);
  });

  it("refuses a move that breaks a rule, leaving the visit as it was", async () => {
    const booked = await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))]);
    await book(frontDesk, [item("Women's Cut & Style", SHAE, at(14))]);
    const id = booked.ok ? booked.appointmentId : "";
    const [cut] = (await appointment(id)).appointment_items;

    expect(await moveItem(frontDesk, location, { itemId: cut.id, staffId: SHAE, start: at(14, 30) })).toEqual({
      ok: false,
      error: "invalid",
      problems: [[expect.objectContaining({ code: "staff_double_booked" })]],
    });
    expect(await moveItem(frontDesk, location, { itemId: cut.id, staffId: BRIDGET, start: at(17, 30) })).toEqual({
      ok: false,
      error: "invalid",
      problems: [[{ code: "staff_unavailable", reason: "not_working" }]],
    });
    expect(await moveItem(frontDesk, location, { itemId: cut.id, staffId: GIL, start: at(10) })).toEqual({
      ok: false,
      error: "invalid",
      problems: [[{ code: "staff_unavailable", reason: "not_working" }]], // Gil is off on Tuesdays
    });
    expect((await appointment(id)).appointment_items[0].starts_at).toBe("2031-06-03T15:00:00+00:00");
  });

  it("checks a moved item against the rest of its own visit", async () => {
    const booked = await book(frontDesk, [item("All-Over Color", BRIDGET, at(10)), item("Blowout", SHAE, at(11, 45))]);
    const id = booked.ok ? booked.appointmentId : "";
    const [, blowout] = (await appointment(id)).appointment_items;
    // Into the color's chair while the color is still processing: another chair is found.
    const result = await moveItem(frontDesk, location, { itemId: blowout.id, staffId: SHAE, start: at(11) });
    expect(result.ok).toBe(true);
    const items = (await appointment(id)).appointment_items;
    expect(items[1].resource_id).not.toBe(items[0].resource_id);
  });
});

describe("status", () => {
  it("checks in, checks out, and stops there", async () => {
    const booked = await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))]);
    const id = booked.ok ? booked.appointmentId : "";
    expect(await changeStatus(frontDesk, id, "check_out")).toEqual({ ok: false, error: "not_allowed" });
    expect(await changeStatus(frontDesk, id, "check_in")).toEqual({ ok: true });
    expect((await appointment(id)).status).toBe("checked_in");
    expect(await changeStatus(manager, id, "check_out")).toEqual({ ok: true });
    const done = await appointment(id);
    expect(done).toMatchObject({ status: "completed", updated_by: MANAGER });
    expect(await changeStatus(frontDesk, id, "cancel", "Oops")).toEqual({ ok: false, error: "not_allowed" });
  });

  it("cancels with a reason, freeing the time", async () => {
    const booked = await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))]);
    const id = booked.ok ? booked.appointmentId : "";
    expect(await changeStatus(frontDesk, id, "cancel", "  ")).toEqual({ ok: false, error: "needs_reason" });
    expect(await changeStatus(frontDesk, id, "cancel", "Client is sick")).toEqual({ ok: true });
    const a = await appointment(id);
    expect(a.status).toBe("canceled");
    expect(a.cancel_reason).toBe("Client is sick");
    expect(a.canceled_at).not.toBeNull();
    // The database insists on a reason too.
    const { error } = await frontDesk.rpc("set_appointment_status", { p_appointment_id: id, p_status: "canceled", p_reason: "" });
    expect(error?.code).toBe("22023");

    expect((await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))])).ok).toBe(true);
  });

  it("marks a no-show, freeing the time", async () => {
    const booked = await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))]);
    const id = booked.ok ? booked.appointmentId : "";
    expect(await changeStatus(frontDesk, id, "no_show")).toEqual({ ok: true });
    expect((await appointment(id)).status).toBe("no_show");
    expect((await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))])).ok).toBe(true);
  });
});

describe("permissions", () => {
  it("doesn't let stylists book, move or change status", async () => {
    expect(await saveBooking(bridget, location, { clientId, notes: null, items: [item("Women's Cut & Style", BRIDGET, at(10))] })).toEqual({
      ok: false,
      error: "forbidden",
    });
    const booked = await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))]);
    const id = booked.ok ? booked.appointmentId : "";
    const [cut] = (await appointment(id)).appointment_items;
    expect(await moveItem(bridget, location, { itemId: cut.id, staffId: BRIDGET, start: at(11) })).toEqual({ ok: false, error: "forbidden" });
    expect(await changeStatus(bridget, id, "check_in")).toEqual({ ok: false, error: "forbidden" });
    expect((await appointment(id)).status).toBe("booked");
  });

  it("lets stylists edit notes on their own visits only", async () => {
    const booked = await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))]);
    const id = booked.ok ? booked.appointmentId : "";

    expect(await saveNotes(gil, id, "Not mine")).toEqual({ ok: false });
    expect(await saveNotes(bridget, id, "Wants a fringe")).toEqual({ ok: true });
    expect(await appointment(id)).toMatchObject({ notes: "Wants a fringe", updated_by: BRIDGET });
    expect(await saveNotes(frontDesk, id, "Running late")).toEqual({ ok: true });
    expect(await appointment(id)).toMatchObject({ notes: "Running late", updated_by: FRONT_DESK });
  });

  it("keeps other salons out", async () => {
    const result = await otherOwner.rpc("save_appointment", {
      p_location_id: SEED.location,
      p_appointment_id: null!,
      p_client_id: clientId,
      p_notes: "",
      p_items: [{ service_id: services.get("Women's Cut & Style"), staff_id: BRIDGET, resource_id: null, starts_at: at(10).toISOString() }],
      p_expected_version: 0,
    });
    expect(result.error?.code).toBe("42501");

    const booked = await book(frontDesk, [item("Women's Cut & Style", BRIDGET, at(10))]);
    const id = booked.ok ? booked.appointmentId : "";
    expect(await saveNotes(otherOwner, id, "x")).toEqual({ ok: false });
    const { error } = await otherOwner.rpc("set_appointment_status", { p_appointment_id: id, p_status: "canceled", p_reason: "x" });
    expect(error?.code).toBe("42501");
    expect((await appointment(id)).status).toBe("booked");
  });

  it("only takes clients, stylists and services from the same business", async () => {
    const { data: theirs } = await admin.from("clients").insert({ business_id: other.businessId, first_name: "Theirs" }).select("id").single();
    expect(await saveBooking(frontDesk, location, { clientId: theirs!.id, notes: null, items: [item("Women's Cut & Style", BRIDGET, at(10))] })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
