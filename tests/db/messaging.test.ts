// Message consent and staff messages in the database (migration
// …_message_consent.sql): appointment and marketing consent kept apart, a
// STOP stopping every text (appointment ones fall back to email), every
// consent and opt-out logged with where it came from, and staff messages
// (quick picks and free text) on allowed channels only, logged with who
// sent them, with free text only for the roles the owner allows.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, makeRoom, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const PHONE = "(312) 555-7788";
const DIGITS = "3125557788";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

let owner: Client;
let frontDesk: Client;
let bridget: Client;
let gil: Client;
let clientId: string;
let visitId: string;
const putBack: (() => Promise<void>)[] = [];

async function visit(staffId: string): Promise<string> {
  const { data: service } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single();
  const at = new Date(Date.now() + 2 * 86_400_000);
  const end = new Date(at.getTime() + 3_600_000);
  // The stylist may have demo clients then, on a working day.
  putBack.push(await makeRoom(staffId, at, end));
  const { data: a } = await admin
    .from("appointments")
    .insert({ business_id: B, location_id: L, client_id: clientId, starts_at: at.toISOString(), ends_at: end.toISOString(), status: "booked" })
    .select("id")
    .single();
  await admin.from("appointment_items").insert({
    business_id: B,
    location_id: L,
    appointment_id: a!.id,
    service_id: service!.id,
    staff_id: staffId,
    starts_at: at.toISOString(),
    ends_at: end.toISOString(),
    active_minutes: 60,
    price_cents: 8_500,
  });
  return a!.id;
}

const send = (c: Client, over: Record<string, unknown> = {}) =>
  c.rpc("send_client_message", {
    p_appointment_id: visitId,
    p_purpose: "appointment",
    p_template: "please_call",
    p_channel: "sms",
    p_subject: "",
    p_body: "Hi Mara, please call us about your visit.",
    p_opt_out_hash: null as never,
    ...over,
  } as never);

const consent = async () =>
  (await admin.from("clients").select("appointment_sms_ok, appointment_email_ok, sms_opt_in, email_opt_in, sms_stopped_at").eq("id", clientId).single()).data!;
const events = async () =>
  (await admin.from("client_consent_events").select("purpose, channel, granted, source, detail, staff_id").eq("client_id", clientId).order("created_at")).data!;

beforeAll(async () => {
  [owner, frontDesk, bridget, gil] = await Promise.all(["owner", "frontdesk", "bridget", "gil"].map((u) => signIn(`${u}@mapleandash.test`)));
  await admin.from("sms_suppressions").delete().eq("phone_digits", DIGITS);
  const { data: c } = await admin
    .from("clients")
    .insert({ business_id: B, first_name: "Mara", last_name: "Consent", phone: PHONE, email: "mara.consent@example.com", sms_opt_in: true, email_opt_in: true })
    .select("id")
    .single();
  clientId = c!.id;
  visitId = await visit(SEED.staff.gil);
});

afterAll(async () => {
  await admin.from("sms_suppressions").delete().eq("phone_digits", DIGITS);
  await admin.from("appointments").delete().eq("client_id", clientId);
  for (const undo of putBack) await undo();
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("businesses").update({ free_text_roles: ["manager", "front_desk", "stylist"] }).eq("id", B);
});

describe("consent", () => {
  it("logs marketing consent given when the client is added", async () => {
    expect(await events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ purpose: "marketing", channel: "sms", granted: true, source: "system" }),
        expect.objectContaining({ purpose: "marketing", channel: "email", granted: true, source: "system" }),
      ]),
    );
  });

  it("a marketing opt-out never touches appointment messages", async () => {
    // The client turns off offers in their online account.
    expect((await admin.rpc("set_client_consent", { p_client_id: clientId, p_changes: { sms_opt_in: false, email_opt_in: false }, p_source: "client_account" })).error).toBeNull();
    expect(await consent()).toMatchObject({ sms_opt_in: false, email_opt_in: false, appointment_sms_ok: true, appointment_email_ok: true });
    const offs = (await events()).filter((e) => e.source === "client_account");
    expect(offs).toHaveLength(2);
    expect(offs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ purpose: "marketing", channel: "sms", granted: false }),
        expect.objectContaining({ purpose: "marketing", channel: "email", granted: false }),
      ]),
    );
    // A message about their visit still goes by text.
    expect((await send(frontDesk)).error).toBeNull();
    // An offer doesn't.
    const offer = await send(frontDesk, { p_purpose: "marketing", p_template: "custom", p_body: "20% off retail this week", p_opt_out_hash: hash("t1") });
    expect(offer.error?.hint).toBe("channel");
  });

  it("staff record what a client said, as staff, whatever source they claim", async () => {
    expect((await frontDesk.rpc("set_client_consent", { p_client_id: clientId, p_changes: { email_opt_in: true }, p_source: "online_booking" })).error).toBeNull();
    const last = (await events()).at(-1)!;
    expect(last).toMatchObject({ purpose: "marketing", channel: "email", granted: true, source: "staff", staff_id: SEED.staff.frontDesk });
    expect((await gil.rpc("set_client_consent", { p_client_id: clientId, p_changes: { email_opt_in: false }, p_source: "staff" })).error?.code).toBe("42501");
  });
});

