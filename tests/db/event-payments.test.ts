// Bridal and events, the money: a proposal sent by the desk, agreed on its
// page (the exact terms kept, the deposit taken, the rest scheduled the same
// way as lib/events/pricing.ts), scheduled payments charged to the card on
// file (and a failure flagged to the desk and owners, tried again, or a new
// card), the schedule following a bigger party, members paying their own,
// and Lost canceling what's left. Charges go through the test provider.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chargeDuePayments, runEventBilling } from "@/lib/events/billing";
import { remainingSchedule } from "@/lib/events/pricing";
import { settingsFrom } from "@/lib/events/types";
import { sha256 } from "@/lib/online-booking/security";
import { addDays, fromLocal, todayIn } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const TZ = "America/Chicago";
const P = { bride: "ee000000-0000-4000-8000-000000000001", maidBoth: "ee000000-0000-4000-8000-000000000003", maidHair: "ee000000-0000-4000-8000-000000000002" };
const EMAIL = `eventpay-${crypto.randomUUID()}@example.test`;
const today = todayIn(TZ);
const DATE = addDays(today, 120);
// 10am at the salon today: inside the sending hours.
const IN_HOURS = fromLocal(today, 600, TZ)!;

let desk: Client;
let manager: Client;
let stylist: Client;
let clientId: string;
let eventId: string;
let ownMemberId: string;

const members = (extra: { name: string; party_role: string; package_id: string }[] = []) => [
  { name: "Mia", party_role: "bride", package_id: P.bride },
  { name: "Ana", party_role: "bridesmaid", package_id: P.maidBoth, pays_own: true, email: EMAIL },
  { name: "Lu", party_role: "bridesmaid", package_id: P.maidHair },
  ...extra,
];
const body = (over: Record<string, unknown> = {}) => ({ title: "Payments test wedding", client_id: clientId, event_date: DATE, ready_by: `${DATE}T19:00:00Z`, billing: "split", members: members(), tasks: [], ...over });

async function eventRow() {
  const { data } = await admin.from("events").select("status, total_cents, main_cents, deposit_cents, card_label").eq("id", eventId).single();
  return data!;
}
async function paymentsOf(kind?: string) {
  let q = admin.from("event_payments").select("id, kind, amount_cents, status, due_on, failure_reason").eq("event_id", eventId).order("due_on").order("kind");
  if (kind) q = q.eq("kind", kind);
  return (await q).data!;
}
async function settings() {
  return settingsFrom((await admin.from("event_settings").select("*").eq("business_id", SEED.business).single()).data!);
}

beforeAll(async () => {
  [desk, manager, stylist] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("nola@mapleandash.test")]);
  const { data: c, error } = await admin.from("clients").insert({ business_id: SEED.business, first_name: "Payment", last_name: "Tester", email: EMAIL }).select("id").single();
  if (error) throw error;
  clientId = c.id;
  const { data: id, error: saveError } = await desk.rpc("save_event", { p_event_id: null!, p_input: body() as never });
  if (saveError) throw saveError;
  eventId = id;
  ownMemberId = (await admin.from("event_members").select("id").eq("event_id", eventId).eq("name", "Ana").single()).data!.id;
});

afterAll(async () => {
  await admin.from("events").delete().eq("id", eventId);
  await admin.from("notifications").delete().eq("business_id", SEED.business).in("template", ["event_booked", "event_payment_failed"]);
  await admin.from("outbox_messages").delete().eq("to_address", EMAIL);
  await admin.from("clients").delete().eq("id", clientId);
});

