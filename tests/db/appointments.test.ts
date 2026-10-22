// Resources, appointments and appointment items: RLS, constraints, and the
// seeded month checked against the booking rules.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  checkItem,
  dayView,
  datesBetween,
  describeProblem,
  intersectIntervals,
  itemEnd,
  mergeIntervals,
  toLocal,
  type BookingContext,
} from "@/lib/scheduling";
import { loadBookingContext } from "@/lib/scheduling/load";
import { admin, anon, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const location = { id: L, timezone: TZ };
const { bridget: BRIDGET, shae: SHAE } = SEED.staff;
const CHAIR_1 = "f0000000-0000-4000-8000-000000000001";
const STYLISTS = [SEED.staff.bridget, SEED.staff.gil, SEED.staff.hannah, SEED.staff.nola, SEED.staff.sandra, SHAE];

// The seeded month, found from the data: it's relative to the last reset,
// which may not be today.
let seedFrom: string;
let seedTo: string;

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let manager: Client;
let frontDesk: Client;
let bridget: Client;
let otherOwner: Client;

// Appointments created by a test, removed afterwards.
const created: string[] = [];

async function serviceByName(name: string) {
  const { data } = await admin
    .from("services")
    .select("id, active_minutes, processing_minutes, finishing_minutes, duration_minutes, price_cents")
    .eq("business_id", B)
    .eq("name", name)
    .single();
  return data!;
}

// A far-future time, clear of the seeded month.
function farFuture(hour: number, minute = 0) {
  const d = new Date(Date.UTC(2031, 5, 3, hour + 5, minute)); // Tue Jun 3 2031, Chicago is UTC-5
  return d;
}

function appointmentRow(start: Date, minutes: number, extra: Record<string, unknown> = {}) {
  return {
    business_id: B,
    location_id: L,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
    ...extra,
  };
}

async function itemRow(appointmentId: string, serviceName: string, staffId: string, start: Date, resourceId: string | null = null) {
  const s = await serviceByName(serviceName);
  return {
    business_id: B,
    location_id: L,
    appointment_id: appointmentId,
    service_id: s.id,
    staff_id: staffId,
    resource_id: resourceId,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + s.duration_minutes! * 60_000).toISOString(),
    active_minutes: s.active_minutes,
    processing_minutes: s.processing_minutes,
    finishing_minutes: s.finishing_minutes,
    price_cents: s.price_cents,
  };
}

async function newAppointment(start = farFuture(10), minutes = 60) {
  const { data, error } = await admin.from("appointments").insert(appointmentRow(start, minutes)).select("id").single();
  if (error) throw error;
  created.push(data.id);
  return data.id;
}

beforeAll(async () => {
  other = await createOtherSalon();
  [manager, frontDesk, bridget, otherOwner] = await Promise.all([
    signIn("manager@mapleandash.test"),
    signIn("frontdesk@mapleandash.test"),
    signIn("bridget@mapleandash.test"),
    signIn(other.email),
  ]);
});

afterEach(async () => {
  if (created.length) await admin.from("appointments").delete().in("id", created.splice(0));
});

afterAll(async () => {
  await other?.cleanup();
});

// ---------------------------------------------------------------------------

