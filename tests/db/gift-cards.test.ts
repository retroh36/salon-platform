// Gift cards in the database: selling (digital and physical), codes,
// partial redemption, reloads, promotional cards, refunds and voids, lookups
// (logged and rate-limited), and who may do what.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const PREFIX = `Gc${Date.now().toString(36)}`;

let frontDesk: Client;
let manager: Client;
let stylist: Client;
let product: { id: string; price: number };
const sales: string[] = [];
const cards: string[] = [];

beforeAll(async () => {
  [frontDesk, manager, stylist] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  const { data: p } = await admin.from("products").select("id, price_cents").eq("business_id", B).eq("type", "retail").eq("is_active", true).order("sku").limit(1).single();
  product = { id: p!.id, price: p!.price_cents! };
  await admin.from("businesses").update({ tax_rate_retail_bp: 0, gift_card_expiry_months: null }).eq("id", B);
});

afterAll(async () => {
  for (const id of sales) await admin.from("sales").delete().eq("id", id);
  await admin.from("gift_cards").delete().in("id", cards);
  await admin.from("gift_cards").delete().like("note", `${PREFIX}%`);
  await admin.from("gift_card_lookups").delete().eq("business_id", B);
  await admin.from("businesses").update({ tax_rate_retail_bp: 1025, gift_card_expiry_months: null }).eq("id", B);
});

async function sell(client: Client, input: Record<string, unknown>) {
  const { data, error } = await client.rpc("complete_sale", { p_location_id: L, p_input: input as never });
  if (data) sales.push(data);
  return { data, error };
}

// A $100 purchased card, sold as a digital card; returns its code.
async function newCard(amount = 10000) {
  const { data: saleId, error } = await sell(frontDesk, { lines: [{ kind: "gift_card", amount_cents: amount, recipient_name: "Ava", recipient_email: "ava@example.com" }], payments: [{ method: "card", amount_cents: amount }] });
  expect(error).toBeNull();
  const { data: card } = await admin.from("gift_cards").select("id, code, balance_cents, physical, expires_at, recipient_email").eq("sale_id", saleId!).single();
  cards.push(card!.id);
  return card!;
}

const balance = async (code: string) => (await admin.from("gift_cards").select("balance_cents").eq("business_id", B).eq("code", code).single()).data!.balance_cents;
const retail = (quantity = 1) => [{ kind: "product", product_id: product.id, quantity }];

describe("selling gift cards", () => {
  it("gives digital cards a 16-character code from letters and digits that can't be mixed up", async () => {
    const card = await newCard();
    expect(card.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{16}$/);
    expect(card).toMatchObject({ balance_cents: 10000, physical: false, expires_at: null, recipient_email: "ava@example.com" });
    const { data: events } = await admin.from("gift_card_events").select("kind, amount_cents, balance_after").eq("card_id", card.id);
    expect(events).toEqual([{ kind: "sold", amount_cents: 10000, balance_after: 10000 }]);
    // Untaxed, undiscounted.
    const { data: line } = await admin.from("sale_items").select("kind, tax_cents, discount_cents, gift_card_id").eq("gift_card_id", card.id).single();
    expect(line).toEqual({ kind: "gift_card", tax_cents: 0, discount_cents: 0, gift_card_id: card.id });
  });

  it("keeps a physical card's own code, and refuses one already in use or too short", async () => {
    const code = `${PREFIX}phys`.toUpperCase().slice(0, 14);
    const { error } = await sell(frontDesk, { lines: [{ kind: "gift_card", amount_cents: 5000, code: code.toLowerCase().replace(/(.{4})/g, "$1-") }], payments: [{ method: "cash", amount_cents: 5000 }] });
    expect(error).toBeNull();
    const { data: card } = await admin.from("gift_cards").select("id, code, physical").eq("business_id", B).eq("code", code).single();
    cards.push(card!.id);
    expect(card!.physical).toBe(true);
    expect((await sell(frontDesk, { lines: [{ kind: "gift_card", amount_cents: 5000, code }], payments: [{ method: "cash", amount_cents: 5000 }] })).error?.message).toBe("That gift card code is already in use");
    expect((await sell(frontDesk, { lines: [{ kind: "gift_card", amount_cents: 5000, code: "ABC12" }], payments: [{ method: "cash", amount_cents: 5000 }] })).error?.code).toBe("22023");
    expect((await sell(frontDesk, { lines: [{ kind: "gift_card", amount_cents: 300 }], payments: [{ method: "cash", amount_cents: 300 }] })).error?.message).toBe("A gift card is $5 to $1,000");
  });

  it("expires cards when the salon sets an expiry", async () => {
    await admin.from("businesses").update({ gift_card_expiry_months: 12 }).eq("id", B);
    const card = await newCard(2500);
    await admin.from("businesses").update({ gift_card_expiry_months: null }).eq("id", B);
    const months = (new Date(card.expires_at!).getTime() - Date.now()) / (30.4 * 86_400_000);
    expect(months).toBeGreaterThan(11.5);
    expect(months).toBeLessThan(12.5);
  });
});

