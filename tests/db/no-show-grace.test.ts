// No-show grace (migration …_no_show_grace.sql): a client's first no-show
// in the salon's window is forgiven, at once or once they rebook with the
// same stylist in time (charged otherwise, and never before the window
// ends), taking the no-show back takes the grace back, and the client gets
// the salon's own message only when staff send it
// (…_grace_message_asks_first.sql).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runPolicyCharges } from "@/lib/policy-billing";
import { admin, type Client, SEED, signIn, throwawayStylist } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TAG = `Grace${Date.now().toString(36)}`;
const HOUR = 3_600_000;

let owner: Client;
let frontDesk: Client;
let savedPolicy: Record<string, unknown> | null = null;
let cut: string;
const clients: string[] = [];
const stylists: Awaited<ReturnType<typeof throwawayStylist>>[] = [];

const POLICY = {
  card_required: "off",
  card_service_ids: [],
  card_staff_ids: [],
  cancel_window_hours: 24,
  late_cancel_fee_kind: "fixed",
  late_cancel_fee_amount: 3000,
  no_show_fee_kind: "fixed",
  no_show_fee_amount: 5000,
  long_hold_days: null,
  repeat_count: 2,
  repeat_months: 6,
  repeat_action: "off",
  repeat_deposit_percent: 50,
  waive_roles: ["owner", "manager"],
};

const grace = (as: Client, rebookDays: number | null, kinds = ["no_show"]) =>
  as.rpc("save_grace_settings", {
    p_business_id: B,
    p_on: true,
    p_kinds: kinds,
    p_months: 12,
    p_rebook_days: rebookDays!,
    p_message: "Hi {first_name}, no charge this time at {salon}. Rebook with {stylist}: {booking_link}",
  });

const newStylist = async () => {
  const s = await throwawayStylist(`${TAG}Sty`);
  stylists.push(s);
  return s.id;
};

