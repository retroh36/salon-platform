// Group bookings: booking every guest or none, moving and canceling the
// whole group, who can do it, and Denise seeing groups on the day.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadDay } from "@/lib/denise/scan";
import { saveBooking } from "@/lib/scheduling/book";
import { bookGroup, changeGroupStatus, moveGroupItem } from "@/lib/scheduling/group-book";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const location = { id: L, timezone: TZ, businessId: B };
// A Tuesday far from the seeded month: Bridget and Shae work 9-1, Nola 9-5.
const DAY = "2031-11-04";
const at = (h: number, m = 0) => fromLocal(DAY, h * 60 + m, TZ)!;
const { bridget: BRIDGET, shae: SHAE, nola: NOLA } = SEED.staff;

let frontDesk: Client, bridget: Client;
let cut: string, mensCut: string;
const clients: string[] = [];

async function clear() {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
  await admin.from("appointment_groups").delete().eq("location_id", L).like("label", "Test %");
}

beforeAll(async () => {
  [frontDesk, bridget] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  const { data: s } = await admin.from("services").select("id, name").eq("business_id", B).in("name", ["Women's Cut & Style", "Men's Cut"]);
  cut = s!.find((x) => x.name === "Women's Cut & Style")!.id;
  mensCut = s!.find((x) => x.name === "Men's Cut")!.id;
  for (const name of ["Ava", "Bea", "Cal"]) {
    const { data } = await admin.from("clients").insert({ business_id: B, first_name: name, last_name: "Group" }).select("id").single();
    clients.push(data!.id);
  }
  await clear();
});
afterEach(clear);
afterAll(async () => {
  await clear();
  await admin.from("clients").delete().in("id", clients);
});

const party = (start = 10 * 60) => [
  { clientId: clients[0], lines: [{ serviceId: cut, staffId: BRIDGET, startMinute: start, resource: "any" }] },
  { clientId: clients[1], lines: [{ serviceId: cut, staffId: SHAE, startMinute: start, resource: "any" }] },
  { clientId: null, lines: [{ serviceId: mensCut, staffId: NOLA, startMinute: start + 30, resource: "any" }] },
];

describe("booking a group", () => {
  it("books every guest, linked under one label", async () => {
    const r = await bookGroup(frontDesk, location, { label: "Test bridal party", date: DAY, notes: "Champagne", guests: party() });
    expect(r.ok).toBe(true);
    const { data } = await admin.from("appointments").select("client_id, notes, starts_at, group:appointment_groups(label)").in("id", r.ok ? r.appointmentIds : []).order("starts_at");
    // The first two start together, so in either order.
    const rows = data!.map((a) => [a.client_id, a.notes, a.group?.label]);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        [clients[0], "Champagne", "Test bridal party"],
        [clients[1], "Champagne", "Test bridal party"],
      ]),
    );
    expect(rows[2]).toEqual([null, "Champagne", "Test bridal party"]);
  });

  it("books no one if the guests don't all fit together", async () => {
    const clash = party();
    clash[1].lines[0].staffId = BRIDGET; // two guests with Bridget at once
    const r = await bookGroup(frontDesk, location, { label: "Test clash", date: DAY, notes: null, guests: clash });
    expect(r).toMatchObject({ ok: false, error: "invalid", problems: [[[]], [[{ code: "staff_double_booked" }]], [[]]] });
    expect((await admin.from("appointment_groups").select("id").eq("label", "Test clash")).data).toEqual([]);
    expect((await admin.from("appointments").select("id").gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString()).eq("location_id", L)).data).toEqual([]);
  });

  it("saves everyone in one transaction: a clash on the last guest leaves no one, and no group", async () => {
    // Someone books Nola between the app's check and the save: the
    // database refuses the whole party.
    const taken = await saveBooking(frontDesk, location, { clientId: null, notes: null, items: [{ serviceId: mensCut, staffId: NOLA, start: at(10, 30), resource: { kind: "none" } }] });
    expect(taken.ok).toBe(true);
    const { data: v } = await admin.from("locations").select("calendar_version").eq("id", L).single();
    const visit = (clientId: string | null, serviceId: string, staffId: string, start: Date) => ({ appointment_id: null, client_id: clientId, notes: "", items: [{ id: null, service_id: serviceId, staff_id: staffId, resource_id: null, starts_at: start.toISOString(), timing: null }] });
    const { error } = await frontDesk.rpc("save_appointments", {
      p_location_id: L,
      p_visits: [visit(clients[0], cut, BRIDGET, at(10)), visit(clients[1], cut, SHAE, at(10)), visit(null, mensCut, NOLA, at(10, 30))],
      p_expected_version: v!.calendar_version,
      p_new_series: null!,
      p_new_group: { label: "Test race" },
    });
    expect(error?.code).toBe("23P01");
    expect((await admin.from("appointment_groups").select("id").eq("label", "Test race")).data).toEqual([]);
    const { data: left } = await admin.from("appointments").select("id").eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
    expect(left).toEqual([{ id: taken.ok ? taken.appointmentId : "" }]);
  });

  it("is front of house only", async () => {
    expect(await bookGroup(bridget, location, { label: "Test nope", date: DAY, notes: null, guests: party() })).toEqual({ ok: false, error: "forbidden" });
    const own = await bookGroup(frontDesk, location, { label: "Test own", date: DAY, notes: null, guests: party() });
    const { error } = await bridget.rpc("set_appointment_group", { p_appointment_id: own.ok ? own.appointmentIds[0] : "", p_group_id: null as unknown as string });
    expect(error?.code).toBe("42501");
  });
});

