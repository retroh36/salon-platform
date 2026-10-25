// Promotions in the database (migration …_promotions.sql): complete_sale
// takes them off after member prices and before staff discounts, exactly
// as lib/ticket.ts works it out; total and per-client limits, new clients
// and first visits, minimum spend, stacking, last-minute specials and
// their exclusions; voids give the use back; online bookings hold a use;
// and specials go only to clients who said yes, within the rules. All
// with promotions and clients of our own.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promoRatesFor } from "@/lib/promotions-load";
import { todayIn } from "@/lib/scheduling/time";
import { EMPTY_TICKET, saleInput, totalsOf, type Ticket, type TicketLine } from "@/lib/ticket";
import { admin, SEED, signIn, throwawayStylist, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const TAG = `Pr${Date.now().toString(36)}`.toUpperCase();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

let owner: Client;
let manager: Client;
let frontDesk: Client;
let stylist: Client;
let cutId: string;
let colorId: string;
let productId: string;
const clients: string[] = [];
const promos: string[] = [];

async function client(name: string, extra: Record<string, unknown> = {}) {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}${name}`, last_name: "Test", ...extra }).select("id").single();
  clients.push(data!.id);
  return data!.id;
}

async function promo(name: string, input: Record<string, unknown>) {
  const { data, error } = await owner.rpc("save_promotion", {
    p_business_id: B,
    p_promotion_id: null as never,
    p_input: { name: `${TAG} ${name}`, kind: "code", discount_kind: "percent", applies_services: true, applies_retail: false, online: true, stackable: false, ...input } as never,
  });
  expect(error).toBeNull();
  promos.push(data as string);
  return data as string;
}

let n = 0;
const service = (staffId: string, cents = 10_000, serviceId = cutId): TicketLine => ({
  key: `s${++n}`,
  kind: "service",
  appointmentItemId: null,
  serviceId,
  name: "Service",
  staffId,
  unitPriceCents: cents,
  basePriceCents: cents,
  priceReason: "Test price",
  quantity: 1,
  discount: null,
  packageItemId: null,
});
const product = (quantity = 1): TicketLine => ({ key: `p${++n}`, kind: "product", productId, name: "Shine", staffId: null, unitPriceCents: 2000, quantity, discount: null });

// Sells a ticket, paying what lib/ticket.ts says it comes to; the database
// must agree to the cent.
async function sell(c: Client, clientId: string | null, lines: TicketLine[], promotions: string[], over: Partial<Ticket> = {}, appointmentId: string | null = null) {
  const today = todayIn(TZ);
  const promo = await promoRatesFor(admin, { businessId: B, timezone: TZ, today, clientId, appointmentId });
  const ticket: Ticket = { ...EMPTY_TICKET, lines, promotions, ...over };
  const totals = totalsOf(ticket, { taxServicesBp: 0, taxRetailBp: 1025, promo });
  const input = { ...saleInput(ticket, { draftId: "", appointmentId, clientId }), payments: [{ method: "card", amount_cents: totals.totalCents }] };
  const { data, error } = await c.rpc("complete_sale", { p_location_id: L, p_input: input as never });
  return { saleId: data as string | null, error, totals };
}

beforeAll(async () => {
  [owner, manager, frontDesk, stylist] = await Promise.all(["owner", "manager", "frontdesk", "bridget"].map((u) => signIn(`${u}@mapleandash.test`)));
  cutId = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single()).data!.id;
  colorId = (await admin.from("services").select("id").eq("business_id", B).eq("name", "All-Over Color").single()).data!.id;
  const { data: p } = await admin
    .from("products")
    .insert({ business_id: B, brand: TAG, name: "Shine", sku: `${TAG}-S`, type: "retail", unit: "unit", size: 1, cost_cents: 800, price_cents: 2000 })
    .select("id")
    .single();
  productId = p!.id;
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: productId, on_hand: 100 });
});

// Stylists of the last-minute specials' own visits.
const stylists: Awaited<ReturnType<typeof throwawayStylist>>[] = [];

afterAll(async () => {
  await admin.from("appointments").delete().in("client_id", clients);
  await admin.from("sales").delete().in("client_id", clients);
  await admin.from("promotions").delete().in("id", promos);
  await admin.from("clients").delete().in("id", clients);
  await admin.from("stock_levels").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
  for (const st of stylists) await st.remove();
});

describe("setting them up", () => {
  it("is for owners and managers, with unique codes", async () => {
    const input = { name: `${TAG} Nope`, kind: "code", code: `${TAG}X`, discount_kind: "percent", percent: 10 };
    expect((await frontDesk.rpc("save_promotion", { p_business_id: B, p_promotion_id: null as never, p_input: input as never })).error?.code).toBe("42501");
    expect((await stylist.rpc("save_promotion", { p_business_id: B, p_promotion_id: null as never, p_input: input as never })).error?.code).toBe("42501");
    const { data: id, error } = await manager.rpc("save_promotion", { p_business_id: B, p_promotion_id: null as never, p_input: input as never });
    expect(error).toBeNull();
    promos.push(id as string);
    expect((await owner.rpc("save_promotion", { p_business_id: B, p_promotion_id: null as never, p_input: { ...input, name: "Twin" } as never })).error?.code).toBe("23505");
    // Ending one frees its code.
    expect((await manager.rpc("archive_promotion", { p_promotion_id: id as string })).error).toBeNull();
  });
});

describe("at checkout", () => {
  it("takes a percent off what it covers, matching the screen to the cent, and records who applied it", async () => {
    const id = await promo("Pct", { code: `${TAG}P15`, percent: 15 });
    const c = await client("Pct");
    const { saleId, error, totals } = await sell(frontDesk, c, [service(SEED.staff.hannah, 8_500), product()], [id]);
    expect(error).toBeNull();
    expect(totals.promoDiscountCents).toBe(1275);
    const { data: sale } = await admin.from("sales").select("total_cents, discount_cents").eq("id", saleId!).single();
    expect(sale).toEqual({ total_cents: totals.totalCents, discount_cents: 1275 });
    const { data: items } = await admin.from("sale_items").select("kind, promo_discount_cents, line_discount_reason").eq("sale_id", saleId!).order("position");
    expect(items).toEqual([
      { kind: "service", promo_discount_cents: 1275, line_discount_reason: `${TAG} Pct` },
      { kind: "product", promo_discount_cents: 0, line_discount_reason: null },
    ]);
    const { data: r } = await admin.from("promotion_redemptions").select("source, discount_cents, applied_by, first_visit").eq("sale_id", saleId!).single();
    expect(r).toEqual({ source: "code", discount_cents: 1275, applied_by: SEED.staff.frontDesk, first_visit: true });
  });

  it("spreads an amount off over the lines it covers, in order", async () => {
    const id = await promo("Amt", { code: `${TAG}A30`, discount_kind: "amount", amount_cents: 3000, applies_retail: true });
    const { saleId, error, totals } = await sell(frontDesk, null, [product(), service(SEED.staff.hannah, 2_500)], [id]);
    expect(error).toBeNull();
    expect(totals.promoDiscountCents).toBe(3000);
    const { data: items } = await admin.from("sale_items").select("promo_discount_cents, total_cents").eq("sale_id", saleId!).order("position");
    expect(items!.map((i) => i.promo_discount_cents)).toEqual([2000, 1000]);
    expect((await admin.from("sales").select("total_cents").eq("id", saleId!).single()).data!.total_cents).toBe(totals.totalCents);
  });

  it("keeps to the total and per-client limits, and a void gives the use back", async () => {
    const once = await promo("Once", { code: `${TAG}ONE`, percent: 10, max_uses: 1 });
    const [a, b] = [await client("LimA"), await client("LimB")];
    const first = await sell(frontDesk, a, [service(SEED.staff.hannah)], [once]);
    expect(first.error).toBeNull();
    const again = await sell(frontDesk, b, [service(SEED.staff.hannah)], [once]);
    expect(again.error).toMatchObject({ hint: "promotion", message: `${TAG} Once has been used as many times as it can be.` });
    expect((await manager.rpc("void_sale", { p_sale_id: first.saleId!, p_reason: "Wrong client" })).error).toBeNull();
    expect((await sell(frontDesk, b, [service(SEED.staff.hannah)], [once])).error).toBeNull();

    const perClient = await promo("PerClient", { code: `${TAG}PC1`, percent: 10, max_uses_per_client: 1 });
    expect((await sell(frontDesk, a, [service(SEED.staff.hannah)], [perClient])).error).toBeNull();
    expect((await sell(frontDesk, a, [service(SEED.staff.hannah)], [perClient])).error?.message).toBe(`This client has already used ${TAG} PerClient.`);
    expect((await sell(frontDesk, b, [service(SEED.staff.hannah)], [perClient])).error).toBeNull();
    // Per client needs a client.
    expect((await sell(frontDesk, null, [service(SEED.staff.hannah)], [perClient])).error?.message).toBe(`${TAG} PerClient needs a client on the sale.`);
  });

  it("is only for new clients or a first visit when it says so", async () => {
    const today = todayIn(TZ);
    const fresh = await promo("New", { code: `${TAG}NEW`, percent: 20, new_clients_only: true, starts_on: today, first_visit_only: true });
    const old = await client("Old", { created_at: new Date(Date.now() - 90 * 86_400_000).toISOString() });
    expect((await sell(frontDesk, old, [service(SEED.staff.hannah)], [fresh])).error?.message).toBe(`${TAG} New is for new clients only.`);
    const brandNew = await client("New");
    const ok = await sell(frontDesk, brandNew, [service(SEED.staff.hannah)], [fresh]);
    expect(ok.error).toBeNull();
    // Their first visit is done: a visit after it isn't their first.
    const visited = await client("Visited");
    await admin.from("appointments").insert({
      business_id: B, location_id: L, client_id: visited, status: "completed",
      starts_at: new Date(Date.now() - 86_400_000).toISOString(), ends_at: new Date(Date.now() - 86_400_000 + 3_600_000).toISOString(),
      checked_in_at: new Date(Date.now() - 86_400_000).toISOString(), checked_out_at: new Date(Date.now() - 86_400_000 + 3_600_000).toISOString(),
    });
    expect((await sell(frontDesk, visited, [service(SEED.staff.hannah)], [fresh])).error?.message).toBe(`${TAG} New is for a client's first visit only.`);
  });

  it("needs its minimum spend", async () => {
    const id = await promo("Min", { kind: "automatic", discount_kind: "amount", amount_cents: 1000, applies_services: false, applies_retail: true, min_spend_cents: 6000, stackable: true });
    expect((await sell(frontDesk, null, [product(2)], [id])).error?.message).toBe(`${TAG} Min needs a spend of $60 or more.`);
    const { error, totals } = await sell(frontDesk, null, [product(3)], [id]);
    expect(error).toBeNull();
    expect(totals.promoDiscountCents).toBe(1000);
  });

  it("doesn't stack unless every promotion allows it", async () => {
    const alone = await promo("Alone", { code: `${TAG}AL`, percent: 10 });
    const s1 = await promo("Stack1", { code: `${TAG}S1`, percent: 10, stackable: true });
    const s2 = await promo("Stack2", { code: `${TAG}S2`, discount_kind: "amount", amount_cents: 500, stackable: true });
    expect((await sell(frontDesk, null, [service(SEED.staff.hannah)], [alone, s1])).error?.message).toBe(`${TAG} Alone can't be used with another promotion`);
    // Nor with a discount staff give.
    const discounted = { ...service(SEED.staff.hannah), discount: { kind: "percent" as const, value: 5, reason: "Loyalty" } };
    expect((await sell(frontDesk, null, [discounted], [alone])).error?.message).toBe(`${TAG} Alone can't be used with another discount`);
    // Two that allow it: the second on what's left of the first.
    const { error, totals } = await sell(frontDesk, null, [service(SEED.staff.hannah, 10_000)], [s1, s2]);
    expect(error).toBeNull();
    expect(totals.promoDiscountCents).toBe(1000 + 500);
    // And the same one twice is refused.
    expect((await sell(frontDesk, null, [service(SEED.staff.hannah)], [s1, s1])).error?.message).toBe("That promotion is already on the sale");
  });
});