describe("the proposal", () => {
  it("is sent by the front of house only, and makes the event Proposal sent", async () => {
    expect((await stylist.rpc("send_event_proposal", { p_event_id: eventId, p_token_hash: sha256("x"), p_channel: "email", p_to: EMAIL, p_days: 14 })).error?.code).toBe("42501");
    const { error } = await desk.rpc("send_event_proposal", { p_event_id: eventId, p_token_hash: sha256("proposal-1"), p_channel: "email", p_to: EMAIL, p_days: 14 });
    expect(error).toBeNull();
    expect((await eventRow()).status).toBe("proposal_sent");
    // Sending again replaces the open link.
    await desk.rpc("send_event_proposal", { p_event_id: eventId, p_token_hash: sha256("proposal-2"), p_channel: "email", p_to: EMAIL, p_days: 14 });
    const { data: links } = await admin.from("event_links").select("token_hash, status").eq("event_id", eventId).order("created_at");
    expect(links!.map((l) => l.status)).toEqual(["canceled", "open"]);
    expect((await stylist.from("event_links").select("id").eq("event_id", eventId)).data).toEqual([]);
  });

  it("can't be agreed for a different total or deposit, or by anyone but the service role", async () => {
    const link = (await admin.from("event_links").select("id").eq("token_hash", sha256("proposal-2")).single()).data!;
    const e = await eventRow();
    const wrong = { typed_name: "Mia Rossi", total_cents: e.total_cents, card: { provider: "test", ref: "test_visa_4242", label: "Visa …4242" }, deposit: { amount_cents: e.deposit_cents - 1, provider: "test", reference: "test_ch_x" } };
    expect((await admin.rpc("accept_event_proposal", { p_link_id: link.id, p_input: wrong })).error).toMatchObject({ hint: "changed" });
    expect((await admin.rpc("accept_event_proposal", { p_link_id: link.id, p_input: { ...wrong, total_cents: e.total_cents + 100 } })).error).toMatchObject({ hint: "changed" });
    expect((await desk.rpc("accept_event_proposal", { p_link_id: link.id, p_input: wrong })).error).not.toBeNull();
  });

  it("booked: the terms as they read them, the deposit, and the rest scheduled like the app", async () => {
    const link = (await admin.from("event_links").select("id").eq("token_hash", sha256("proposal-2")).single()).data!;
    const e = await eventRow();
    const { error } = await admin.rpc("accept_event_proposal", {
      p_link_id: link.id,
      p_input: { typed_name: "Mia Rossi", total_cents: e.total_cents, ip_hash: "h", card: { provider: "test", ref: "test_visa_4242", label: "Visa …4242" }, deposit: { amount_cents: e.deposit_cents, provider: "test", reference: "test_ch_deposit" } },
    });
    expect(error).toBeNull();
    expect(await eventRow()).toMatchObject({ status: "booked", card_label: "Visa …4242" });

    const { data: agreement } = await admin.from("event_agreements").select("typed_name, terms_version, terms_text, total_cents, deposit_cents, schedule").eq("event_id", eventId).single();
    expect(agreement).toMatchObject({ typed_name: "Mia Rossi", total_cents: e.total_cents, deposit_cents: e.deposit_cents });
    expect(agreement!.terms_text).toContain("Maple & Ash");
    expect(agreement!.terms_text).not.toContain("{salon}");

    const expected = remainingSchedule({ mainCents: e.main_cents, eventDate: DATE, bookedOn: today, today, paid: [{ kind: "deposit", amountCents: e.deposit_cents }] }, await settings());
    expect((await paymentsOf()).map((p) => [p.kind, p.amount_cents, p.status, p.due_on])).toEqual([
      ["deposit", e.deposit_cents, "paid", today],
      ...expected.map((x) => [x.kind, x.amountCents, "scheduled", x.dueOn]),
    ]);
    expect(expected.reduce((a, x) => a + x.amountCents, 0) + e.deposit_cents).toBe(e.main_cents);
    expect((await admin.from("notifications").select("id").eq("template", "event_booked").eq("staff_id", SEED.staff.frontDesk)).data!.length).toBeGreaterThan(0);

    // The link is used up.
    expect((await admin.rpc("accept_event_proposal", { p_link_id: link.id, p_input: { typed_name: "Mia Rossi", total_cents: e.total_cents } })).error).toMatchObject({ hint: "used" });
    // Stylists don't see the money.
    expect((await stylist.from("event_payments").select("id").eq("event_id", eventId)).data).toEqual([]);
  });
});