describe("changing a group", () => {
  it("moves the whole group by the same amount, or not at all", async () => {
    const r = await bookGroup(frontDesk, location, { label: "Test move", date: DAY, notes: null, guests: party() });
    const ids = r.ok ? r.appointmentIds : [];
    const { data: avaItem } = await admin.from("appointment_items").select("id").eq("appointment_id", ids[0]).single();
    const starts = async () => (await admin.from("appointment_items").select("starts_at, appointment_id").in("appointment_id", ids)).data!.map((i) => [ids.indexOf(i.appointment_id), new Date(i.starts_at).getTime()]).sort();

    expect(await moveGroupItem(frontDesk, location, { itemId: avaItem!.id, staffId: BRIDGET, start: at(11) })).toEqual({ ok: true, moved: 3 });
    expect(await starts()).toEqual([
      [0, at(11).getTime()],
      [1, at(11).getTime()],
      [2, at(11, 30).getTime()],
    ]);

    // Shae has someone at 9:30, so the group can't move to 9:15.
    await saveBooking(frontDesk, location, { clientId: null, notes: null, items: [{ serviceId: mensCut, staffId: SHAE, start: at(9, 30), resource: { kind: "none" } }] });
    expect(await moveGroupItem(frontDesk, location, { itemId: avaItem!.id, staffId: BRIDGET, start: at(9, 15) })).toMatchObject({ ok: false, error: "invalid" });
    expect((await starts())[0]).toEqual([0, at(11).getTime()]);
  });

  it("cancels every guest", async () => {
    const r = await bookGroup(frontDesk, location, { label: "Test cancel", date: DAY, notes: null, guests: party() });
    const ids = r.ok ? r.appointmentIds : [];
    const results = await changeGroupStatus(frontDesk, ids[1], "cancel", "Client canceled");
    expect(results.map((x) => x.result.ok)).toEqual([true, true, true]);
    const { data } = await admin.from("appointments").select("status").in("id", ids);
    expect(data!.map((a) => a.status)).toEqual(["canceled", "canceled", "canceled"]);
  });

  it("is something Denise knows about", async () => {
    const r = await bookGroup(frontDesk, location, { label: "Test denise", date: DAY, notes: null, guests: party() });
    const { day, lookup } = await loadDay(frontDesk, { location: { id: L, timezone: TZ }, salon: "Maple & Ash", canBook: true }, DAY);
    const ids = r.ok ? r.appointmentIds : [];
    expect(new Set(ids.map((id) => day.groups?.get(id))).size).toBe(1);
    expect(lookup.visits.get(ids[0])?.group?.label).toBe("Test denise");
  });
});