describe("seed data", () => {
  let ctx: BookingContext;
  beforeAll(async () => {
    // The seeded month: the app only books in person (source front_desk),
    // so online and phone bookings all come from the seed.
    const bounds = (ascending: boolean) =>
      admin
        .from("appointments")
        .select("starts_at")
        .eq("business_id", B)
        .in("source", ["online", "phone"])
        .order("starts_at", { ascending })
        .limit(1)
        .single();
    const [first, last] = await Promise.all([bounds(true), bounds(false)]);
    seedFrom = toLocal(new Date(first.data!.starts_at), TZ).date;
    seedTo = toLocal(new Date(last.data!.starts_at), TZ).date;
    ctx = await loadBookingContext(admin, location, seedFrom, seedTo);
  });

  it("has chairs, a barber station and a treatment room", async () => {
    const { data } = await admin.from("resources").select("name, kind").eq("location_id", L).order("sort_order");
    expect(data!.map((r) => r.name)).toEqual([
      "Chair 1", "Chair 2", "Chair 3", "Chair 4", "Chair 5", "Chair 6", "Chair 7", "Barber Station", "Treatment Room",
    ]);
    expect(new Set(data!.map((r) => r.kind))).toEqual(new Set(["chair", "station", "room"]));
  });

  it("has a month of appointments with a realistic mix of statuses", async () => {
    const { data } = await admin.from("appointments").select("status, starts_at").eq("business_id", B);
    const dates = data!.map((a) => toLocal(new Date(a.starts_at), TZ).date).sort();
    // About a month, around the reset date.
    expect(datesBetween(dates[0], dates.at(-1)!).length).toBeGreaterThanOrEqual(28);
    expect(data!.length).toBeGreaterThan(600);

    const statuses = new Set(data!.map((a) => a.status));
    for (const s of ["completed", "canceled", "no_show", "booked", "confirmed"] as const) expect(statuses).toContain(s);
    // Nothing upcoming is completed; nothing past is still booked.
    const now = Date.now();
    for (const a of data!) {
      if (new Date(a.starts_at).getTime() > now) expect(["booked", "confirmed", "canceled"]).toContain(a.status);
    }
  });

  // Clients come back on their own cycles, so the salon isn't full.
  it("fills about 60% of the stylists' bookable time", () => {
    let available = 0;
    let booked = 0;
    for (const staffId of STYLISTS) {
      const staff = ctx.staff.get(staffId)!;
      for (const date of datesBetween(seedFrom, seedTo)) {
        const open = dayView(staff.schedule, ctx.location, date).available;
        const covered = ctx.booked
          .filter((i) => i.staffId === staffId && toLocal(i.start, TZ).date === date)
          .map((i) => {
            const start = toLocal(i.start, TZ).minute;
            return { start, end: start + (itemEnd(i).getTime() - i.start.getTime()) / 60_000 };
          });
        available += open.reduce((sum, i) => sum + i.end - i.start, 0);
        booked += intersectIntervals(mergeIntervals(covered), open).reduce((sum, i) => sum + i.end - i.start, 0);
      }
    }
    const utilization = booked / available;
    expect(utilization).toBeGreaterThan(0.5);
    expect(utilization).toBeLessThan(0.72);
  });

  it("includes visits with several stylists, and clients booked into processing gaps", () => {
    const byAppointment = new Map<string, Set<string>>();
    for (const i of ctx.booked) byAppointment.set(i.appointmentId!, (byAppointment.get(i.appointmentId!) ?? new Set()).add(i.staffId));
    expect([...byAppointment.values()].filter((s) => s.size > 1).length).toBeGreaterThan(20);

    const gapFills = ctx.booked.filter((i) =>
      ctx.booked.some(
        (o) =>
          o !== i &&
          o.staffId === i.staffId &&
          o.processingMinutes > 0 &&
          i.start.getTime() >= o.start.getTime() + o.activeMinutes * 60_000 &&
          i.start.getTime() < o.start.getTime() + (o.activeMinutes + o.processingMinutes) * 60_000,
      ),
    );
    expect(gapFills.length).toBeGreaterThan(20);
  });

  it("follows every booking rule", () => {
    const failures: string[] = [];
    for (const item of ctx.booked) {
      const result = checkItem(ctx, item);
      if (!result.valid) failures.push(`${item.id}: ${result.problems.map(describeProblem).join(" ")}`);
    }
    expect(ctx.booked.length).toBeGreaterThan(600);
    expect(failures).toEqual([]);
  });

  it("keeps each appointment's span equal to its items'", async () => {
    const { data } = await admin.from("appointments").select("starts_at, ends_at, appointment_items(starts_at, ends_at)").eq("business_id", B);
    for (const a of data!) {
      const starts = a.appointment_items.map((i) => new Date(i.starts_at).getTime());
      const ends = a.appointment_items.map((i) => new Date(i.ends_at).getTime());
      expect(new Date(a.starts_at).getTime()).toBe(Math.min(...starts));
      expect(new Date(a.ends_at).getTime()).toBe(Math.max(...ends));
    }
  });
});

describe("appointment span", () => {
  it("follows items as they're added, moved and removed", async () => {
    const id = await newAppointment(farFuture(10), 15);
    const color = await itemRow(id, "All-Over Color", BRIDGET, farFuture(10), CHAIR_1);
    const { data: first } = await admin.from("appointment_items").insert(color).select("id").single();
    const blowout = await itemRow(id, "Blowout", SHAE, farFuture(11, 45));
    const { data: second } = await admin.from("appointment_items").insert(blowout).select("id").single();

    const span = async () => (await admin.from("appointments").select("starts_at, ends_at").eq("id", id).single()).data!;
    expect(await span()).toEqual({ starts_at: "2031-06-03T15:00:00+00:00", ends_at: "2031-06-03T17:30:00+00:00" });

    await admin.from("appointment_items").delete().eq("id", second!.id);
    expect(await span()).toEqual({ starts_at: "2031-06-03T15:00:00+00:00", ends_at: "2031-06-03T16:45:00+00:00" });

    const later = new Date(farFuture(13).getTime());
    await admin
      .from("appointment_items")
      .update({ starts_at: later.toISOString(), ends_at: new Date(later.getTime() + 105 * 60_000).toISOString() })
      .eq("id", first!.id);
    expect(await span()).toEqual({ starts_at: "2031-06-03T18:00:00+00:00", ends_at: "2031-06-03T19:45:00+00:00" });
  });
});

