// Service bundles: saved only through save_service_bundle by owners and
// managers, booked as their parts (each its own item, price and stylist)
// with the gaps free for the stylist, each part marked with its bundle, and
// moved together when one part is dragged.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { moveItem, saveBooking, type BookingItemInput } from "@/lib/scheduling/book";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const TZ = "America/Chicago";
const location = { id: SEED.location, timezone: TZ };
const { bridget: BRIDGET, shae: SHAE } = SEED.staff;
// A Tuesday far from the seeded month: Bridget works 9-1 and 2-6, Shae 9-1.
const DAY = "2031-07-22";
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const TAG = `Bn${Date.now().toString(36)}`;

let owner: Client;
let manager: Client;
let frontDesk: Client;
let services: Map<string, string>;
let clientId: string;
let bundleId: string;
const created: string[] = [];

const item = (service: string, staffId: string, start: Date, extra: Partial<BookingItemInput> = {}): BookingItemInput => ({
  serviceId: services.get(service)!,
  staffId,
  start,
  resource: { kind: "any" },
  ...extra,
});

async function book(items: BookingItemInput[]) {
  const result = await saveBooking(frontDesk, location, { clientId, notes: null, items });
  if (result.ok) created.push(result.appointmentId);
  return result;
}

async function itemsOf(appointmentId: string) {
  const { data } = await admin.from("appointment_items").select("id, service_id, staff_id, starts_at, ends_at, price_cents, bundle_id").eq("appointment_id", appointmentId).order("starts_at");
  return data!;
}

// The bundle booked at 9: Partial Highlights 9:00-10:50, an hour's gap, Gloss 11:50-12:40.
const bundled = () => [item("Partial Highlights", BRIDGET, at(9), { bundleId }), item("Gloss / Toner", BRIDGET, at(11, 50), { bundleId })];

beforeAll(async () => {
  [owner, manager, frontDesk] = await Promise.all([signIn("owner@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  const { data } = await admin.from("services").select("id, name").eq("business_id", B);
  services = new Map(data!.map((s) => [s.name, s.id]));
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Ava`, last_name: "Test" }).select("id").single();
  clientId = c!.id;
});

afterEach(async () => {
  if (created.length) await admin.from("appointments").delete().in("id", created.splice(0));
});

afterAll(async () => {
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("service_bundles").delete().eq("business_id", B).like("name", `${TAG}%`);
});

describe("saving a bundle", () => {
  it("is for owners and managers, through save_service_bundle, with its rules", async () => {
    const parts = [
      { service_id: services.get("Partial Highlights"), gap_minutes: 0 },
      { service_id: services.get("Gloss / Toner"), gap_minutes: 60 },
    ];
    const bundle = { name: `${TAG} Highlight and gloss`, description: "", online: true, parts };
    expect((await frontDesk.rpc("save_service_bundle", { p_business_id: B, p_bundle: bundle })).error?.code).toBe("42501");
    expect((await owner.from("service_bundles").insert({ business_id: B, name: `${TAG} Direct` })).error).not.toBeNull();
    expect((await manager.rpc("save_service_bundle", { p_business_id: B, p_bundle: { ...bundle, parts: parts.slice(0, 1) } })).error?.hint).toBe("parts");
    expect((await manager.rpc("save_service_bundle", { p_business_id: B, p_bundle: { ...bundle, parts: [parts[0], { ...parts[1], gap_minutes: 7 }] } })).error?.hint).toBe("gap");
    const saved = await owner.rpc("save_service_bundle", { p_business_id: B, p_bundle: bundle });
    expect(saved.error).toBeNull();
    bundleId = saved.data!;
    const { data } = await frontDesk.from("service_bundle_parts").select("position, gap_minutes").eq("bundle_id", bundleId).order("position");
    expect(data).toEqual([
      { position: 0, gap_minutes: 0 },
      { position: 1, gap_minutes: 60 },
    ]);
  });
});

describe("booking a bundle", () => {
  it("books each part as its own item and price, marked with the bundle, with the gap free for the stylist", async () => {
    const result = await book(bundled());
    expect(result.ok).toBe(true);
    const items = await itemsOf((result as { appointmentId: string }).appointmentId);
    expect(items.map((i) => i.bundle_id)).toEqual([bundleId, bundleId]);
    expect(items.every((i) => i.price_cents > 0)).toBe(true);
    // Another client in the gap.
    expect((await book([item("Blowout", BRIDGET, at(10, 55))])).ok).toBe(true);
  });

  it("can't be marked with another salon's bundle or one that doesn't exist", async () => {
    const result = await book([item("Blowout", BRIDGET, at(9), { bundleId: crypto.randomUUID() })]);
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("moves together when one part is moved, its stylist's parts with it", async () => {
    const result = await book(bundled());
    const id = (result as { appointmentId: string }).appointmentId;
    const [first] = await itemsOf(id);
    expect((await moveItem(frontDesk, location, { itemId: first.id, staffId: BRIDGET, start: at(9, 15) })).ok).toBe(true);
    const moved = await itemsOf(id);
    expect(moved.map((i) => new Date(i.starts_at).getTime())).toEqual([at(9, 15).getTime(), at(12, 5).getTime()]);
    const { data: visit } = await admin.from("appointments").select("starts_at, ends_at").eq("id", id).single();
    expect(new Date(visit!.ends_at).getTime()).toBe(at(12, 55).getTime());
  });

  it("lets one part change, keeping the rest in the bundle", async () => {
    const result = await book(bundled());
    const id = (result as { appointmentId: string }).appointmentId;
    const [first, second] = await itemsOf(id);
    // The gloss goes to Shae, 30 minutes earlier (a shorter gap).
    const edit = await saveBooking(frontDesk, location, {
      appointmentId: id,
      clientId,
      notes: null,
      items: [
        { id: first.id, serviceId: first.service_id, staffId: BRIDGET, start: new Date(first.starts_at), resource: { kind: "any" }, bundleId },
        { id: second.id, serviceId: second.service_id, staffId: SHAE, start: at(11, 20), resource: { kind: "any" }, bundleId },
      ],
    });
    expect(edit.ok).toBe(true);
    const after = await itemsOf(id);
    expect(after.map((i) => [i.staff_id, i.bundle_id])).toEqual([
      [BRIDGET, bundleId],
      [SHAE, bundleId],
    ]);
    // Saved without saying, a part keeps its bundle.
    await moveItem(frontDesk, location, { itemId: second.id, staffId: SHAE, start: at(11, 25) });
    expect((await itemsOf(id)).map((i) => i.bundle_id)).toEqual([bundleId, bundleId]);
  });
});
