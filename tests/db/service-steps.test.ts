// Services built from steps: the steps set the service's totals, an item
// takes the service's steps fitted to its own totals, each processing step
// is free time for the stylist in the database's double-booking guard, and
// a visit's own steps change only through set_item_steps.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fitSteps, type Step } from "@/lib/scheduling/steps";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, signIn, SEED, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET } = SEED.staff;
// A Tuesday far from the seeded month.
const DAY = "2031-07-15";
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const TAG = `St${Date.now().toString(36)}`;
const busy = (name: string, minutes: number): Step => ({ name, minutes, processing: false });
const wait = (minutes: number): Step => ({ name: "Processing", minutes, processing: true });
const STEPS = [busy("Highlight", 60), wait(30), busy("Gloss", 15), wait(20), busy("Cut", 45)];

let clientId: string;
let serviceId: string;
let blowoutId: string;
let frontDesk: Client;
let stylist: Client;

beforeAll(async () => {
  [frontDesk, stylist] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Ava`, last_name: "Test" }).select("id").single();
  clientId = c!.id;
  const { data: s, error } = await admin
    .from("services")
    .insert({ business_id: B, name: `${TAG} Color and cut`, category: "Color", active_minutes: 5, price_cents: 20000, steps: STEPS })
    .select("id, active_minutes, processing_minutes, finishing_minutes")
    .single();
  if (error) throw error;
  serviceId = s.id;
  blowoutId = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single()).data!.id;
});

afterAll(async () => {
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("services").delete().eq("id", serviceId);
});

async function book(service: string, start: Date, totals: [number, number, number]) {
  const end = new Date(start.getTime() + totals.reduce((a, b) => a + b) * 60_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString() }).select("id").single();
  const { data, error } = await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: service, staff_id: BRIDGET, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: totals[0], processing_minutes: totals[1], finishing_minutes: totals[2], price_cents: 5000 })
    .select("id, steps")
    .maybeSingle();
  return { item: data, error };
}

describe("a service built from steps", () => {
  it("takes its totals from its steps, and refuses steps that can't be used", async () => {
    const { data } = await admin.from("services").select("active_minutes, processing_minutes, finishing_minutes, duration_minutes").eq("id", serviceId).single();
    expect(data).toEqual({ active_minutes: 60, processing_minutes: 50, finishing_minutes: 60, duration_minutes: 170 });
    const bad = await admin.from("services").update({ steps: [busy("Cut", 30), wait(10)] }).eq("id", serviceId);
    expect(bad.error?.hint).toBe("first_or_last");
  });

  it("books with its steps, fitted to the item's own totals the same way as the app", async () => {
    const plain = await book(serviceId, at(9), [60, 50, 60]);
    expect(plain.item!.steps).toEqual(STEPS);
    const longer = await book(serviceId, at(15), [60, 50, 70]);
    expect(longer.item!.steps).toEqual(fitSteps(STEPS, { activeMinutes: 60, processingMinutes: 50, finishingMinutes: 70 }));
  });

  it("leaves each processing step free for another client, and only them", async () => {
    // 9:00 Highlight to 10:00, processing to 10:30, Gloss to 10:45, processing to 11:05, Cut to 11:50.
    expect((await book(blowoutId, at(10), [30, 0, 0])).error).toBeNull();
    expect((await book(blowoutId, at(10, 45), [20, 0, 0])).error).toBeNull();
    const overGloss = await book(blowoutId, at(10, 30), [10, 0, 0]);
    expect(overGloss.error?.code).toBe("23P01");
  });
});

describe("a visit's own steps", () => {
  it("change only through set_item_steps, by the front of house, with the calendar version", async () => {
    const { item } = await book(serviceId, at(12), [60, 50, 60]);
    const own = [busy("Highlight", 60), wait(45), busy("Cut", 45)];
    expect((await admin.from("appointment_items").update({ steps: own }).eq("id", item!.id)).error?.code).toBe("42501");
    const version = async () => (await admin.from("locations").select("calendar_version").eq("id", L).single()).data!.calendar_version;
    expect((await stylist.rpc("set_item_steps", { p_location_id: L, p_calendar_version: await version(), p_item_id: item!.id, p_steps: own })).error?.code).toBe("42501");
    expect((await frontDesk.rpc("set_item_steps", { p_location_id: L, p_calendar_version: (await version()) - 1, p_item_id: item!.id, p_steps: own })).error?.code).toBe("40001");
    expect((await frontDesk.rpc("set_item_steps", { p_location_id: L, p_calendar_version: await version(), p_item_id: item!.id, p_steps: [wait(10), busy("Cut", 10)] })).error?.hint).toBe("first_or_last");
    expect((await frontDesk.rpc("set_item_steps", { p_location_id: L, p_calendar_version: await version(), p_item_id: item!.id, p_steps: own })).error).toBeNull();
    const { data } = await admin.from("appointment_items").select("steps, active_minutes, processing_minutes, finishing_minutes").eq("id", item!.id).single();
    expect(data).toEqual({ steps: own, active_minutes: 60, processing_minutes: 45, finishing_minutes: 45 });
    // The visit ends with its new length: 12:00 plus 2 hr 30 min.
    const { data: visit } = await admin.from("appointment_items").select("ends_at, appointments(ends_at)").eq("id", item!.id).single();
    expect(new Date(visit!.ends_at).getTime()).toBe(at(14, 30).getTime());
    expect(new Date(visit!.appointments!.ends_at).getTime()).toBe(at(14, 30).getTime());
    // Moved, it keeps them.
    await admin.from("appointment_items").update({ starts_at: at(12, 30).toISOString() }).eq("id", item!.id);
    expect((await admin.from("appointment_items").select("steps").eq("id", item!.id).single()).data!.steps).toEqual(own);
  });
});
