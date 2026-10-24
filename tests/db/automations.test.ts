// Automations in the database, in a salon of our own (so the demo's
// clients aren't messaged): who gets what (consent, what's booked, once
// per occasion), sending hours, the outbox, opting out, results, owners'
// settings, and Denise's suggestions through the AI action log.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_AUTOMATIONS } from "@/lib/automations";
import { loadAutomationResults } from "@/lib/automations-load";
import { runAutomations } from "@/lib/automations-run";
import { fromLocal, todayIn } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const TZ = "America/New_York";
const today = todayIn(TZ);
// 3pm at the salon: sending hours.
const NOW = fromLocal(today, 15 * 60, TZ)!;
const [, month, day] = today.split("-").map(Number);

let salon: Awaited<ReturnType<typeof createOtherSalon>>;
let owner: Client;
const ids: Record<string, string> = {};

async function client(name: string, over: Record<string, unknown>, insight: Record<string, unknown> | null) {
  const { data } = await admin
    .from("clients")
    .insert({ business_id: salon.businessId, first_name: name, last_name: "Test", phone: "(212) 555-0100", email: `${name.toLowerCase()}@example.com`, sms_opt_in: true, email_opt_in: true, ...over })
    .select("id")
    .single();
  ids[name] = data!.id;
  if (insight) await admin.from("insights").insert({ business_id: salon.businessId, kind: "client", key: data!.id, data: insight as never });
  return data!.id;
}

const overdue = { due: "overdue", overdueDays: 10, nextDue: new Date(NOW.getTime() - 10 * 86_400_000).toISOString(), lastVisit: new Date(NOW.getTime() - 52 * 86_400_000).toISOString(), preferredStaffId: null };

beforeAll(async () => {
  salon = await createOtherSalon();
  owner = await signIn(salon.email);
  await admin.from("businesses").update({ slug: `auto-${Date.now().toString(36)}`, google_review_url: "https://g.page/r/test/review" }).eq("id", salon.businessId);
  await admin.from("online_booking_settings").upsert({ business_id: salon.businessId, enabled: true });
  for (const kind of ["rebook", "win_back", "birthday", "review"] as const) {
    const d = DEFAULT_AUTOMATIONS[kind];
    const { error } = await owner.rpc("save_automation", {
      p_business_id: salon.businessId,
      p_kind: kind,
      p_input: { enabled: true, subject: d.subject, body: d.body, settings: kind === "birthday" ? { ...d.settings, offer: "Enjoy 15% off this month." } : d.settings } as never,
    });
    expect(error).toBeNull();
  }
  // Due a rebook reminder (texts first); the same but booked; the same but
  // no consent; away 20 weeks (win-back, email first); a birthday today.
  await client("Rae", {}, overdue);
  const booked = await client("Bob", {}, overdue);
  await client("Nia", { sms_opt_in: false, email_opt_in: false }, overdue);
  await client("Wes", { sms_opt_in: false }, { ...overdue, due: "lapsed", lastVisit: new Date(NOW.getTime() - 140 * 86_400_000).toISOString() });
  await client("Bea", { birth_month: month, birth_day: day }, null);
  const reviewed = await client("Rev", {}, null);
  const start = new Date(NOW.getTime() + 2 * 86_400_000);
  await admin.from("appointments").insert({ business_id: salon.businessId, location_id: salon.locationId, client_id: booked, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString(), created_at: new Date(NOW.getTime() - 7 * 86_400_000).toISOString() });
  // Checked out three and a half hours ago, and half an hour ago.
  for (const [hoursAgo, who] of [[3.5, reviewed], [0.5, ids.Rae]] as const) {
    const s = new Date(NOW.getTime() - (hoursAgo + 1) * 3_600_000);
    await admin.from("appointments").insert({
      business_id: salon.businessId,
      location_id: salon.locationId,
      client_id: who,
      starts_at: s.toISOString(),
      ends_at: new Date(s.getTime() + 3_600_000).toISOString(),
      status: "completed",
      checked_in_at: s.toISOString(),
      checked_out_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
      created_at: new Date(NOW.getTime() - 7 * 86_400_000).toISOString(),
    });
  }
});

afterAll(async () => {
  await admin.from("outbox_messages").delete().eq("business_id", salon.businessId);
  await salon.cleanup();
});

const messages = async () => (await admin.from("marketing_messages").select("kind, client_id, channel, to_address, subject, body, cycle_key, outbox_message_id").eq("business_id", salon.businessId)).data!;

