// Bridal and events in the database: events are written only through
// save_event (front of house), priced exactly as lib/events/pricing.ts
// does, kept to their salon (and to the stylists on them), and, once
// booked, the party changes inside the headcount cutoff only with an owner
// or manager.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memberShare, priceEvent } from "@/lib/events/pricing";
import { settingsFrom } from "@/lib/events/types";
import { admin, createOtherSalon, SEED, signIn, sql, type Client } from "./helpers";

const P = {
  bride: "ee000000-0000-4000-8000-000000000001",
  maidHair: "ee000000-0000-4000-8000-000000000002",
  maidBoth: "ee000000-0000-4000-8000-000000000003",
  trial: "ee000000-0000-4000-8000-000000000007",
};

const EMAIL = `eventtest-${crypto.randomUUID()}@example.test`;
const dayAhead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

let desk: Client;
let manager: Client;
let stylist: Client;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
const created: string[] = [];
let clientId: string;

function input(over: Record<string, unknown> = {}) {
  const date = (over.event_date as string) ?? dayAhead(120);
  return {
    title: "DB test wedding",
    client_id: clientId,
    event_date: date,
    ready_by: `${date}T19:00:00Z`,
    on_location: true,
    travel_miles: 23.4,
    travel_minutes: 30,
    billing: "main",
    members: [
      { name: "Mia", party_role: "bride", package_id: P.bride },
      { name: "Ana", party_role: "bridesmaid", package_id: P.maidBoth },
      { name: "Lu", party_role: "bridesmaid", package_id: P.maidHair },
    ],
    tasks: [
      // An early hair lane (before 7am at the salon, Chicago) and a later one.
      { member: "1", kind: "hair", role: "hair", lane: 1, staff_id: SEED.staff.bridget, starts_at: `${date}T11:30:00Z`, ends_at: `${date}T13:00:00Z` },
      { member: "2", kind: "hair", role: "hair", lane: 2, staff_id: null, starts_at: `${date}T15:00:00Z`, ends_at: `${date}T15:45:00Z` },
      { member: "3", kind: "hair", role: "hair", lane: 2, staff_id: null, starts_at: `${date}T16:00:00Z`, ends_at: `${date}T16:45:00Z` },
      { member: "1", kind: "makeup", role: "makeup", lane: 1, staff_id: SEED.staff.hannah, starts_at: `${date}T17:00:00Z`, ends_at: `${date}T18:15:00Z` },
      { member: "2", kind: "makeup", role: "makeup", lane: 1, staff_id: SEED.staff.hannah, starts_at: `${date}T16:00:00Z`, ends_at: `${date}T16:45:00Z` },
    ],
    ...over,
  };
}

async function save(client: Client, id: string | null, body: Record<string, unknown>) {
  const result = await client.rpc("save_event", { p_event_id: id!, p_input: body as never });
  if (!result.error && !id) created.push(result.data);
  return { ...result, data: result.data as string };
}

beforeAll(async () => {
  [desk, manager, stylist] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("nola@mapleandash.test")]);
  other = await createOtherSalon();
  const { data, error } = await admin.from("clients").insert({ business_id: SEED.business, first_name: "Eventtest", last_name: "Client", email: EMAIL }).select("id").single();
  if (error) throw error;
  clientId = data.id;
});

afterAll(async () => {
  if (created.length) await admin.from("events").delete().in("id", created);
  await admin.from("clients").delete().eq("id", clientId);
  await other.cleanup();
});