describe("scheduled payments", () => {
  it("are reminded a few days ahead, in the salon's hours", async () => {
    const [second] = await paymentsOf("second");
    await admin.from("event_payments").update({ due_on: addDays(today, 2) }).eq("id", second.id);
    const summary = await runEventBilling(admin, { businessId: SEED.business, now: IN_HOURS });
    expect(summary.reminded).toBeGreaterThanOrEqual(1);
    const { data: out } = await admin.from("outbox_messages").select("body").eq("to_address", EMAIL).ilike("body", "%reminder%");
    expect(out!.length).toBe(1);
    expect(out![0].body).toContain("will be charged to Visa …4242");
    // The deposit's receipt went too, once.
    expect((await admin.from("outbox_messages").select("id").eq("to_address", EMAIL).ilike("body", "%received your deposit%")).data!.length).toBe(1);
    await runEventBilling(admin, { businessId: SEED.business, now: IN_HOURS });
    expect((await admin.from("outbox_messages").select("id").eq("to_address", EMAIL).ilike("body", "%reminder%")).data!.length).toBe(1);
  });

  it("charge the card when due; a decline is flagged to the desk and owners", async () => {
    const [second] = await paymentsOf("second");
    await admin.from("event_payments").update({ due_on: today }).eq("id", second.id);
    await admin.from("events").update({ card_ref: "test_visa_0002", card_label: "Visa …0002" }).eq("id", eventId);
    const result = await chargeDuePayments(admin, { businessId: SEED.business, paymentId: second.id });
    expect(result).toMatchObject({ charged: 0, failed: 1 });
    expect((await paymentsOf("second"))[0]).toMatchObject({ status: "failed", failure_reason: "The card was declined" });
    const { data: flagged } = await admin.from("notifications").select("staff_id").eq("template", "event_payment_failed");
    expect(new Set(flagged!.map((n) => n.staff_id))).toEqual(new Set([SEED.staff.owner, SEED.staff.manager, SEED.staff.frontDesk]));
    // Not charged twice by another run.
    expect((await chargeDuePayments(admin, { businessId: SEED.business, paymentId: second.id })).failed).toBe(0);
  });

  it("are tried again from the desk, and a new card from the client's link pays what failed", async () => {
    const [second] = await paymentsOf("second");
    expect((await stylist.rpc("retry_event_payment", { p_payment_id: second.id })).error?.code).toBe("42501");
    expect((await desk.rpc("retry_event_payment", { p_payment_id: second.id })).error).toBeNull();
    expect((await chargeDuePayments(admin, { businessId: SEED.business, paymentId: second.id })).failed).toBe(1);

    const { error } = await desk.rpc("send_event_card_link", { p_event_id: eventId, p_token_hash: sha256("card-1"), p_channel: "email", p_to: EMAIL, p_days: 7 });
    expect(error).toBeNull();
    const link = (await admin.from("event_links").select("id").eq("token_hash", sha256("card-1")).single()).data!;
    expect((await admin.rpc("update_event_card", { p_link_id: link.id, p_card: { provider: "test", ref: "test_visa_4242", label: "Visa …4242" } })).error).toBeNull();
    expect((await paymentsOf("second"))[0].status).toBe("scheduled");
    expect(await chargeDuePayments(admin, { businessId: SEED.business, paymentId: second.id })).toMatchObject({ charged: 1, failed: 0 });
    expect((await paymentsOf("second"))[0].status).toBe("paid");
  });
});