describe("last-minute specials", () => {
  // Checked in two hours from now, when the demo calendar is busy: each with
  // a stylist of its own at that level (Gil is Master, Lois Senior).
  async function visit(clientId: string, level: "senior" | "master", serviceId: string, bookedHoursAhead: number) {
    const own = await throwawayStylist(level === "master" ? "Gil" : "Lois", level);
    stylists.push(own);
    const staffId = own.id;
    const start = new Date(Date.now() + 2 * 3_600_000);
    const { data: a } = await admin
      .from("appointments")
      .insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString(), status: "checked_in", created_at: new Date(start.getTime() - bookedHoursAhead * 3_600_000).toISOString() })
      .select("id")
      .single();
    const { data: item } = await admin
      .from("appointment_items")
      .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: serviceId, staff_id: staffId, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString(), active_minutes: 60, price_cents: 12_000 })
      .select("id")
      .single();
    return { appointmentId: a!.id, itemId: item!.id, staffId };
  }
  const line = (v: { itemId: string; staffId: string }, serviceId: string): TicketLine => ({ ...(service(v.staffId, 12_000, serviceId) as Extract<TicketLine, { kind: "service" }>), appointmentItemId: v.itemId, priceReason: "" });

  it("covers visits booked within its hours, never Master color", async () => {
    const special = await promo("Late", { kind: "last_minute", hours_ahead: 48, percent: 15, exclusions: [{ level: "master", category: "Color" }] });
    // Master (Gil) color: not covered.
    const c1 = await client("Spec1");
    const v1 = await visit(c1, "master", colorId, 3);
    expect((await sell(frontDesk, c1, [line(v1, colorId)], [special], {}, v1.appointmentId)).error?.message).toBe(`${TAG} Late doesn't cover anything on this sale`);
    // Senior (Lois) color, booked 3 hours ahead: 15% off.
    const c2 = await client("Spec2");
    const v2 = await visit(c2, "senior", colorId, 3);
    const ok = await sell(frontDesk, c2, [line(v2, colorId)], [special], {}, v2.appointmentId);
    expect(ok.error).toBeNull();
    expect(ok.totals.promoDiscountCents).toBe(1800);
    const { data: r } = await admin.from("promotion_redemptions").select("source, last_minute").eq("sale_id", ok.saleId!).single();
    expect(r).toEqual({ source: "special", last_minute: true });
    // Booked three days ahead: not last minute.
    const c3 = await client("Spec3");
    const v3 = await visit(c3, "senior", cutId, 72);
    expect((await sell(frontDesk, c3, [line(v3, cutId)], [special], {}, v3.appointmentId)).error?.message).toBe(`${TAG} Late is for visits booked within 48 hours of starting.`);
  });

  it("from online booking: held on the visit, counted in the limits, and taken off at checkout", async () => {
    const id = await promo("Online", { code: `${TAG}WEB`, percent: 10, max_uses: 1 });
    const c = await client("Web");
    const v = await visit(c, "senior", cutId, 1);
    expect((await frontDesk.rpc("attach_online_promotion", { p_appointment_id: v.appointmentId, p_promotion_id: id })).error).not.toBeNull();
    expect((await admin.rpc("attach_online_promotion", { p_appointment_id: v.appointmentId, p_promotion_id: id })).error).toBeNull();
    // The visit holds the only use.
    expect((await sell(frontDesk, null, [service(SEED.staff.hannah)], [id])).error?.hint).toBe("promotion");
    const done = await sell(frontDesk, c, [line(v, cutId)], [id], {}, v.appointmentId);
    expect(done.error).toBeNull();
    expect((await admin.from("promotion_redemptions").select("source").eq("sale_id", done.saleId!).single()).data!.source).toBe("online");
  });
});