describe("sending", () => {
  it("messages each client due, by a channel they said yes to, once, through the outbox", async () => {
    const summary = await runAutomations(admin, { businessId: salon.businessId, now: NOW });
    expect(summary).toMatchObject({ rebook: 1, win_back: 1, birthday: 1, review: 1 });
    const sent = await messages();
    const of = (name: string) => sent.filter((m) => m.client_id === ids[name]);
    expect(of("Bob")).toEqual([]);
    expect(of("Nia")).toEqual([]);
    const [rebook] = of("Rae");
    expect(rebook).toMatchObject({ kind: "rebook", channel: "sms", to_address: "(212) 555-0100", subject: null });
    expect(rebook.body).toMatch(/^Hi Rae, it's been a little while since your last visit to Other Salon\. Ready for your next one\? Book in a minute: https?:\/\/.+\/book\/auto-[a-z0-9]+\?src=rebook\n\nReply STOP or tap https?:\/\/.+\/unsubscribe\/[A-Za-z0-9_-]+ to stop these texts\.$/);
    expect(of("Wes")[0]).toMatchObject({ kind: "win_back", channel: "email", subject: "We miss you at Other Salon" });
    expect(of("Bea")[0].body).toMatch(/^Happy birthday, Bea! Everyone at Other Salon wishes you a wonderful day\. Enjoy 15% off this month\./);
    expect(of("Rev")[0]).toMatchObject({ kind: "review", cycle_key: expect.stringMatching(/^review:/) });
    expect(of("Rev")[0].body).toContain("Google: https://g.page/r/test/review");
    // Each is in the outbox, word for word.
    const { data: outbox } = await admin.from("outbox_messages").select("id, body").eq("id", rebook.outbox_message_id!).single();
    expect(outbox!.body).toBe(rebook.body);

    // Running again sends nothing new.
    expect(await runAutomations(admin, { businessId: salon.businessId, now: new Date(NOW.getTime() + 3_600_000) })).toMatchObject({ rebook: 0, win_back: 0, birthday: 0, review: 0 });
    expect((await messages()).length).toBe(sent.length);
  });

  it("waits outside sending hours", async () => {
    const late = fromLocal(today, 22 * 60, TZ)!;
    expect(await runAutomations(admin, { businessId: salon.businessId, now: late })).toMatchObject({ salons: 0, skippedQuietHours: 1 });
  });

  it("opts a client out from the link in the message (texts only, for a text)", async () => {
    const rebook = (await messages()).find((m) => m.client_id === ids.Rae)!;
    const token = /\/unsubscribe\/([A-Za-z0-9_-]+)/.exec(rebook.body)![1];
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(token).digest("hex");
    expect((await owner.rpc("marketing_opt_out", { p_token_hash: hash })).error).not.toBeNull();
    expect((await admin.rpc("marketing_opt_out", { p_token_hash: hash })).data).toEqual({ channel: "sms", salon: "Other Salon" });
    expect((await admin.from("clients").select("sms_opt_in, email_opt_in").eq("id", ids.Rae).single()).data).toEqual({ sms_opt_in: false, email_opt_in: true });
    expect((await admin.rpc("marketing_opt_out", { p_token_hash: "0".repeat(64) })).data).toBeNull();
  });

  it("counts a booking made after the message, and its revenue", async () => {
    const start = new Date(NOW.getTime() + 5 * 86_400_000);
    const { data: a } = await admin
      .from("appointments")
      .insert({ business_id: salon.businessId, location_id: salon.locationId, client_id: ids.Wes, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString() })
      .select("id")
      .single();
    await admin.from("sales").insert({ business_id: salon.businessId, location_id: salon.locationId, number: 1, client_id: ids.Wes, appointment_id: a!.id, subtotal_cents: 12000, total_cents: 12000 });
    const results = await loadAutomationResults(owner, salon.businessId, 90, new Date(NOW.getTime() + 86_400_000));
    expect(results.win_back).toEqual({ sent: 1, booked: 1, revenueCents: 12000, optedOut: 0 });
    expect(results.rebook).toMatchObject({ sent: 1, booked: 0, optedOut: 1 });
  });
});

describe("who can do what", () => {
  it("lets owners change automations, managers only look, and nobody else in", async () => {
    const manager = await signIn("manager@mapleandash.test");
    expect((await manager.rpc("save_automation", { p_business_id: SEED.business, p_kind: "rebook", p_input: { enabled: true, subject: "x", body: "y" } as never })).error?.code).toBe("42501");
    expect((await manager.from("marketing_automations").select("kind").eq("business_id", SEED.business)).error).toBeNull();
    expect((await manager.from("marketing_messages").select("id").eq("business_id", salon.businessId)).data).toEqual([]);
    const desk = await signIn("frontdesk@mapleandash.test");
    expect((await desk.from("marketing_automations").select("kind").eq("business_id", SEED.business)).data).toEqual([]);
    expect((await owner.from("marketing_messages").update({ body: "x" }).eq("business_id", salon.businessId).select()).data).toEqual([]);
  });

  it("turns one on from Denise's suggestion, with undo, for owners only", async () => {
    await owner.rpc("save_automation", { p_business_id: salon.businessId, p_kind: "birthday", p_input: { enabled: false, subject: "Hi", body: "Happy birthday, {first_name}!", settings: { prefer: "sms", daysBefore: 0 } } as never });
    const { data: [id], error } = (await owner.rpc("record_ai_proposals", {
      p_location_id: salon.locationId,
      p_feature: "automation",
      p_subject: "automation:birthday",
      p_options: [{ summary: "Turn on birthday messages", reason: "12 clients have a birthday on file.", proposal: { kind: "birthday" } }] as never,
    })) as { data: string[]; error: null };
    expect(error).toBeNull();
    expect((await owner.rpc("apply_automation_action", { p_action_id: id })).error).toBeNull();
    const enabled = async () => (await admin.from("marketing_automations").select("enabled").eq("business_id", salon.businessId).eq("kind", "birthday").single()).data!.enabled;
    expect(await enabled()).toBe(true);
    expect((await owner.rpc("apply_automation_action", { p_action_id: id })).error?.code).toBe("55000");
    expect((await owner.rpc("undo_automation_action", { p_action_id: id })).error).toBeNull();
    expect(await enabled()).toBe(false);
  });
});