describe("saving an event", () => {
  it("creates an Inquiry with the party and timeline, priced like the app does it", async () => {
    const { data: id, error } = await save(desk, null, input());
    expect(error).toBeNull();
    const { data: e } = await admin.from("events").select("*, event_members(*), event_tasks(*)").eq("id", id).single();
    expect(e!.status).toBe("inquiry");
    expect(e!.event_members.map((m) => [m.name, m.package_name, m.price_cents])).toEqual(
      expect.arrayContaining([
        ["Mia", "Bride hair + makeup", 45000],
        ["Ana", "Bridesmaid hair + makeup", 22000],
        ["Lu", "Bridesmaid hair", 12000],
      ]),
    );
    expect(e!.event_tasks).toHaveLength(5);

    const [{ data: s }, { data: b }] = await Promise.all([
      admin.from("event_settings").select("*").eq("business_id", SEED.business).single(),
      admin.from("businesses").select("tax_rate_services_bp").eq("id", SEED.business).single(),
    ]);
    // Hair 1 starts at 5:30am in Chicago: one early lane.
    const expected = priceEvent(
      { members: [{ priceCents: 45000, paysOwn: false }, { priceCents: 22000, paysOwn: false }, { priceCents: 12000, paysOwn: false }], billing: "main", onLocation: true, travelMiles: 23.4, earlyLanes: 1 },
      settingsFrom(s!),
      b!.tax_rate_services_bp,
    );
    expect({
      subtotal: e!.subtotal_cents,
      travel: e!.travel_fee_cents,
      early: e!.early_fee_cents,
      charge: e!.service_charge_cents,
      tax: e!.tax_cents,
      total: e!.total_cents,
      deposit: e!.deposit_cents,
    }).toEqual({
      subtotal: expected.subtotalCents,
      travel: expected.travelFeeCents,
      early: expected.earlyFeeCents,
      charge: expected.serviceChargeCents,
      tax: expected.taxCents,
      total: expected.totalCents,
      deposit: expected.depositCents,
    });
    const { data: history } = await admin.from("event_history").select("kind, staff_id").eq("event_id", id);
    expect(history).toEqual([{ kind: "created", staff_id: SEED.staff.frontDesk }]);
  });

  it("prices split billing like the app: the deposit is on what the main client pays", async () => {
    const { data: id } = await save(desk, null, {
      ...input({ on_location: false, tasks: [] }),
      billing: "split",
      members: [
        { name: "Mia", party_role: "bride", package_id: P.bride },
        { name: "Ana", party_role: "bridesmaid", package_id: P.maidBoth, pays_own: true, phone: "312-555-0101" },
      ],
    });
    const [{ data: e }, { data: s }] = await Promise.all([admin.from("events").select("total_cents, deposit_cents").eq("id", id).single(), admin.from("event_settings").select("*").eq("business_id", SEED.business).single()]);
    const expected = priceEvent({ members: [{ priceCents: 45000, paysOwn: false }, { priceCents: 22000, paysOwn: true }], billing: "split", onLocation: false, travelMiles: 0, earlyLanes: 0 }, settingsFrom(s!), 0);
    expect(e).toEqual({ total_cents: expected.totalCents, deposit_cents: expected.depositCents });
  });

  it("works out a member's own share like the app, to the cent, never more than their exact share", async () => {
    const prices = [1, 3333, 9999, 12345, 22000, 45001];
    const rows = sql(prices.map((p) => `select private.event_member_share(${p}, 18, 1025);`).join("\n")).split("\n").map(Number);
    expect(rows).toEqual(prices.map((p) => memberShare(p, { serviceChargePct: 18 }, 1025)));
    expect(rows[1]).toBe(4274);
  });

  it("refuses a trial as a party package, a stylist without the event role, and anyone outside the front of house", async () => {
    expect((await save(desk, null, input({ members: [{ name: "Mia", party_role: "bride", package_id: P.trial }], tasks: [] }))).error?.code).toBe("22023");
    const tasks = [{ member: "1", kind: "hair", role: "hair", lane: 1, staff_id: SEED.staff.gil, starts_at: `${dayAhead(120)}T15:00:00Z`, ends_at: `${dayAhead(120)}T16:30:00Z` }];
    expect((await save(desk, null, input({ tasks }))).error?.code).toBe("22023");
    expect((await save(stylist, null, input())).error?.code).toBe("42501");
  });

  it("can't be written directly", async () => {
    const { error } = await desk.from("events").insert({ business_id: SEED.business, location_id: SEED.location, title: "x", event_date: dayAhead(10) });
    expect(error).not.toBeNull();
  });
});

describe("who sees events", () => {
  it("keeps them to the salon, and stylists to the events they're on", async () => {
    const { data: id } = await save(desk, null, input({ title: "Visibility test" }));
    const owner = await signIn(other.email);
    expect((await owner.from("events").select("id").eq("id", id)).data).toEqual([]);
    // Nola isn't on it; Bridget is.
    expect((await stylist.from("events").select("id").eq("id", id)).data).toEqual([]);
    const bridget = await signIn("bridget@mapleandash.test");
    expect((await bridget.from("events").select("id").eq("id", id)).data).toEqual([{ id }]);
    expect((await bridget.from("event_history").select("id").eq("event_id", id)).data).toEqual([]);
  });
});

describe("the headcount cutoff", () => {
  it("lets the desk change the party of a booked event until the cutoff; after it, only an owner or manager", async () => {
    const soon = dayAhead(10);
    const { data: id } = await save(desk, null, input({ event_date: soon, ready_by: `${soon}T19:00:00Z`, tasks: [] }));
    await admin.from("events").update({ status: "booked" }).eq("id", id);
    const bigger = input({ event_date: soon, ready_by: `${soon}T19:00:00Z`, tasks: [], members: [...(input().members as object[]), { name: "Zoe", party_role: "bridesmaid", package_id: P.maidHair }] });

    const refused = await save(desk, id, bigger);
    expect(refused.error).toMatchObject({ code: "42501", hint: "cutoff" });
    // Other details still change.
    expect((await save(desk, id, input({ event_date: soon, ready_by: `${soon}T19:00:00Z`, tasks: [], notes: "Parking at the back" }))).error).toBeNull();
    expect((await save(manager, id, bigger)).error).toBeNull();
    const { data: members } = await admin.from("event_members").select("id").eq("event_id", id);
    expect(members).toHaveLength(4);

    // Before the cutoff, the desk can.
    const later = dayAhead(60);
    const { data: id2 } = await save(desk, null, input({ event_date: later, ready_by: `${later}T19:00:00Z`, tasks: [] }));
    await admin.from("events").update({ status: "booked" }).eq("id", id2);
    expect((await save(desk, id2, { ...bigger, event_date: later, ready_by: `${later}T19:00:00Z` })).error).toBeNull();
  });
});

describe("online inquiries", () => {
  it("come in as Inquiries through the service role only, matched to a client", async () => {
    const date = dayAhead(200);
    const body = { kind: "wedding", first_name: "Eventtest", last_name: "Client", phone: "", email: EMAIL, event_date: date, party_size: 5, services: "hair and makeup" };
    expect((await desk.rpc("save_event_inquiry", { p_business_id: SEED.business, p_input: body })).error?.code).toBe("42501");
    const { data: id, error } = await admin.rpc("save_event_inquiry", { p_business_id: SEED.business, p_input: body });
    expect(error).toBeNull();
    created.push(id!);
    const { data: e } = await admin.from("events").select("status, source, client_id, inquiry_party_size, inquiry_services, title").eq("id", id!).single();
    expect(e).toEqual({ status: "inquiry", source: "online", client_id: clientId, inquiry_party_size: 5, inquiry_services: "hair and makeup", title: "Eventtest's wedding" });
  });
});
