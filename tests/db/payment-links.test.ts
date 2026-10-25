// Text-to-pay in the database: a link for an open checkout (front of
// house), completed by the service role as the sender (the sale, the
// tips, the visit checked out, the payment marked as taken online), once
// only, never after it expires, and canceled if the desk takes payment.
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { linkSnapshot, linkTotal, type LinkSnapshot } from "@/lib/payment-links";
import { EMPTY_TICKET, type Ticket } from "@/lib/ticket";
import { testProvider } from "@/lib/payments/test-provider";
import { admin, SEED, signIn, throwawayStylist, type Client } from "./helpers";

// payLink learns from the visit after the response; nothing to do here.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => {} }));
const { payLink } = await import("@/app/pay/[token]/actions");

const B = SEED.business;
const L = SEED.location;
// The visits are checked in now, when the demo calendar is busy: each gets
// a stylist of its own, called Bridget on the ticket.
const stylists: Awaited<ReturnType<typeof throwawayStylist>>[] = [];
const TAG = `Pl${Date.now().toString(36)}`;

let frontDesk: Client;
let stylist: Client;
const clients: string[] = [];

// A checked-in $100 cut with Bridget, and its open checkout with a ticket.
async function checkout() {
  const own = await throwawayStylist("Bridget");
  stylists.push(own);
  const BRIDGET = own.id;
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Pia`, last_name: "Test", phone: "(312) 555-0199" }).select("id").single();
  clients.push(c!.id);
  const { data: cut } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single();
  const start = new Date(Date.now() - 3_600_000);
  const end = new Date(start.getTime() + 3_600_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: c!.id, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "checked_in" }).select("id").single();
  const { data: item } = await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: cut!.id, staff_id: BRIDGET, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: 10000 })
    .select("id")
    .single();
  const ticket: Ticket = {
    ...EMPTY_TICKET,
    lines: [{ key: "k", kind: "service", appointmentItemId: item!.id, serviceId: cut!.id, name: "Women's Cut & Style", staffId: BRIDGET, unitPriceCents: 10000, basePriceCents: 10000, priceReason: "", quantity: 1, discount: null, packageItemId: null }],
  };
  const { data: draft, error } = await frontDesk.from("sale_drafts").insert({ business_id: B, location_id: L, appointment_id: a!.id, client_id: c!.id, ticket: ticket as never, created_by: SEED.staff.frontDesk }).select("id").single();
  expect(error).toBeNull();
  const { data: b } = await admin.from("businesses").select("tax_rate_services_bp, tax_rate_retail_bp").eq("id", B).single();
  const snapshot = linkSnapshot(ticket, { taxServicesBp: b!.tax_rate_services_bp ?? 0, taxRetailBp: b!.tax_rate_retail_bp ?? 0, member: null }, { appointmentId: a!.id, clientId: c!.id }, [{ id: BRIDGET, firstName: "Bridget" }], "Pia") as LinkSnapshot;
  return { appointmentId: a!.id, draftId: draft!.id, snapshot, BRIDGET };
}

async function send(c: Client, draftId: string, snapshot: LinkSnapshot) {
  const token = randomBytes(24).toString("base64url");
  const r = await c.rpc("create_payment_link", { p_draft_id: draftId, p_token_hash: createHash("sha256").update(token).digest("hex"), p_snapshot: snapshot as never, p_amount_cents: snapshot.dueCents, p_channel: "sms", p_to: "(312) 555-0199", p_hours: 24 });
  return { ...r, token };
}

beforeAll(async () => {
  [frontDesk, stylist] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test")]);
});

afterAll(async () => {
  for (const c of clients) {
    await admin.from("sales").delete().eq("client_id", c);
    await admin.from("appointments").delete().eq("client_id", c);
  }
  await admin.from("clients").delete().in("id", clients);
  for (const s of stylists) await s.remove();
});

describe("payment links", () => {
  it("are sent by the front of house, for an open checkout, one open at a time", async () => {
    const { draftId, snapshot } = await checkout();
    expect((await send(stylist, draftId, snapshot)).error?.code).toBe("42501");
    const first = await send(frontDesk, draftId, snapshot);
    expect(first.error).toBeNull();
    const second = await send(frontDesk, draftId, snapshot);
    const { data: links } = await admin.from("payment_links").select("id, status").eq("draft_id", draftId).order("created_at");
    expect(links!.map((l) => l.status)).toEqual(["canceled", "open"]);
    expect(links![1].id).toBe(second.data);
    // Only the token's hash is kept.
    expect((await admin.from("payment_links").select("token_hash").eq("id", second.data!).single()).data!.token_hash).toBe(createHash("sha256").update(second.token).digest("hex"));
    // Nobody completes one but the service role.
    expect((await frontDesk.rpc("complete_payment_link", { p_link_id: second.data!, p_tips: [], p_total_cents: snapshot.dueCents, p_provider: "test", p_reference: "x" })).error).not.toBeNull();
  });

  it("completes the sale when paid, as the sender: tips, the visit checked out, the card taken online; once only", async () => {
    const { appointmentId, draftId, snapshot, BRIDGET } = await checkout();
    const { data: linkId } = await send(frontDesk, draftId, snapshot);
    const tips = [{ staff_id: BRIDGET, amount_cents: 2000 }];
    const { data: saleId, error } = await admin.rpc("complete_payment_link", { p_link_id: linkId!, p_tips: tips as never, p_total_cents: linkTotal(snapshot, tips), p_provider: "test", p_reference: "test_ch_abc" });
    expect(error).toBeNull();
    const { data: sale } = await admin.from("sales").select("total_cents, tip_cents, created_by, draft_id, payments(method, amount_cents, processor, processor_reference, reference), sale_tips(staff_id, amount_cents)").eq("id", saleId!).single();
    expect(sale).toMatchObject({
      total_cents: snapshot.dueCents + 2000,
      tip_cents: 2000,
      created_by: SEED.staff.frontDesk,
      draft_id: draftId,
      payments: [{ method: "card", amount_cents: snapshot.dueCents + 2000, processor: "test", processor_reference: "test_ch_abc", reference: "Payment link" }],
      sale_tips: [{ staff_id: BRIDGET, amount_cents: 2000 }],
    });
    expect((await admin.from("appointments").select("status").eq("id", appointmentId).single()).data!.status).toBe("completed");
    expect((await admin.from("payment_links").select("status, sale_id, tip_cents").eq("id", linkId!).single()).data).toEqual({ status: "paid", sale_id: saleId, tip_cents: 2000 });
    const again = await admin.rpc("complete_payment_link", { p_link_id: linkId!, p_tips: [] as never, p_total_cents: snapshot.dueCents, p_provider: "test", p_reference: "test_ch_def" });
    expect(again.error?.hint).toBe("used");
  });

  it("won't complete after it expires, or with the wrong amount (nothing is saved)", async () => {
    const { draftId, snapshot } = await checkout();
    const { data: linkId } = await send(frontDesk, draftId, snapshot);
    const wrong = await admin.rpc("complete_payment_link", { p_link_id: linkId!, p_tips: [] as never, p_total_cents: snapshot.dueCents + 1, p_provider: "test", p_reference: "x" });
    expect(wrong.error?.message).toBe("Payments don't add up to the total");
    expect((await admin.from("payment_links").select("status").eq("id", linkId!).single()).data!.status).toBe("open");
    await admin.from("payment_links").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", linkId!);
    expect((await admin.rpc("complete_payment_link", { p_link_id: linkId!, p_tips: [] as never, p_total_cents: snapshot.dueCents, p_provider: "test", p_reference: "x" })).error?.hint).toBe("expired");
  });

  it("stops working when the desk takes payment instead", async () => {
    const { draftId, snapshot, appointmentId } = await checkout();
    const { data: linkId } = await send(frontDesk, draftId, snapshot);
    const { error } = await frontDesk.rpc("complete_sale", {
      p_location_id: L,
      p_input: { ...snapshot.input, appointment_id: appointmentId, draft_id: draftId, payments: [{ method: "card", amount_cents: snapshot.dueCents }] } as never,
    });
    expect(error).toBeNull();
    expect((await admin.from("payment_links").select("status").eq("id", linkId!).single()).data!.status).toBe("canceled");
    expect((await admin.rpc("complete_payment_link", { p_link_id: linkId!, p_tips: [] as never, p_total_cents: snapshot.dueCents, p_provider: "test", p_reference: "x" })).error?.hint).toBe("used");
  });

  it("paid twice at once (two tabs), charges once and never refunds the payment that went through", async () => {
    const { draftId, snapshot } = await checkout();
    const { data: linkId, token } = await send(frontDesk, draftId, snapshot);
    const refund = vi.spyOn(testProvider, "refund");
    const results = await Promise.all([payLink(token, {}, "test_visa_4242"), payLink(token, {}, "test_visa_4242")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const { data: link } = await admin.from("payment_links").select("status, provider_reference").eq("id", linkId!).single();
    expect(link!.status).toBe("paid");
    expect(refund).not.toHaveBeenCalledWith(link!.provider_reference);
    refund.mockRestore();
  });
});
