// The waitlist and walk-ins: who can add them, the openings Denise finds
// when a visit is canceled, and booking both through the booking rules.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeStatus, saveBooking } from "@/lib/scheduling/book";
import { loadBookingContext } from "@/lib/scheduling/load";
import { fromLocal } from "@/lib/scheduling/time";
import { bookWaitlistEntry, bookWalkIn, walkInQueueFor } from "@/lib/waitlist-book";
import { freedOn, loadWaitlist, waitlistOpenings } from "@/lib/waitlist-load";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const location = { id: L, timezone: TZ, businessId: B };
// A Tuesday far from the seeded month.
const DAY = "2031-10-14";
const at = (h: number, m = 0) => fromLocal(DAY, h * 60 + m, TZ)!;
// Jamal works 9-5 on Tuesdays, with lunch at noon, and does men's cuts.
const { jamal: JAMAL, priya: PRIYA } = SEED.staff;

let frontDesk: Client, priya: Client, otherOwner: Client;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
let cut: string, mensCut: string;
const clients: string[] = [];

async function newClient(first: string, phone: string | null = null) {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: first, last_name: "Waitlist", phone }).select("id").single();
  clients.push(data!.id);
  return data!.id;
}

async function clear() {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(0).toISOString()).lt("starts_at", at(23).toISOString());
  await admin.from("walk_ins").delete().eq("location_id", L).gte("arrived_at", at(0).toISOString());
}

beforeAll(async () => {
  [frontDesk, priya] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("priya@mapleandash.test")]);
  other = await createOtherSalon();
  otherOwner = await signIn(other.email);
  const { data: s } = await admin.from("services").select("id, name").eq("business_id", B).in("name", ["Women's Cut & Style", "Men's Cut"]);
  cut = s!.find((x) => x.name === "Women's Cut & Style")!.id;
  mensCut = s!.find((x) => x.name === "Men's Cut")!.id;
  await clear();
});

afterAll(async () => {
  await clear();
  await admin.from("waitlist_entries").delete().in("client_id", clients);
  await admin.from("clients").delete().in("id", clients);
  await admin.from("clients").delete().eq("first_name", "Walky");
  await other.cleanup();
});

const entry = (clientId: string, more: Record<string, unknown> = {}) => ({
  business_id: B,
  location_id: L,
  client_id: clientId,
  service_ids: [mensCut],
  staff_ids: [] as string[],
  windows: [] as string[],
  created_at: new Date().toISOString(),
  from_date: "2031-10-01",
  to_date: "2031-10-31",
  ...more,
});

