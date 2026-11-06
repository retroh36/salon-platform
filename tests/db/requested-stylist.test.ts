// A client who asked for their stylist (appointment_items.requested_staff_id):
// marked per service at booking, kept by edits that don't say, belonging to
// that stylist (a service moved to someone else isn't requested there, and
// is again once moved back), and loaded for Denise's fixes, with clients
// who only see their preferred stylist counted as asking.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { moveItem, saveBooking, type BookingItemInput } from "@/lib/scheduling/book";
import { loadBookedItems } from "@/lib/scheduling/load";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const TZ = "America/Chicago";
const location = { id: SEED.location, timezone: TZ };
const { bridget: BRIDGET, hannah: HANNAH } = SEED.staff;
// A Tuesday far from the seeded month, when Bridget and Hannah both work.
const DAY = "2031-07-22";
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const TAG = `Rq${Date.now().toString(36)}`;

let frontDesk: Client;
let blowout: string;
let clientId: string;
const created: string[] = [];

const item = (staffId: string, start: Date, extra: Partial<BookingItemInput> = {}): BookingItemInput => ({ serviceId: blowout, staffId, start, resource: { kind: "any" }, ...extra });

async function book(items: BookingItemInput[]) {
  const result = await saveBooking(frontDesk, location, { clientId, notes: null, items });
  if (!result.ok) throw new Error(JSON.stringify(result));
  created.push(result.appointmentId);
  return result.appointmentId;
}

const itemOf = async (appointmentId: string) => (await admin.from("appointment_items").select("id, staff_id, requested_staff_id").eq("appointment_id", appointmentId).single()).data!;
const loaded = async (itemId: string) => (await loadBookedItems(frontDesk, location, DAY, DAY)).find((b) => b.id === itemId);

beforeAll(async () => {
  frontDesk = await signIn("frontdesk@mapleandash.test");
  blowout = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single()).data!.id;
  clientId = (await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Ava`, last_name: "Test" }).select("id").single()).data!.id;
});

afterEach(async () => {
  if (created.length) await admin.from("appointments").delete().in("id", created.splice(0));
  await admin.from("clients").update({ preferred_staff_id: null, only_sees_preferred: false }).eq("id", clientId);
});

afterAll(async () => {
  await admin.from("clients").delete().eq("id", clientId);
});

describe("a requested stylist", () => {
  it("is marked at booking, kept by an edit that doesn't say, and cleared by one that does", async () => {
    const id = await book([item(BRIDGET, at(10), { requested: true })]);
    const first = await itemOf(id);
    expect(first.requested_staff_id).toBe(BRIDGET);
    expect((await loaded(first.id))?.requested).toBe(true);

    await saveBooking(frontDesk, location, { appointmentId: id, clientId, notes: "edited", items: [item(BRIDGET, at(10, 15), { id: first.id })] });
    expect((await itemOf(id)).requested_staff_id).toBe(BRIDGET);

    await saveBooking(frontDesk, location, { appointmentId: id, clientId, notes: null, items: [item(BRIDGET, at(10, 15), { id: first.id, requested: false })] });
    expect((await itemOf(id)).requested_staff_id).toBeNull();
    expect((await loaded(first.id))?.requested).toBeUndefined();
  });

  it("belongs to the stylist asked for: moved to someone else it isn't requested, moved back it is", async () => {
    const id = await book([item(BRIDGET, at(14), { requested: true })]);
    const { id: itemId } = await itemOf(id);
    const moved = await moveItem(frontDesk, location, { itemId, staffId: HANNAH, start: at(14), anyway: true });
    expect(moved).toMatchObject({ ok: true });
    expect(await itemOf(id)).toMatchObject({ staff_id: HANNAH, requested_staff_id: BRIDGET });
    expect((await loaded(itemId))?.requested).toBeUndefined();
    expect((await moveItem(frontDesk, location, { itemId, staffId: BRIDGET, start: at(14), anyway: true })).ok).toBe(true);
    expect((await loaded(itemId))?.requested).toBe(true);
  });

  it("counts a client who only sees their preferred stylist as asking, with that stylist only", async () => {
    const id = await book([item(BRIDGET, at(11))]);
    const { id: itemId } = await itemOf(id);
    expect((await loaded(itemId))?.requested).toBeUndefined();
    await admin.from("clients").update({ preferred_staff_id: BRIDGET, only_sees_preferred: true }).eq("id", clientId);
    expect((await loaded(itemId))?.requested).toBe(true);
    await admin.from("clients").update({ preferred_staff_id: HANNAH }).eq("id", clientId);
    expect((await loaded(itemId))?.requested).toBeUndefined();
  });
});
