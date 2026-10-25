// The database refuses a double-booking whatever writes it: here, straight
// into the tables with the service role, as a path that skipped the booking
// rules would. A stylist's busy time (not processing) and a chair's whole
// item are each held once; canceled and no-show visits hold nothing;
// imported clashes stay for Denise until one is moved.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, SEED } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, shae: SHAE } = SEED.staff;
const CHAIR = "f0000000-0000-4000-8000-000000000001";
// A Tuesday far from the seeded month.
const DAY = "2031-07-08";
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const TAG = `Nd${Date.now().toString(36)}`;

let clientId: string;
let serviceId: string;

beforeAll(async () => {
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Ava`, last_name: "Test" }).select("id").single();
  clientId = c!.id;
  serviceId = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single()).data!.id;
});

afterAll(async () => {
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
});

// A visit with one item: `active` minutes, then processing, then finishing.
async function book(staffId: string, start: Date, opts: { active?: number; processing?: number; finishing?: number; resourceId?: string | null; imported?: boolean } = {}) {
  const [active, processing, finishing] = [opts.active ?? 60, opts.processing ?? 0, opts.finishing ?? 0];
  const end = new Date(start.getTime() + (active + processing + finishing) * 60_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString() }).select("id").single();
  const { data: item, error } = await admin
    .from("appointment_items")
    .insert({
      business_id: B,
      location_id: L,
      appointment_id: a!.id,
      service_id: serviceId,
      staff_id: staffId,
      resource_id: opts.resourceId ?? null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      active_minutes: active,
      processing_minutes: processing,
      finishing_minutes: finishing,
      price_cents: 5000,
      imported: opts.imported ?? false,
    })
    .select("id")
    .maybeSingle();
  return { appointmentId: a!.id, itemId: item?.id ?? null, error };
}

describe("the database's own booking rules", () => {
  it("never puts a stylist with two clients at once, but lets one sit in another's processing time", async () => {
    // 9:00 color: 30 on, 45 processing, 30 finishing (busy 9:00–9:30 and 10:15–10:45).
    expect((await book(BRIDGET, at(9), { active: 30, processing: 45, finishing: 30 })).error).toBeNull();
    const clash = await book(BRIDGET, at(9, 15), { active: 30 });
    expect(clash.error?.code).toBe("23P01");
    expect(clash.error?.message).toContain("appointment_items_no_double_booking");
    // In the gap: 9:30–10:15.
    expect((await book(BRIDGET, at(9, 30), { active: 45 })).error).toBeNull();
    // Another stylist at the same time is fine.
    expect((await book(SHAE, at(9, 15), { active: 30 })).error).toBeNull();
  });

  it("never seats two clients in one chair, processing included", async () => {
    expect((await book(SHAE, at(13), { active: 30, processing: 30, finishing: 0, resourceId: CHAIR })).error).toBeNull();
    // Bridget is free, but the chair is still taken while the color processes.
    const taken = await book(BRIDGET, at(13, 40), { active: 30, resourceId: CHAIR });
    expect(taken.error?.code).toBe("23P01");
    expect(taken.error?.message).toContain("appointment_items_no_double_resource");
  });

  it("frees the time when a visit is canceled, and won't bring it back over someone else", async () => {
    const first = await book(BRIDGET, at(15));
    expect((await admin.from("appointments").update({ status: "canceled", canceled_at: new Date().toISOString() }).eq("id", first.appointmentId)).error).toBeNull();
    expect((await book(BRIDGET, at(15))).error).toBeNull();
    // Putting the canceled one back would double-book Bridget.
    const { error } = await admin.from("appointments").update({ status: "booked", canceled_at: null }).eq("id", first.appointmentId);
    expect(error?.code).toBe("23P01");
  });

  it("keeps an imported clash for Denise to fix, and checks it once it's moved", async () => {
    expect((await book(BRIDGET, at(17), { imported: true })).error).toBeNull();
    const second = await book(BRIDGET, at(17, 30), { imported: true });
    expect(second.error).toBeNull();
    // Moved, it's checked from then on (the imported one it still overlaps
    // is Denise's to fix): nobody new can be booked over it.
    expect((await admin.from("appointment_items").update({ starts_at: at(17, 15).toISOString(), ends_at: at(18, 15).toISOString() }).eq("id", second.itemId!)).error).toBeNull();
    expect((await book(BRIDGET, at(18))).error?.code).toBe("23P01");
  });
});