describe("a bigger party before the cutoff", () => {
  it("raises the total and the balance; what's paid stays paid", async () => {
    const before = await eventRow();
    // As the builder sends it: members already saved with their ids.
    const { data: saved } = await admin.from("event_members").select("id, name").eq("event_id", eventId);
    const idOf = new Map(saved!.map((m) => [m.name, m.id]));
    const party = members([{ name: "Zoe", party_role: "bridesmaid", package_id: P.maidBoth }]).map((m) => ({ ...m, id: idOf.get(m.name) }));
    const { error } = await desk.rpc("save_event", { p_event_id: eventId, p_input: body({ members: party }) as never });
    expect(error).toBeNull();
    const after = await eventRow();
    expect(after.total_cents).toBeGreaterThan(before.total_cents);
    const paid = (await paymentsOf()).filter((p) => p.status === "paid");
    const expected = remainingSchedule(
      { mainCents: after.main_cents, eventDate: DATE, bookedOn: today, today, paid: paid.map((p) => ({ kind: p.kind as "deposit" | "second", amountCents: p.amount_cents })) },
      await settings(),
    );
    expect((await paymentsOf()).filter((p) => p.status === "scheduled").map((p) => [p.kind, p.amount_cents, p.due_on])).toEqual(expected.map((x) => [x.kind, x.amountCents, x.dueOn]));
    // Ana kept her row (and so her pay link).
    expect((await admin.from("event_members").select("id").eq("event_id", eventId).eq("name", "Ana").single()).data!.id).toBe(ownMemberId);
  });
});

describe("members paying their own", () => {
  it("get a link and pay exactly their share", async () => {
    expect((await desk.rpc("send_event_member_link", { p_member_id: ownMemberId, p_token_hash: sha256("member-1"), p_channel: "email", p_to: EMAIL, p_days: 14 })).error).toBeNull();
    const link = (await admin.from("event_links").select("id").eq("token_hash", sha256("member-1")).single()).data!;
    const [{ data: m }, s, { data: b }] = await Promise.all([admin.from("event_members").select("price_cents").eq("id", ownMemberId).single(), settings(), admin.from("businesses").select("tax_rate_services_bp").eq("id", SEED.business).single()]);
    const { memberShare } = await import("@/lib/events/pricing");
    const share = memberShare(m!.price_cents, s, b!.tax_rate_services_bp);
    expect((await admin.rpc("pay_event_member", { p_link_id: link.id, p_payment: { amount_cents: share - 1, provider: "test", reference: "r" } })).error).toMatchObject({ hint: "changed" });
    expect((await admin.rpc("pay_event_member", { p_link_id: link.id, p_payment: { amount_cents: share, provider: "test", reference: "test_ch_share", card_label: "Visa …4242" } })).error).toBeNull();
    expect((await admin.from("event_payments").select("amount_cents, status").eq("member_id", ownMemberId)).data).toEqual([{ amount_cents: share, status: "paid" }]);
    expect((await desk.rpc("send_event_member_link", { p_member_id: ownMemberId, p_token_hash: sha256("member-2"), p_channel: "email", p_to: EMAIL, p_days: 14 })).error?.message).toContain("already paid");
  });
});

describe("Lost", () => {
  it("needs a reason, cancels what's still scheduled, and can be reopened", async () => {
    expect((await desk.rpc("set_event_status", { p_event_id: eventId, p_status: "lost", p_reason: " " })).error?.code).toBe("22023");
    expect((await manager.rpc("set_event_status", { p_event_id: eventId, p_status: "lost", p_reason: "Went with another salon" })).error).toBeNull();
    const payments = await paymentsOf();
    expect(payments.some((p) => p.status === "scheduled")).toBe(false);
    expect(payments.filter((p) => p.status === "paid").length).toBeGreaterThanOrEqual(2);
    expect((await admin.from("events").select("status, lost_reason").eq("id", eventId).single()).data).toEqual({ status: "lost", lost_reason: "Went with another salon" });
    expect((await desk.rpc("set_event_status", { p_event_id: eventId, p_status: "inquiry", p_reason: "" })).error).toBeNull();
    expect((await eventRow()).status).toBe("inquiry");
  });
});
