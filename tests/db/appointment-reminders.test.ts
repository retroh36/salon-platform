// Appointment reminders: one per visit and start time, in fixed words, on
// the channel the client allows for messages about their visits, only in
// the salon's sending hours, into the outbox (held there until the salon
// goes live). Read by the front of house; written only by the sender.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runReminders } from "@/lib/reminders-run";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, SEED, signIn, throwawayStylist, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
// A Tuesday far from the seeded month, and 3pm the day before.
const DAY = "2031-08-12";
const at = (date: string, hour: number, minute = 0) => fromLocal(date, hour * 60 + minute, TZ)!;
const NOW = at("2031-08-11", 15);
const TAG = `Rm${Date.now().toString(36)}`;
// A number no seeded client has, so the outbox rows are this test's alone.
const PHONE = `(555) 555-${String(Date.now() % 10_000).padStart(4, "0")}`;

let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
let frontDesk: Client;
let bridget: Client;
let manager: Client;
let clientId: string;
let quietId: string;
let visitId: string;
let itemId: string;

async function visit(client: string, start: Date) {
  const end = new Date(start.getTime() + 45 * 60_000);
  const { data: a, error } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: client, starts_at: start.toISOString(), ends_at: end.toISOString() }).select("id").single();
  if (error) throw error;
  const { data: i, error: e } = await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a.id, service_id: (await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single()).data!.id, staff_id: stylist.id, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 45, price_cents: 4500 })
    .select("id")
    .single();
  if (e) throw e;
  return { appointmentId: a.id, itemId: i.id };
}

const outboxTo = async (address: string) => (await admin.from("outbox_messages").select("channel, body, status").eq("to_address", address).order("created_at")).data!;

beforeAll(async () => {
  [frontDesk, bridget, manager] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test"), signIn("manager@mapleandash.test")]);
  stylist = await throwawayStylist(`${TAG}Rae`);
  const { data } = await admin
    .from("clients")
    .insert([
      { business_id: B, first_name: `${TAG}Ava`, last_name: "Test", phone: PHONE },
      { business_id: B, first_name: `${TAG}Quiet`, last_name: "Test", phone: null, email: null },
    ])
    .select("id, first_name");
  clientId = data!.find((c) => c.first_name === `${TAG}Ava`)!.id;
  quietId = data!.find((c) => c.first_name === `${TAG}Quiet`)!.id;
  ({ appointmentId: visitId, itemId } = await visit(clientId, at(DAY, 11)));
  await visit(quietId, at(DAY, 12));
});

afterAll(async () => {
  await admin.from("appointments").delete().in("client_id", [clientId, quietId]);
  await admin.from("outbox_messages").delete().eq("to_address", PHONE);
  await admin.from("clients").delete().in("id", [clientId, quietId]);
  await stylist.remove();
  await admin.from("businesses").update({ reminders_on: true, reminder_hours: 24 }).eq("id", B);
});

describe("sending reminders", () => {
  it("writes one in fixed words a day before, by text, held in the outbox until the salon goes live", async () => {
    const summary = await runReminders(admin, { businessId: B, now: NOW });
    expect(summary.noChannel).toBeGreaterThanOrEqual(1);
    const sent = await outboxTo(PHONE);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "sms", status: "held" });
    expect(sent[0].body).toMatch(new RegExp(`^Maple & Ash Hair Studio: Hi ${TAG}Ava, a reminder of your visit tomorrow, Tue, Aug 12 at 11am with ${TAG}Rae\\. View, change or cancel: \\S+/book/maple-and-ash/manage/[A-Za-z0-9_-]{43} Reply STOP`));
    const { data: rows } = await admin.from("appointment_reminders").select("channel, held, outbox_id").eq("appointment_id", visitId);
    expect(rows).toEqual([{ channel: "sms", held: true, outbox_id: expect.any(String) }]);
  });

  it("never twice for the same time, and again once the visit moves", async () => {
    await runReminders(admin, { businessId: B, now: new Date(NOW.getTime() + 15 * 60_000) });
    expect(await outboxTo(PHONE)).toHaveLength(1);
    const later = at(DAY, 13);
    await admin.from("appointment_items").update({ starts_at: later.toISOString(), ends_at: new Date(later.getTime() + 45 * 60_000).toISOString() }).eq("id", itemId);
    await admin.from("appointments").update({ starts_at: later.toISOString(), ends_at: new Date(later.getTime() + 45 * 60_000).toISOString() }).eq("id", visitId);
    await runReminders(admin, { businessId: B, now: new Date(NOW.getTime() + 30 * 60_000) });
    const sent = await outboxTo(PHONE);
    expect(sent).toHaveLength(2);
    expect(sent[1].body).toContain("tomorrow, Tue, Aug 12 at 1pm");
  });

  it("waits outside the salon's sending hours, and sends nothing when the salon turns them off", async () => {
    const before = (await outboxTo(PHONE)).length;
    await admin.from("appointment_reminders").delete().eq("appointment_id", visitId);
    expect((await runReminders(admin, { businessId: B, now: at("2031-08-11", 21) })).quietHours).toBeGreaterThan(0);
    await admin.from("businesses").update({ reminders_on: false }).eq("id", B);
    expect(await runReminders(admin, { businessId: B, now: NOW })).toMatchObject({ salons: 0, sent: 0 });
    expect(await outboxTo(PHONE)).toHaveLength(before);
    await admin.from("businesses").update({ reminders_on: true }).eq("id", B);
  });
});

describe("who sees and sets them", () => {
  it("the front of house read them; stylists don't", async () => {
    await runReminders(admin, { businessId: B, now: NOW });
    expect((await frontDesk.from("appointment_reminders").select("id").eq("appointment_id", visitId)).data).toHaveLength(1);
    expect((await bridget.from("appointment_reminders").select("id").eq("appointment_id", visitId)).data).toHaveLength(0);
    expect((await frontDesk.from("appointment_reminders").insert({ business_id: B, appointment_id: visitId, starts_at: NOW.toISOString(), channel: "sms" })).error).not.toBeNull();
  });

  it("those with the settings permission choose when, from the set times", async () => {
    expect((await manager.from("businesses").update({ reminder_hours: 48 }).eq("id", B).select("id")).data).toHaveLength(1);
    expect((await manager.from("businesses").update({ reminder_hours: 30 }).eq("id", B)).error?.code).toBe("23514");
    expect((await frontDesk.from("businesses").update({ reminder_hours: 2 }).eq("id", B).select("id")).data ?? []).toHaveLength(0);
  });
});