describe("sending a special", () => {
  it("only to clients who said yes, within sending hours, one offer a week", async () => {
    const id = await promo("Send", { kind: "last_minute", hours_ahead: 48, percent: 15 });
    const other = await promo("Send2", { kind: "last_minute", hours_ahead: 24, percent: 10 });
    const no = await client("NoOffers", { email: `${TAG.toLowerCase()}no@example.com`, email_opt_in: false });
    const yes = await client("YesOffers", { email: `${TAG.toLowerCase()}yes@example.com`, email_opt_in: true });
    const send = (c: Client, clientId: string, promotionId = id, template = "special") =>
      c.rpc("send_promotion_message", { p_promotion_id: promotionId, p_client_id: clientId, p_channel: "email", p_template: template, p_subject: "An opening", p_body: "Hi, we have an opening.", p_opt_out_hash: hash(`${clientId}${promotionId}${Math.random()}`) });
    expect((await stylist.rpc("send_promotion_message", { p_promotion_id: id, p_client_id: yes, p_channel: "email", p_template: "special", p_subject: "x", p_body: "x", p_opt_out_hash: hash("x") })).error?.code).toBe("42501");
    expect((await send(frontDesk, no)).error?.hint).toBe("channel");
    const minute = (() => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
      return Number(parts.find((p) => p.type === "hour")!.value) * 60 + Number(parts.find((p) => p.type === "minute")!.value);
    })();
    const first = await send(frontDesk, yes);
    if (minute < 9 * 60 || minute >= 20 * 60) {
      expect(first.error?.hint).toBe("hours");
      return;
    }
    expect(first.error).toBeNull();
    const { data: m } = await admin.from("client_messages").select("template, purpose, sent_by, promotion_id").eq("id", first.data as string).single();
    expect(m).toEqual({ template: "special", purpose: "marketing", sent_by: SEED.staff.frontDesk, promotion_id: id });
    // Another offer the same week: no.
    expect((await send(frontDesk, yes, other)).error?.hint).toBe("quiet");
    // A week on, this one still only once.
    await admin.from("marketing_messages").update({ sent_at: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq("client_id", yes);
    expect((await send(frontDesk, yes)).error?.hint).toBe("sent");
    expect((await send(frontDesk, yes, other)).error).toBeNull();
  });
});
