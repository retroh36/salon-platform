// The policy check on every booking (migration …_service_deposits_everywhere.sql,
// lib/booking-policy.ts): a service's own deposit is recorded on a visit
// however it's booked, follows its services while it's still to come, and
// the check staff see before booking says what the policy asks.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { policyForBooking, policyNeedFor } from "@/lib/booking-policy";
import { admin, type Client, SEED, signIn, throwawayStylist } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TAG = `Dep${Date.now().toString(36)}`;
const HOUR = 3_600_000;

let frontDesk: Client;
let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
const clients: string[] = [];
const service: Record<string, string> = {};

async function client() {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Ivy`, last_name: "Test", phone: "3125550199" }).select("id").single();
  clients.push(data!.id);
  return data!.id;
}

let hours = 72;
async function visit(clientId: string, serviceName: string, priceCents: number, imported = false) {
  // Each its own time: the stylist can't be double-booked.
  hours += 2;
  const start = new Date(Date.now() + hours * HOUR);
  start.setUTCSeconds(0, 0);
  const end = new Date(start.getTime() + HOUR);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString() }).select("id").single();
  const { data: item } = await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: service[serviceName], staff_id: stylist.id, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: priceCents, imported })
    .select("id")
    .single();
  return { id: a!.id, itemId: item!.id };
}

const depositOf = async (id: string) => (await admin.from("appointments").select("deposit_cents").eq("id", id).single()).data!.deposit_cents;

beforeAll(async () => {
  frontDesk = await signIn("frontdesk@mapleandash.test");
  stylist = await throwawayStylist(`${TAG}Sty`);
  const { data } = await admin.from("services").select("id, name").eq("business_id", B).in("name", ["Balayage", "Double Process (Bleach & Tone)", "Women's Cut & Style"]);
  for (const s of data!) service[s.name] = s.id;
});

afterAll(async () => {
  await admin.from("appointments").delete().in("client_id", clients);
  await admin.from("clients").delete().in("id", clients);
  await stylist.remove();
});

describe("service deposits on every booking", () => {
  it("records the services' deposit on a visit booked at the desk, and follows its services", async () => {
    const c = await client();
    const v = await visit(c, "Balayage", 24000);
    expect(await depositOf(v.id)).toBe(6000); // 25%
    await admin.from("appointment_items").update({ service_id: service["Double Process (Bleach & Tone)"], price_cents: 3000 }).eq("id", v.itemId);
    expect(await depositOf(v.id)).toBe(3000); // a fixed $50, never more than the price
    await admin.from("appointment_items").update({ service_id: service["Women's Cut & Style"] }).eq("id", v.itemId);
    expect(await depositOf(v.id)).toBe(0);
  });

  it("leaves imported visits and visits no longer to come as they are", async () => {
    const c = await client();
    expect(await depositOf((await visit(c, "Balayage", 24000, true)).id)).toBe(0);
    const v = await visit(c, "Women's Cut & Style", 10000);
    await admin.from("appointments").update({ status: "canceled", canceled_at: new Date().toISOString() }).eq("id", v.id);
    await admin.from("appointment_items").update({ service_id: service.Balayage }).eq("id", v.itemId);
    expect(await depositOf(v.id)).toBe(0);
  });
});

describe("the check before booking", () => {
  it("asks a new client for a card (the demo's rule) and for a service's deposit", async () => {
    const c = await client();
    const cut = await policyForBooking(frontDesk, B, "front_desk", c, [{ serviceId: service["Women's Cut & Style"], staffId: stylist.id, priceCents: 10000 }]);
    expect(cut).toMatchObject({ cardNeeded: true, depositCents: 0, cardLabel: null, phone: "3125550199" });
    const color = await policyForBooking(frontDesk, B, "front_desk", c, [{ serviceId: service.Balayage, staffId: stylist.id, priceCents: 24000 }]);
    expect(color).toMatchObject({ cardNeeded: true, depositCents: 6000 });
  });

  it("says what a booked visit still needs", async () => {
    const c = await client();
    const v = await visit(c, "Balayage", 24000);
    expect(await policyNeedFor(frontDesk, B, "front_desk", v.id)).toBe("Deposit needed: $60");
    const cut = await visit(c, "Women's Cut & Style", 10000);
    expect(await policyNeedFor(frontDesk, B, "front_desk", cut.id)).toBe("Card needed to hold this booking");
  });
});
