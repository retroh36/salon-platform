// The visit audit log (migration …_visit_changes.sql): every change to a
// visit is written by the database itself, with who did it and what it was
// before, whatever path made it; nobody writes it directly; the front of
// house and anyone with `audit` read it, stylists don't. Also the `audit`
// permission, and an owner's switch for `adjust_points` now saves.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { changeStatus, moveItem, saveBooking, type BookingItemInput } from "@/lib/scheduling/book";
import { fromLocal } from "@/lib/scheduling/time";
import { changeLine, type VisitChange } from "@/lib/visit-changes";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const TZ = "America/Chicago";
const location = { id: SEED.location, timezone: TZ };
const { bridget: BRIDGET, shae: SHAE, frontDesk: FRONT_DESK } = SEED.staff;
// A Tuesday far from the seeded month (Bridget and Shae work).
const DAY = "2031-06-10";
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;

let frontDesk: Client;
let manager: Client;
let owner: Client;
let bridget: Client;
let services: Map<string, string>;
let clientId: string;
const created: string[] = [];

const item = (service: string, staffId: string, start: Date): BookingItemInput => ({ serviceId: services.get(service)!, staffId, start, resource: { kind: "any" } });

async function changes(id: string) {
  const { data, error } = await admin.from("visit_changes").select("kind, item_id, before, after, by_staff_id, by_kind, created_at").eq("appointment_id", id).order("created_at").order("kind");
  if (error) throw error;
  return data as (VisitChange & { item_id: string | null })[];
}

beforeAll(async () => {
  [frontDesk, manager, owner, bridget] = await Promise.all([
    signIn("frontdesk@mapleandash.test"),
    signIn("manager@mapleandash.test"),
    signIn("owner@mapleandash.test"),
    signIn("bridget@mapleandash.test"),
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
  await admin.from("staff_permissions").delete().eq("staff_id", FRONT_DESK);
});

describe("the visit log", () => {
  it("records booking, a move to another stylist and time, and each status, with who", async () => {
    const booked = await saveBooking(frontDesk, location, { clientId, notes: null, items: [item("Blowout", BRIDGET, at(10))] });
    if (!booked.ok) throw new Error(JSON.stringify(booked));
    created.push(booked.appointmentId);
    const id = booked.appointmentId;
    const { data: it } = await admin.from("appointment_items").select("id").eq("appointment_id", id).single();

    expect(await moveItem(manager, location, { itemId: it!.id, staffId: SHAE, start: at(14) })).toMatchObject({ ok: true });
    expect(await changeStatus(frontDesk, id, "check_in")).toEqual({ ok: true });

    const log = await changes(id);
    expect(log.map((c) => c.kind)).toEqual(["booked", "changed", "status"]);
    expect(log[0]).toMatchObject({ by_staff_id: FRONT_DESK, by_kind: "staff", after: { status: "booked", source: "front_desk" } });
    expect(log[1]).toMatchObject({ item_id: it!.id, by_staff_id: SEED.staff.manager, before: { staff_id: BRIDGET }, after: { staff_id: SHAE } });
    expect(new Date(log[1].before.starts_at as string).getTime()).toBe(at(10).getTime());
    expect(new Date(log[1].after.starts_at as string).getTime()).toBe(at(14).getTime());
    expect(log[2]).toMatchObject({ before: { status: "booked" }, after: { status: "checked_in" }, by_staff_id: FRONT_DESK });

    // In words.
    const names = { staff: (s: string | null | undefined) => ({ [BRIDGET]: "Bridget", [SHAE]: "Shae", [SEED.staff.manager]: "Daniel" })[s ?? ""] ?? null, service: () => "Blowout", client: () => null, timeZone: TZ };
    expect(changeLine(log[1], names)).toMatch(/^Blowout: moved from Tue, Jun 10, 10am to 2pm, from Bridget to Shae, price \$65 to \$45 by Daniel · /);
    expect(changeLine(log[2], { ...names, staff: () => "Sam Rivera" })).toMatch(/^Checked in by Sam Rivera · /);
  });

  it("records a cancellation with its reason, and a client's own online change", async () => {
    const booked = await saveBooking(frontDesk, location, { clientId, notes: null, items: [item("Blowout", BRIDGET, at(11))] });
    if (!booked.ok) throw new Error(JSON.stringify(booked));
    created.push(booked.appointmentId);
    expect(await changeStatus(frontDesk, booked.appointmentId, "cancel", "client")).toEqual({ ok: true });
    const log = await changes(booked.appointmentId);
    expect(log.at(-1)).toMatchObject({ kind: "status", after: { status: "canceled" }, by_kind: "staff" });

    // The service role (online booking, a client's manage link) is the
    // client for an online visit, else Maestra.
    await admin.from("appointments").update({ source: "online" }).eq("id", booked.appointmentId);
    await admin.from("appointments").update({ status: "booked", canceled_at: null, cancel_reason: null }).eq("id", booked.appointmentId);
    expect((await changes(booked.appointmentId)).at(-1)).toMatchObject({ kind: "status", by_kind: "client", by_staff_id: null, before: { status: "canceled" } });
  });

  it("can't be written or changed by anyone signed in, and stylists can't read it", async () => {
    const booked = await saveBooking(frontDesk, location, { clientId, notes: null, items: [item("Blowout", BRIDGET, at(12))] });
    if (!booked.ok) throw new Error(JSON.stringify(booked));
    created.push(booked.appointmentId);
    const id = booked.appointmentId;
    expect((await frontDesk.from("visit_changes").select("kind").eq("appointment_id", id)).data).toHaveLength(1);
    expect((await manager.from("visit_changes").select("kind").eq("appointment_id", id)).data).toHaveLength(1);
    expect((await bridget.from("visit_changes").select("kind").eq("appointment_id", id)).data).toEqual([]);
    const forged = await owner.from("visit_changes").insert({ business_id: B, location_id: SEED.location, appointment_id: id, kind: "status", by_kind: "system" });
    expect(forged.error).not.toBeNull();
    await owner.from("visit_changes").delete().eq("appointment_id", id);
    expect(await changes(id)).toHaveLength(1);
  });
});

describe("the audit permission", () => {
  it("is on for owners and managers, and an owner can give it (or adjust_points) to the front desk", async () => {
    expect((await owner.rpc("my_permissions", { p_business_id: B })).data).toContain("audit");
    expect((await manager.rpc("my_permissions", { p_business_id: B })).data).toContain("audit");
    expect((await frontDesk.rpc("my_permissions", { p_business_id: B })).data).not.toContain("audit");
    expect((await owner.rpc("set_staff_permission", { p_staff_id: FRONT_DESK, p_permission: "audit", p_allowed: true })).error).toBeNull();
    expect((await owner.rpc("set_staff_permission", { p_staff_id: FRONT_DESK, p_permission: "adjust_points", p_allowed: true })).error).toBeNull();
    expect((await frontDesk.rpc("my_permissions", { p_business_id: B })).data).toEqual(expect.arrayContaining(["audit", "adjust_points"]));
  });
});
