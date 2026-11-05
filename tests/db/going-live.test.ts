// Going live in the database (migration …_going_live.sql): only owners
// turn real messages or payments on, nobody signed in sets them (or the
// Stripe account) directly, a message is queued for real only while its
// salon is live, and the sender's claim, results and the providers'
// delivery updates (bounces, spam complaints, a carrier STOP) behave.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, sql, type Client } from "./helpers";

const B = SEED.business;
let owner: Client;
let manager: Client;
let frontDesk: Client;
const madeIds: string[] = [];

async function outbox(channel: "sms" | "email", to: string, business: string | null = B) {
  const { data, error } = await admin.from("outbox_messages").insert({ business_id: business, channel, to_address: to, subject: channel === "email" ? "Hi" : null, body: "Hello" }).select("id, status").single();
  if (error) throw error;
  madeIds.push(data.id);
  return data;
}

beforeAll(async () => {
  [owner, manager, frontDesk] = await Promise.all([signIn("owner@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
});

afterAll(async () => {
  sql(`update public.businesses set messages_live = false, messages_live_at = null, payments_live = false, payments_live_at = null, stripe_account_id = null, stripe_charges_enabled = false, stripe_details_submitted = false, stripe_checked_at = null where id = '${B}';
       delete from public.go_live_events where business_id = '${B}';
       delete from public.email_suppressions where email like '%@golive.test';
       delete from public.sms_suppressions where phone_digits = '3125550177';`);
  if (madeIds.length) await admin.from("outbox_messages").delete().in("id", madeIds);
});

describe("the go-live switches", () => {
  it("only owners turn them on, and it's logged", async () => {
    for (const who of [manager, frontDesk]) {
      const { error } = await who.rpc("set_go_live", { p_kind: "messages", p_on: true });
      expect(error?.code).toBe("42501");
    }
    const { error } = await owner.rpc("set_go_live", { p_kind: "messages", p_on: true });
    expect(error).toBeNull();
    const { data: b } = await admin.from("businesses").select("messages_live, messages_live_at, payments_live").eq("id", B).single();
    expect(b).toMatchObject({ messages_live: true, payments_live: false });
    expect(b?.messages_live_at).toBeTruthy();
    const { data: events } = await owner.from("go_live_events").select("kind, turned_on, staff_id");
    expect(events).toContainEqual({ kind: "messages", turned_on: true, staff_id: SEED.staff.owner });
    // The front desk doesn't read the log.
    const { data: theirs } = await frontDesk.from("go_live_events").select("id");
    expect(theirs).toEqual([]);
    await owner.rpc("set_go_live", { p_kind: "messages", p_on: false });
  });

  it("can't be set directly, nor the Stripe account, even by an owner", async () => {
    const live = await owner.from("businesses").update({ payments_live: true }).eq("id", B);
    expect(live.error?.code).toBe("42501");
    const stripe = await owner.from("businesses").update({ stripe_account_id: "acct_123" }).eq("id", B);
    expect(stripe.error?.code).toBe("42501");
    // Other settings still save.
    const { data: before } = await admin.from("businesses").select("receipt_footer").eq("id", B).single();
    const ok = await owner.from("businesses").update({ receipt_footer: before!.receipt_footer }).eq("id", B);
    expect(ok.error).toBeNull();
  });

  it("connects a Stripe account from the server, and disconnecting turns live payments off", async () => {
    const { error } = await admin.rpc("set_stripe_account", { p_business_id: B, p_account_id: "acct_TEST123", p_charges_enabled: false, p_details_submitted: false, p_staff_id: SEED.staff.owner });
    expect(error).toBeNull();
    await admin.rpc("stripe_account_updated", { p_account_id: "acct_TEST123", p_charges_enabled: true, p_details_submitted: true });
    await owner.rpc("set_go_live", { p_kind: "payments", p_on: true });
    let { data: b } = await admin.from("businesses").select("stripe_account_id, stripe_charges_enabled, payments_live").eq("id", B).single();
    expect(b).toEqual({ stripe_account_id: "acct_TEST123", stripe_charges_enabled: true, payments_live: true });
    await admin.rpc("set_stripe_account", { p_business_id: B, p_account_id: null as never, p_charges_enabled: false, p_details_submitted: false });
    ({ data: b } = await admin.from("businesses").select("stripe_account_id, stripe_charges_enabled, payments_live").eq("id", B).single());
    expect(b).toEqual({ stripe_account_id: null, stripe_charges_enabled: false, payments_live: false });
    const { data: events } = await admin.from("go_live_events").select("kind").eq("business_id", B).order("created_at");
    expect(events?.map((e) => e.kind)).toEqual(expect.arrayContaining(["stripe_connected", "stripe_disconnected", "payments"]));
  });
});

describe("the outbox", () => {
  it("holds messages while the salon isn't live, and queues them once it is", async () => {
    expect((await outbox("sms", "3125550101")).status).toBe("held");
    await owner.rpc("set_go_live", { p_kind: "messages", p_on: true });
    expect((await outbox("sms", "3125550102")).status).toBe("queued");
    // A message with no salon is never sent.
    expect((await outbox("sms", "3125550103", null)).status).toBe("held");
    // Nothing written earlier is sent later.
    const { data: earlier } = await admin.from("outbox_messages").select("status").eq("id", madeIds[0]).single();
    expect(earlier?.status).toBe("held");
    // Another salon that isn't live still holds.
    expect((await outbox("sms", "3125550104", SEED.large.business)).status).toBe("held");
  });

  it("claims queued messages once, expires old ones, and records results", async () => {
    const old = await outbox("email", "late@golive.test");
    sql(`update public.outbox_messages set created_at = now() - interval '2 hours' where id = '${old.id}'`);
    const fresh = await outbox("email", "Bounce@GoLive.test");
    // Claim everything queued (other tests' leftovers included).
    const { data: claimed, error } = await admin.rpc("claim_outbox_messages", { p_limit: 100 });
    expect(error).toBeNull();
    const ids = (claimed ?? []).map((m) => m.id);
    expect(ids).toContain(fresh.id);
    expect(ids).not.toContain(old.id);
    expect((claimed ?? []).find((m) => m.id === fresh.id)).toMatchObject({ salon: "Maple & Ash Hair Studio", attempts: 1 });
    const { data: again } = await admin.rpc("claim_outbox_messages", { p_limit: 100 });
    expect((again ?? []).map((m) => m.id)).not.toContain(fresh.id);
    const { data: expired } = await admin.from("outbox_messages").select("status, error").eq("id", old.id).single();
    expect(expired).toEqual({ status: "expired", error: "too_late" });

    await admin.rpc("record_outbox_result", { p_id: fresh.id, p_status: "sent", p_provider: "resend", p_provider_id: "em_golive_1", p_error: null as never });
    for (const m of claimed ?? []) if (m.id !== fresh.id) await admin.rpc("record_outbox_result", { p_id: m.id, p_status: "failed", p_provider: null as never, p_provider_id: null as never, p_error: "test" });
    const { data: sent } = await admin.from("outbox_messages").select("status, provider, provider_id, sent_at").eq("id", fresh.id).single();
    expect(sent).toMatchObject({ status: "sent", provider: "resend", provider_id: "em_golive_1" });
    expect(sent?.sent_at).toBeTruthy();
  });

  it("a bounce stops email to that address", async () => {
    await admin.rpc("outbox_delivery_update", { p_provider: "resend", p_provider_id: "em_golive_1", p_status: "bounced", p_error: "bounced" });
    const { data: msg } = await admin.from("outbox_messages").select("status").eq("provider_id", "em_golive_1").single();
    expect(msg?.status).toBe("bounced");
    const { data: sup } = await admin.from("email_suppressions").select("email, reason").eq("email", "bounce@golive.test").single();
    expect(sup).toEqual({ email: "bounce@golive.test", reason: "bounce" });
    // Nobody signed in reads suppressions.
    const { data: theirs } = await owner.from("email_suppressions").select("email");
    expect(theirs).toEqual([]);
  });

  it("a spam complaint turns off that client's offers by email, logged", async () => {
    const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: "Golive", last_name: "Complaint", email: "complaint@golive.test", email_opt_in: true }).select("id").single();
    const m = await outbox("email", "complaint@golive.test");
    sql(`update public.outbox_messages set status = 'sent', provider = 'resend', provider_id = 'em_golive_2' where id = '${m.id}'`);
    await admin.rpc("outbox_delivery_update", { p_provider: "resend", p_provider_id: "em_golive_2", p_status: "complained", p_error: "complained" });
    const { data: client } = await admin.from("clients").select("email_opt_in").eq("id", c!.id).single();
    expect(client?.email_opt_in).toBe(false);
    const { data: log } = await admin.from("client_consent_events").select("source, purpose, channel, granted").eq("client_id", c!.id);
    expect(log).toContainEqual(expect.objectContaining({ source: "system", purpose: "marketing", channel: "email", granted: false }));
    await admin.from("client_consent_events").delete().eq("client_id", c!.id);
    await admin.from("clients").delete().eq("id", c!.id);
  });

  it("a text the carrier refused because of a STOP is recorded as one", async () => {
    const m = await outbox("sms", "(312) 555-0177");
    sql(`update public.outbox_messages set status = 'sent', provider = 'twilio', provider_id = 'SMgolive1' where id = '${m.id}'`);
    await admin.rpc("outbox_delivery_update", { p_provider: "twilio", p_provider_id: "SMgolive1", p_status: "failed", p_error: "21610" });
    const { data } = await admin.from("sms_suppressions").select("phone_digits").eq("phone_digits", "3125550177");
    expect(data).toHaveLength(1);
  });

  it("nobody signed in claims or records messages", async () => {
    const { error } = await owner.rpc("claim_outbox_messages", { p_limit: 1 });
    expect(error).not.toBeNull();
  });
});