describe("redeeming", () => {
  it("covers part of a sale, the rest by card, with the balance left on the card", async () => {
    const card = await newCard(3000);
    const total = product.price * 2;
    const { data: saleId, error } = await sell(frontDesk, { lines: retail(2), payments: [{ method: "gift_card", amount_cents: 1200, code: card.code.toLowerCase() }, { method: "card", amount_cents: total - 1200 }] });
    expect(error).toBeNull();
    expect(await balance(card.code)).toBe(1800);
    const { data: pay } = await admin.from("payments").select("method, amount_cents, reference, gift_card_id").eq("sale_id", saleId!).eq("method", "gift_card").single();
    expect(pay).toEqual({ method: "gift_card", amount_cents: 1200, reference: `…${card.code.slice(-4)}`, gift_card_id: card.id });
    const { data: events } = await admin.from("gift_card_events").select("kind, amount_cents, balance_after, sale_id").eq("card_id", card.id).order("created_at");
    expect(events!.at(-1)).toEqual({ kind: "redeemed", amount_cents: -1200, balance_after: 1800, sale_id: saleId });
  });

  it("refuses more than the balance, expired and voided cards, and buying gift cards with one", async () => {
    const card = await newCard(1000);
    const over = product.price > 1000 ? product.price : 1000 + product.price;
    const lines = product.price > 1000 ? retail(1) : retail(Math.ceil(1001 / product.price));
    const amount = product.price > 1000 ? product.price : product.price * Math.ceil(1001 / product.price);
    void over;
    expect((await sell(frontDesk, { lines, payments: [{ method: "gift_card", amount_cents: amount, code: card.code }] })).error?.message).toBe("Only $10.00 left on that gift card");
    expect((await sell(frontDesk, { lines: [{ kind: "gift_card", amount_cents: 1000 }], payments: [{ method: "gift_card", amount_cents: 1000, code: card.code }] })).error?.message).toBe("Gift cards can't be paid for with a gift card");
    await admin.from("gift_cards").update({ expires_at: new Date(Date.now() - 86_400_000).toISOString() }).eq("id", card.id);
    expect((await sell(frontDesk, { lines: retail(1), payments: [{ method: "gift_card", amount_cents: product.price, code: card.code }] })).error?.message).toBe("That gift card has expired");
    expect((await sell(frontDesk, { lines: retail(1), payments: [{ method: "gift_card", amount_cents: product.price, code: "NOSUCHCARD99" }] })).error?.code).toBe("P0002");
    expect(await balance(card.code)).toBe(1000);
  });

  it("reloads purchased cards", async () => {
    const card = await newCard(2000);
    expect((await sell(frontDesk, { lines: [{ kind: "gift_card_reload", code: card.code, amount_cents: 2500 }], payments: [{ method: "cash", amount_cents: 2500 }] })).error).toBeNull();
    expect(await balance(card.code)).toBe(4500);
  });
});

describe("promotional cards", () => {
  it("are issued by managers, expire, can't be reloaded, and are never refunded as money", async () => {
    expect((await frontDesk.rpc("issue_promo_card", { p_amount_cents: 2000, p_reason: "Referral", p_expires_in_days: 30, p_client_id: null!, p_recipient_name: "", p_recipient_email: "" })).error?.code).toBe("42501");
    const { data: id, error } = await manager.rpc("issue_promo_card", { p_amount_cents: 2000, p_reason: `${PREFIX} Referral`, p_expires_in_days: 30, p_client_id: null!, p_recipient_name: "Bea", p_recipient_email: "" });
    expect(error).toBeNull();
    const { data: promo } = await admin.from("gift_cards").select("code, kind, balance_cents, expires_at").eq("id", id!).single();
    expect(promo).toMatchObject({ kind: "promotional", balance_cents: 2000 });
    expect(new Date(promo!.expires_at!).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await sell(frontDesk, { lines: [{ kind: "gift_card_reload", code: promo!.code, amount_cents: 1000 }], payments: [{ method: "cash", amount_cents: 1000 }] })).error?.message).toBe("Promotional cards can't be reloaded");

    // Spent on retail; refunded: only back onto the card.
    const amount = Math.min(2000, product.price);
    const { data: saleId } = await sell(frontDesk, { lines: retail(1), payments: [{ method: "gift_card", amount_cents: amount, code: promo!.code }, ...(product.price > amount ? [{ method: "card", amount_cents: product.price - amount }] : [])] });
    const refund = (input: Record<string, unknown>) => manager.rpc("refund_sale", { p_sale_id: saleId!, p_input: input as never });
    expect((await refund({ reason: "Returned", payments: [{ method: "cash", amount_cents: product.price }] })).error?.message).toBe("Promotional credit and package uses can't be refunded as cash or card");
    expect((await refund({ reason: "Returned", payments: [{ method: "gift_card", amount_cents: amount, code: promo!.code }] })).error).toBeNull();
    expect(await balance(promo!.code)).toBe(2000);
  });
});