describe("constraints", () => {
  it("requires an item's end to match its timing", async () => {
    const id = await newAppointment();
    const row = await itemRow(id, "Women's Cut & Style", BRIDGET, farFuture(10));
    const { error } = await admin.from("appointment_items").insert({ ...row, ends_at: farFuture(10, 45).toISOString() });
    expect(error?.code).toBe("23514");
  });

  it("only allows resources at the appointment's location", async () => {
    const { data: room } = await admin
      .from("resources")
      .insert({ business_id: other.businessId, location_id: other.locationId, name: "Their chair", kind: "chair" })
      .select("id")
      .single();
    const id = await newAppointment();
    const row = await itemRow(id, "Women's Cut & Style", BRIDGET, farFuture(10), room!.id);
    const { error } = await admin.from("appointment_items").insert(row);
    expect(error?.code).toBe("23503");
  });

  it("only allows clients, staff and services from the same business", async () => {
    const { data: theirClient } = await admin.from("clients").insert({ business_id: other.businessId, first_name: "Theirs" }).select("id").single();
    const { error: clientError } = await admin.from("appointments").insert(appointmentRow(farFuture(10), 60, { client_id: theirClient!.id }));
    expect(clientError?.code).toBe("23503");

    const id = await newAppointment();
    const row = await itemRow(id, "Women's Cut & Style", BRIDGET, farFuture(10));
    const { error: staffError } = await admin.from("appointment_items").insert({ ...row, staff_id: other.staffId });
    expect(staffError?.code).toBe("23503");
  });

  it("records when an appointment was canceled", async () => {
    const id = await newAppointment();
    const { error } = await admin.from("appointments").update({ status: "canceled" }).eq("id", id);
    expect(error?.code).toBe("23514");
    const { error: ok } = await admin.from("appointments").update({ status: "canceled", canceled_at: new Date().toISOString() }).eq("id", id);
    expect(ok).toBeNull();
  });
});

describe("row level security", () => {
  it("lets every member read the calendar", async () => {
    for (const client of [bridget, frontDesk, manager]) {
      const appointments = await client.from("appointments").select("id", { count: "exact", head: true });
      const items = await client.from("appointment_items").select("id", { count: "exact", head: true });
      const resources = await client.from("resources").select("id", { count: "exact", head: true });
      expect(appointments.count).toBeGreaterThan(600);
      expect(items.count).toBeGreaterThan(600);
      expect(resources.count).toBe(9);
    }
  });

  it("hides the calendar from other salons and signed-out users", async () => {
    for (const client of [otherOwner, anon]) {
      for (const table of ["appointments", "appointment_items", "resources"] as const) {
        const { data } = await client.from(table).select("id").eq("business_id", B);
        expect(data).toEqual([]);
      }
    }
  });

  it("refuses direct writes from everyone: changes go through the booking functions", async () => {
    const id = await newAppointment();
    const row = await itemRow(id, "Women's Cut & Style", BRIDGET, farFuture(10), CHAIR_1);
    for (const client of [frontDesk, manager, bridget, otherOwner]) {
      const { error } = await client.from("appointments").insert(appointmentRow(farFuture(10), 60));
      expect(error?.code).toBe("42501");
      const { error: itemError } = await client.from("appointment_items").insert(row);
      expect(itemError?.code).toBe("42501");
      const { data: updated } = await client.from("appointments").update({ notes: "x" }).eq("id", id).select("id");
      expect(updated).toEqual([]);
      const { data: deleted } = await client.from("appointments").delete().eq("id", id).select("id");
      expect(deleted).toEqual([]);
    }
  });

  it("lets owners and managers manage resources, not front desk", async () => {
    const { error: deskError } = await frontDesk.from("resources").insert({ business_id: B, location_id: L, name: "Desk chair", kind: "chair" });
    expect(deskError?.code).toBe("42501");

    const { data, error } = await manager.from("resources").insert({ business_id: B, location_id: L, name: "Chair 8", kind: "chair" }).select("id").single();
    expect(error).toBeNull();
    const { data: updated } = await manager.from("resources").update({ is_active: false }).eq("id", data!.id).select("is_active");
    expect(updated).toEqual([{ is_active: false }]);
    await manager.from("resources").delete().eq("id", data!.id);
    const { count } = await admin.from("resources").select("id", { count: "exact", head: true }).eq("id", data!.id);
    expect(count).toBe(0);
  });
});