describe("STOP", () => {
  it("stops every text, appointment ones too, and the message falls back to email", async () => {
    expect((await admin.rpc("sms_keyword", { p_phone_digits: DIGITS, p_body: "Stop" })).data).toBe("stop");
    const c = await consent();
    expect(c.sms_stopped_at).not.toBeNull();
    expect(c.sms_opt_in).toBe(false);
    expect((await events()).at(-1)).toMatchObject({ purpose: "appointment", channel: "sms", granted: false, source: "sms_keyword", detail: "STOP" });
    // Texts about the visit are refused; email goes.
    expect((await send(frontDesk)).error?.hint).toBe("channel");
    const { data: id, error } = await send(frontDesk, { p_channel: "email", p_subject: "Please call us" });
    expect(error).toBeNull();
    const { data: m } = await admin.from("client_messages").select("channel, sent_by, purpose").eq("id", id as string).single();
    expect(m).toEqual({ channel: "email", sent_by: SEED.staff.frontDesk, purpose: "appointment" });
  });

  it("can't be undone by staff, or by a new client with the same number; only START", async () => {
    await frontDesk.from("clients").update({ sms_stopped_at: null }).eq("id", clientId);
    expect((await consent()).sms_stopped_at).not.toBeNull();
    const { data: twin } = await admin.from("clients").insert({ business_id: B, first_name: "Twin", last_name: "Number", phone: PHONE }).select("id, sms_stopped_at").single();
    expect(twin!.sms_stopped_at).not.toBeNull();
    await admin.from("clients").delete().eq("id", twin!.id);
    // A text the client sends with START lets appointment texts through again; offers need a new yes.
    expect((await admin.rpc("sms_keyword", { p_phone_digits: DIGITS, p_body: "START" })).data).toBe("start");
    expect(await consent()).toMatchObject({ sms_stopped_at: null, sms_opt_in: false });
    expect((await send(frontDesk)).error).toBeNull();
  });

  it("is only for the service role", async () => {
    expect((await frontDesk.rpc("sms_keyword", { p_phone_digits: DIGITS, p_body: "STOP" })).error).not.toBeNull();
  });
});

describe("staff messages", () => {
  it("are for the front of house or a stylist on the visit", async () => {
    expect((await send(bridget)).error?.code).toBe("42501");
    expect((await send(gil)).error).toBeNull();
  });

  it("free text is on for stylists by default, and owners can turn it off per role", async () => {
    const custom = { p_template: "custom", p_body: "Hi Mara, bring your inspiration photos!" };
    const { data: id, error } = await send(gil, custom);
    expect(error).toBeNull();
    const { data: m } = await admin.from("client_messages").select("template, body, sent_by").eq("id", id as string).single();
    // Texts always end with how to stop them.
    expect(m).toEqual({ template: "custom", body: "Hi Mara, bring your inspiration photos! Reply STOP to stop texts.", sent_by: SEED.staff.gil });

    expect((await frontDesk.rpc("set_free_text_roles", { p_business_id: B, p_roles: ["manager"] })).error?.code).toBe("42501");
    expect((await owner.rpc("set_free_text_roles", { p_business_id: B, p_roles: ["manager", "front_desk"] })).error).toBeNull();
    const off = await send(gil, custom);
    expect(off.error).toMatchObject({ code: "42501", hint: "free_text" });
    // Quick picks still work, and owners can always write.
    expect((await send(gil)).error).toBeNull();
    expect((await send(owner, custom)).error).toBeNull();
  });

  it("offers need marketing consent and carry their unsubscribe link", async () => {
    await admin.from("clients").update({ email_opt_in: true }).eq("id", clientId);
    expect((await send(frontDesk, { p_purpose: "marketing", p_template: "please_call" })).error?.code).toBe("22023");
    expect((await send(frontDesk, { p_purpose: "marketing", p_template: "custom", p_channel: "email", p_body: "New color line" })).error?.code).toBe("22023");
    const token = `offer-${Date.now()}`;
    const { error } = await send(frontDesk, { p_purpose: "marketing", p_template: "custom", p_channel: "email", p_subject: "New in", p_body: "New color line", p_opt_out_hash: hash(token) });
    expect(error).toBeNull();
    // The link opts them out of offers by email, and is logged as the link.
    expect((await admin.rpc("marketing_opt_out", { p_token_hash: hash(token) })).error).toBeNull();
    expect(await consent()).toMatchObject({ email_opt_in: false, appointment_email_ok: true });
    expect((await events()).at(-1)).toMatchObject({ purpose: "marketing", channel: "email", granted: false, source: "unsubscribe_link" });
  });

  it("are for upcoming visits only", async () => {
    await admin.from("appointments").update({ status: "canceled", canceled_at: new Date().toISOString() }).eq("id", visitId);
    expect((await send(frontDesk)).error?.code).toBe("55000");
    await admin.from("appointments").update({ status: "booked", canceled_at: null }).eq("id", visitId);
  });

  it("stylists read only the messages they sent", async () => {
    const { data: mine } = await gil.from("client_messages").select("sent_by").eq("client_id", clientId);
    expect(mine!.length).toBeGreaterThan(0);
    expect(mine!.every((m) => m.sent_by === SEED.staff.gil)).toBe(true);
    const { data: all } = await frontDesk.from("client_messages").select("sent_by").eq("client_id", clientId);
    expect(new Set(all!.map((m) => m.sent_by)).size).toBeGreaterThan(1);
  });
});