async function client() {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Ivy`, last_name: "Test", email: `${TAG.toLowerCase()}${clients.length}@example.com` }).select("id").single();
  clients.push(data!.id);
  return data!.id;
}

// A $100 cut with a stylist, hoursAhead from now.
async function visit(clientId: string, staffId: string, hoursAhead: number) {
  const start = new Date(Date.now() + hoursAhead * HOUR);
  start.setUTCSeconds(0, 0);
  const end = new Date(start.getTime() + HOUR);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString() }).select("id").single();
  await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: cut, staff_id: staffId, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: 10000 });
  return a!.id;
}

const status = (id: string, s: "no_show" | "canceled", reason = "") => frontDesk.rpc("set_appointment_status", { p_appointment_id: id, p_status: s, p_reason: reason });
const feeOf = async (appointmentId: string) => (await admin.from("policy_fees").select("*").eq("appointment_id", appointmentId).single()).data!;

beforeAll(async () => {
  [owner, frontDesk] = await Promise.all([signIn("owner@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  savedPolicy = (await admin.from("policy_settings").select("*").eq("business_id", B).maybeSingle()).data;
  cut = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single()).data!.id;
  expect((await owner.rpc("save_policy_settings", { p_business_id: B, p: POLICY })).error).toBeNull();
});

afterAll(async () => {
  await admin.from("appointments").delete().in("client_id", clients);
  for (const s of stylists) await s.remove();
  await admin.from("clients").delete().in("id", clients);
  await admin.from("policy_settings").delete().eq("business_id", B);
  if (savedPolicy) await admin.from("policy_settings").insert(savedPolicy as never);
});

describe("grace settings", () => {
  it("are set by those with settings only, with a message", async () => {
    expect((await grace(frontDesk, null)).error?.code).toBe("42501");
    expect((await owner.rpc("save_grace_settings", { p_business_id: B, p_on: true, p_kinds: ["no_show"], p_months: 12, p_rebook_days: null!, p_message: " " })).error?.hint).toBe("message");
    expect((await grace(owner, null)).error).toBeNull();
    // The rest of the policy is untouched.
    expect((await admin.from("policy_settings").select("no_show_fee_amount, grace_on").eq("business_id", B).single()).data).toEqual({ no_show_fee_amount: 5000, grace_on: true });
  });
});

describe("grace at once", () => {
  it("waives a client's first no-show, not the next, and taking the no-show back takes it back", async () => {
    await grace(owner, null);
    const c = await client();
    const gil = await newStylist();
    const first = await visit(c, gil, -2);
    expect((await status(first, "no_show")).error).toBeNull();
    const fee = await feeOf(first);
    expect(fee).toMatchObject({ status: "waived", grace_staff_id: gil, grace_until: null });
    expect(fee.waive_reason).toBe("Grace: their first no-show in 12 months");
    expect((await admin.from("policy_fee_events").select("kind").eq("fee_id", fee.id).order("created_at")).data!.map((e) => e.kind)).toEqual(["assessed", "grace"]);

    // The next one in the window is charged as usual (no card: it waits for one).
    const second = await visit(c, gil, -1);
    await status(second, "no_show");
    expect((await feeOf(second)).status).toBe("no_card");

    // A no-show taken back takes its grace with it.
    const { data: loc } = await admin.from("locations").select("calendar_version").eq("id", L).single();
    expect((await frontDesk.rpc("undo_no_show", { p_appointment_id: first, p_expected_version: loc!.calendar_version })).error).toBeNull();
    expect((await feeOf(first)).status).toBe("voided");
  });

  it("only covers the kinds the salon chose", async () => {
    await grace(owner, null, ["no_show"]);
    const c = await client();
    const late = await visit(c, await newStylist(), 2);
    await status(late, "canceled", "Client canceled");
    expect((await feeOf(late)).grace_at).toBeNull();
  });

  it("never tells the client by itself: only staff's Send does, once, and Don't send settles it too", async () => {
    await grace(owner, null);
    const c = await client();
    const a = await visit(c, await newStylist(), -2);
    await status(a, "no_show");
    const fee = await feeOf(a);
    const outbox = () => admin.from("outbox_messages").select("body").eq("to_address", `${TAG.toLowerCase()}${clients.length - 1}@example.com`);
    // The fee run sends nothing, however late it is.
    await runPolicyCharges(admin, { feeId: fee.id });
    expect((await outbox()).data).toEqual([]);

    const send = () =>
      frontDesk.rpc("send_client_message", { p_appointment_id: a, p_purpose: "appointment", p_template: "grace", p_channel: "email", p_subject: "Maple & Ash", p_body: `Hi ${TAG}Ivy, no charge this time.`, p_opt_out_hash: null! });
    expect((await send()).error).toBeNull();
    expect((await outbox()).data).toHaveLength(1);
    expect(await feeOf(a)).toMatchObject({ grace_message_skipped_at: null });
    expect((await feeOf(a)).grace_message_at).not.toBeNull();
    // Once only.
    expect((await send()).error?.hint).toBe("grace_done");
    expect((await frontDesk.rpc("skip_grace_message", { p_fee_id: fee.id })).error?.hint).toBe("grace_done");
    // A no-show without grace still takes no messages.
    const plain = await visit(c, await newStylist(), -1);
    await status(plain, "no_show");
    expect((await frontDesk.rpc("send_client_message", { p_appointment_id: plain, p_purpose: "appointment", p_template: "custom", p_channel: "email", p_subject: "x", p_body: "Hello", p_opt_out_hash: null! })).error?.code).toBe("55000");
  });

  it("Don't send is the front of house's, and nothing goes out", async () => {
    await grace(owner, null);
    const c = await client();
    const a = await visit(c, await newStylist(), -2);
    await status(a, "no_show");
    const fee = await feeOf(a);
    const stylist = await signIn("gil@mapleandash.test");
    expect((await stylist.rpc("skip_grace_message", { p_fee_id: fee.id })).error?.code).toBe("42501");
    expect((await frontDesk.rpc("skip_grace_message", { p_fee_id: fee.id })).error).toBeNull();
    expect((await feeOf(a)).grace_message_skipped_at).not.toBeNull();
    expect((await admin.from("outbox_messages").select("id").eq("to_address", `${TAG.toLowerCase()}${clients.length - 1}@example.com`)).data).toEqual([]);
  });
});

describe("grace for a rebooking", () => {
  it("holds the fee, waives it when they rebook with the same stylist, and never charges it early", async () => {
    await grace(owner, 14);
    const c = await client();
    const [gil, other] = [await newStylist(), await newStylist()];
    const a = await visit(c, gil, -2);
    await status(a, "no_show");
    let fee = await feeOf(a);
    expect(fee.status).toBe("no_card");
    const until = Date.parse(fee.grace_until!);
    expect(until).toBeGreaterThan(Date.now() + 13.9 * 24 * HOUR);

    // A card added meanwhile makes it due only once the window ends.
    await admin.from("policy_fees").update({ status: "pending", charge_after: new Date().toISOString() }).eq("id", fee.id);
    expect(Date.parse((await feeOf(a)).charge_after!)).toBe(until);

    // Rebooking with someone else doesn't count; with the same stylist it does.
    await visit(c, other, 24 * 7);
    expect((await feeOf(a)).status).toBe("pending");
    await visit(c, gil, 24 * 8);
    fee = await feeOf(a);
    expect(fee).toMatchObject({ status: "waived", charge_after: null, waive_reason: `Grace: rebooked with ${TAG}Sty` });
  });
});