describe("waitlist", () => {
  it("front of house adds and updates entries; everyone in the salon sees them, no one else", async () => {
    const c = await newClient("Rls");
    expect((await priya.from("waitlist_entries").insert(entry(c))).error?.code).toBe("42501");
    const { data, error } = await frontDesk.from("waitlist_entries").insert(entry(c)).select("id").single();
    expect(error).toBeNull();
    expect((await priya.from("waitlist_entries").select("id").eq("id", data!.id)).data).toHaveLength(1);
    expect((await priya.from("waitlist_entries").update({ status: "removed" }).eq("id", data!.id).select("id")).data).toHaveLength(0);
    expect((await otherOwner.from("waitlist_entries").select("id").eq("id", data!.id)).data).toHaveLength(0);
    expect((await frontDesk.from("waitlist_entries").insert(entry(c, { windows: ["night"] }))).error?.code).toBe("23514");
    await admin.from("waitlist_entries").update({ status: "removed" }).eq("id", data!.id);
  });

  it("finds the opening a cancellation leaves and the clients who fit it, then books one", async () => {
    // Jamal: men's cuts 9-12 and 2-5, lunch 12-12:30; a 12:30 cut is canceled.
    const [a, gone] = [await newClient("Regular"), await newClient("Canceled")];
    for (const start of [9, 9.5, 10, 10.5, 11, 11.5, 14, 14.5, 15, 15.5, 16, 16.5]) {
      const r = await saveBooking(frontDesk, location, { clientId: a, notes: null, items: [{ serviceId: mensCut, staffId: JAMAL, start: at(Math.floor(start), (start % 1) * 60), resource: { kind: "none" } }] });
      expect(r.ok).toBe(true);
    }
    const canceled = await saveBooking(frontDesk, location, { clientId: gone, notes: null, items: [{ serviceId: mensCut, staffId: JAMAL, start: at(12, 30), resource: { kind: "none" } }] });
    expect(canceled.ok).toBe(true);
    await changeStatus(frontDesk, canceled.ok ? canceled.appointmentId : "", "cancel", "Client canceled");

    const [any, wantsJamal, wantsPriya, mornings] = [await newClient("Any"), await newClient("Jamal"), await newClient("Priya"), await newClient("Mornings")];
    const inserted = await admin.from("waitlist_entries").insert([
      entry(any, { created_at: "2031-09-01T12:00:00Z" }),
      entry(wantsJamal, { staff_ids: [JAMAL], created_at: "2031-09-05T12:00:00Z" }),
      entry(wantsPriya, { staff_ids: [PRIYA] }),
      entry(mornings, { windows: ["morning"] }),
    ]);
    expect(inserted.error).toBeNull();

    const freed = await freedOn(frontDesk, L, DAY, TZ);
    expect(freed).toContainEqual(expect.objectContaining({ staffId: JAMAL, start: 750 }));
    const entries = (await loadWaitlist(frontDesk, L, DAY)).filter((e) => clients.includes(e.clientId));
    const ctx = await loadBookingContext(frontDesk, location, DAY, DAY);
    const openings = waitlistOpenings(ctx, DAY, freed, entries, new Map([[JAMAL, "Jamal"]]), 0);
    const jamal = openings.find((o) => o.staffId === JAMAL)!;
    expect(jamal.headline).toBe("A 90-minute opening with Jamal at 12:30pm fits 2 people on your waitlist.");
    expect(jamal.matches.map((m) => m.clientName)).toEqual(["Jamal Waitlist", "Any Waitlist"]);

    // Book the first; they're off the waitlist and the time is taken.
    const first = jamal.matches[0];
    const booked = await bookWaitlistEntry(frontDesk, location, first.entryId, JAMAL, DAY, first.startMinute);
    expect(booked).toMatchObject({ ok: true, message: expect.stringMatching(/^Booked Jamal Waitlist with Jamal at .+\. Let Jamal know\.$/) });
    const { data: e } = await admin.from("waitlist_entries").select("status, appointment_id").eq("id", first.entryId).single();
    expect(e).toEqual({ status: "booked", appointment_id: booked.ok ? booked.appointmentId : null });
    const again = await bookWaitlistEntry(frontDesk, location, jamal.matches[1].entryId, JAMAL, DAY, first.startMinute);
    expect(again).toMatchObject({ ok: false, message: expect.stringContaining("That time doesn't work any more") });
  });
});

describe("walk-ins", () => {
  it("queue in order, each with the next free stylist, and book in one click", async () => {
    await clear();
    // Everyone but Priya is busy all day; Priya is free from 11.
    const { data: staff } = await admin.from("staff").select("id").eq("location_id", L).eq("is_active", true);
    const blocker = await newClient("Blocker");
    for (const s of staff!) {
      const until = s.id === PRIYA ? 11 : 19;
      for (let h = 9; h < until; h++) {
        await saveBooking(frontDesk, location, { clientId: blocker, notes: null, items: [{ serviceId: cut, staffId: s.id, start: at(h), resource: { kind: "none" } }] });
      }
    }
    const now = at(10, 2);
    expect((await priya.from("walk_ins").insert({ business_id: B, location_id: L, name: "Nope", service_id: cut })).error?.code).toBe("42501");
    await admin.from("walk_ins").insert([
      { business_id: B, location_id: L, name: "Walky First", phone: "(999) 555-0111", service_id: cut, arrived_at: at(10).toISOString() },
      { business_id: B, location_id: L, name: "Walky Second", service_id: cut, arrived_at: at(10, 1).toISOString() },
    ]);
    const queue = await walkInQueueFor(frontDesk, location, DAY, now);
    expect(queue.map((w) => [w.name, w.estimate?.staffId, w.estimate?.start, w.estimate?.wait])).toEqual([
      ["Walky First", PRIYA, 660, 58],
      ["Walky Second", PRIYA, 720, 118],
    ]);

    const booked = await bookWalkIn(frontDesk, location, queue[0].id, DAY, now);
    expect(booked).toMatchObject({ ok: true, message: "Booked Walky First with Priya at 11am." });
    const { data: w } = await admin.from("walk_ins").select("status, client:clients(first_name, last_name, phone)").eq("id", queue[0].id).single();
    expect(w).toEqual({ status: "booked", client: { first_name: "Walky", last_name: "First", phone: "(999) 555-0111" } });
    expect((await walkInQueueFor(frontDesk, location, DAY, now)).map((x) => [x.name, x.estimate?.start])).toEqual([["Walky Second", 720]]);
  });
});
