// Actual times: record_item_time (one tap at a time), who may tap, the
// order of taps, undo, and check-in/out stamps. Also that the demo data
// has realistic actual times to learn from.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, makeRoom, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
let bridget: Client;
let gil: Client;
let frontDesk: Client;
let appointmentId: string;
let colorItem: string;
let cutItem: string;
let putBack = async () => {};

beforeAll(async () => {
  [bridget, gil, frontDesk] = await Promise.all([signIn("bridget@mapleandash.test"), signIn("gil@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  const { data: services } = await admin.from("services").select("id, name").eq("business_id", B).in("name", ["Root Touch-Up", "Women's Cut & Style"]);
  const color = services!.find((s) => s.name === "Root Touch-Up")!.id;
  const cut = services!.find((s) => s.name === "Women's Cut & Style")!.id;
  const start = new Date(Date.now() + 60 * 60_000);
  // Bridget may have demo clients then, on a working day.
  putBack = await makeRoom(SEED.staff.bridget, start, new Date(start.getTime() + 145 * 60_000));
  const { data: a } = await admin
    .from("appointments")
    .insert({ business_id: B, location_id: L, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 145 * 60_000).toISOString(), status: "confirmed", notes: "actual-times test" })
    .select("id")
    .single();
  appointmentId = a!.id;
  const { data: items, error } = await admin
    .from("appointment_items")
    .insert([
      { business_id: B, location_id: L, appointment_id: appointmentId, service_id: color, staff_id: SEED.staff.bridget, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 85 * 60_000).toISOString(), active_minutes: 30, processing_minutes: 35, finishing_minutes: 20, price_cents: 0 },
      { business_id: B, location_id: L, appointment_id: appointmentId, service_id: cut, staff_id: SEED.staff.bridget, starts_at: new Date(start.getTime() + 85 * 60_000).toISOString(), ends_at: new Date(start.getTime() + 145 * 60_000).toISOString(), active_minutes: 60, processing_minutes: 0, finishing_minutes: 0, price_cents: 0 },
    ])
    .select("id, service_id");
  if (error) throw new Error(error.message);
  colorItem = items!.find((i) => i.service_id === color)!.id;
  cutItem = items!.find((i) => i.service_id === cut)!.id;
});

afterAll(async () => {
  await admin.from("appointments").delete().eq("id", appointmentId);
  await putBack();
});

const tap = (client: Client, item: string, event: string) => client.rpc("record_item_time", { p_item_id: item, p_event: event });
const times = async (item: string) =>
  (await admin.from("appointment_items").select("started_at, processing_started_at, processing_ended_at, finished_at").eq("id", item).single()).data!;

describe("one-tap times", () => {
  it("only the stylist doing it or the front desk can tap", async () => {
    expect((await tap(gil, colorItem, "start")).error?.code).toBe("42501");
    expect((await times(colorItem)).started_at).toBeNull();
  });

  it("starting checks the client in, and taps go in order", async () => {
    expect((await tap(bridget, colorItem, "processing")).error?.code).toBe("55000");
    expect((await tap(bridget, colorItem, "start")).error).toBeNull();
    const { data: visit } = await admin.from("appointments").select("status, checked_in_at").eq("id", appointmentId).single();
    expect(visit!.status).toBe("checked_in");
    expect(visit!.checked_in_at).not.toBeNull();

    const first = (await times(colorItem)).started_at;
    // A second tap keeps the first time.
    await tap(bridget, colorItem, "start");
    expect((await times(colorItem)).started_at).toBe(first);

    expect((await tap(bridget, colorItem, "rinse")).error?.code).toBe("55000");
    expect((await tap(bridget, colorItem, "processing")).error).toBeNull();
    expect((await tap(frontDesk, colorItem, "rinse")).error).toBeNull();
    expect((await tap(bridget, colorItem, "finish")).error).toBeNull();
    const done = await times(colorItem);
    expect(Object.values(done).every((v) => v !== null)).toBe(true);
  });

  it("finishing during processing closes processing too; undo steps back one tap", async () => {
    await tap(bridget, cutItem, "start");
    await tap(bridget, cutItem, "processing");
    await tap(bridget, cutItem, "finish");
    let t = await times(cutItem);
    expect(t.processing_ended_at).not.toBeNull();
    expect(t.finished_at).not.toBeNull();

    await tap(bridget, cutItem, "undo");
    t = await times(cutItem);
    expect(t.finished_at).toBeNull();
    expect(t.processing_ended_at).not.toBeNull();
    await tap(bridget, cutItem, "undo");
    await tap(bridget, cutItem, "undo");
    await tap(bridget, cutItem, "undo");
    expect(await times(cutItem)).toEqual({ started_at: null, processing_started_at: null, processing_ended_at: null, finished_at: null });
  });

  it("checking out stamps the time; canceled visits take no taps", async () => {
    expect((await frontDesk.rpc("set_appointment_status", { p_appointment_id: appointmentId, p_status: "completed", p_reason: "" })).error).toBeNull();
    expect((await admin.from("appointments").select("checked_out_at").eq("id", appointmentId).single()).data!.checked_out_at).not.toBeNull();
    // Already checked out: can't start what wasn't started.
    expect((await tap(bridget, cutItem, "start")).error?.code).toBe("55000");
    await admin.from("appointments").update({ status: "canceled", cancel_reason: "test", canceled_at: new Date().toISOString() }).eq("id", appointmentId);
    expect((await tap(frontDesk, colorItem, "undo")).error?.code).toBe("55000");
  });
});

describe("the demo history", () => {
  it("has actual times for past visits, with each stylist's own pace", async () => {
    const { data } = await admin
      .from("appointment_items")
      .select("started_at, finished_at, active_minutes, processing_minutes, finishing_minutes, service:services!inner(category), appointment:appointments!inner(status)")
      .eq("staff_id", SEED.staff.bridget)
      .eq("appointment.status", "completed")
      .in("service.category", ["Balayage", "Highlights"])
      .not("finished_at", "is", null);
    expect(data!.length).toBeGreaterThan(10);
    const ratios = data!.map((i) => (new Date(i.finished_at!).getTime() - new Date(i.started_at!).getTime()) / 60_000 / (i.active_minutes + i.processing_minutes + i.finishing_minutes)).sort((a, b) => a - b);
    // Bridget runs long on lightening.
    expect(ratios[Math.floor(ratios.length / 2)]).toBeGreaterThan(1.08);
  });
});