describe("voids, adjustments and history", () => {
  it("a void puts redeemed money back on the card and voids unused cards sold on the sale", async () => {
    const paying = await newCard(5000);
    const { data: saleId } = await sell(frontDesk, { lines: retail(1), payments: [{ method: "gift_card", amount_cents: product.price, code: paying.code }] });
    expect((await manager.rpc("void_sale", { p_sale_id: saleId!, p_reason: "Wrong client" })).error).toBeNull();
    expect(await balance(paying.code)).toBe(5000);

    const sold = await newCard(4000);
    const { data: soldOn } = await admin.from("gift_cards").select("sale_id").eq("id", sold.id).single();
    // Used a little: the sale that sold it can't be voided now.
    expect((await sell(frontDesk, { lines: retail(1), payments: [{ method: "gift_card", amount_cents: product.price, code: sold.code }] })).error).toBeNull();
    expect((await manager.rpc("void_sale", { p_sale_id: soldOn!.sale_id!, p_reason: "Oops" })).error?.code).toBe("55000");
    const unused = await newCard(3000);
    const { data: unusedSale } = await admin.from("gift_cards").select("sale_id").eq("id", unused.id).single();
    expect((await manager.rpc("void_sale", { p_sale_id: unusedSale!.sale_id!, p_reason: "Changed mind" })).error).toBeNull();
    expect((await admin.from("gift_cards").select("status, balance_cents").eq("id", unused.id).single()).data).toEqual({ status: "voided", balance_cents: 0 });
  });

  it("only managers adjust and void cards, with a reason, and every change is in the history", async () => {
    const card = await newCard(5000);
    expect((await frontDesk.rpc("adjust_gift_card", { p_card_id: card.id, p_change_cents: 500, p_reason: "Goodwill" })).error?.code).toBe("42501");
    expect((await manager.rpc("adjust_gift_card", { p_card_id: card.id, p_change_cents: 500, p_reason: "" })).error?.code).toBe("22023");
    expect((await manager.rpc("adjust_gift_card", { p_card_id: card.id, p_change_cents: -6000, p_reason: "Too much" })).error?.message).toBe("Not enough on the gift card");
    expect((await manager.rpc("adjust_gift_card", { p_card_id: card.id, p_change_cents: 500, p_reason: "Goodwill" })).data).toBe(5500);
    expect((await frontDesk.rpc("void_gift_card", { p_card_id: card.id, p_reason: "Lost" })).error?.code).toBe("42501");
    expect((await manager.rpc("void_gift_card", { p_card_id: card.id, p_reason: "Reported stolen" })).error).toBeNull();
    const { data: events } = await admin.from("gift_card_events").select("kind, amount_cents, balance_after, reason").eq("card_id", card.id).order("created_at");
    expect(events).toEqual([
      { kind: "sold", amount_cents: 5000, balance_after: 5000, reason: null },
      { kind: "adjusted", amount_cents: 500, balance_after: 5500, reason: "Goodwill" },
      { kind: "voided", amount_cents: -5500, balance_after: 0, reason: "Reported stolen" },
    ]);
  });
});

describe("lookups and who sees cards", () => {
  it("logs every lookup, limits them, and keeps cards from stylists", async () => {
    const card = await newCard(1500);
    const { data } = await frontDesk.rpc("lookup_gift_card", { p_code: card.code.toLowerCase() });
    expect(data).toMatchObject({ id: card.id, balance_cents: 1500, kind: "purchased", expired: false });
    expect((await frontDesk.rpc("lookup_gift_card", { p_code: "NOTACARD1234" })).data).toBeNull();
    const { data: logged } = await admin.from("gift_card_lookups").select("code_hint, found").eq("staff_id", SEED.staff.frontDesk).order("created_at", { ascending: false }).limit(2);
    expect(logged).toEqual([
      { code_hint: "1234", found: false },
      { code_hint: card.code.slice(-4), found: true },
    ]);
    // 30 in ten minutes is the limit.
    await admin.from("gift_card_lookups").insert(Array.from({ length: 30 }, () => ({ business_id: B, staff_id: SEED.staff.frontDesk, code_hint: "XXXX", found: false })));
    expect((await frontDesk.rpc("lookup_gift_card", { p_code: card.code })).error?.code).toBe("54000");

    expect((await stylist.rpc("lookup_gift_card", { p_code: card.code })).error?.code).toBe("42501");
    expect((await stylist.from("gift_cards").select("id").eq("id", card.id)).data).toEqual([]);
    expect((await frontDesk.from("gift_cards").update({ balance_cents: 999999 }).eq("id", card.id).select()).data).toEqual([]);
    expect(await balance(card.code)).toBe(1500);
  });
});
