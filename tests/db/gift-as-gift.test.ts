// "This is a gift": a gift card sold as a gift is in no client's account
// until it's used, then only in the account of the client who used it.
// Staff always see it. A card that isn't a gift stays the buyer's.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAccount } from "@/lib/online-booking/account-data";
import { admin, type Client, SEED, signIn } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const PREFIX = `Gg${Date.now().toString(36)}`;
let frontDesk: Client;
let buyer: string;
let friend: string;
let productId: string;
// A $20 product with the salon's 10.25% tax.
let productTotal: number;
const sales: string[] = [];
const cards: string[] = [];

async function sell(input: Record<string, unknown>) {
  const { data, error } = await frontDesk.rpc("complete_sale", { p_location_id: L, p_input: input as never });
  if (error) throw error;
  sales.push(data);
  return data;
}

async function buyCard(code: string, isGift: boolean) {
  const saleId = await sell({ client_id: buyer, lines: [{ kind: "gift_card", amount_cents: 10000, code, is_gift: isGift }], payments: [{ method: "card", amount_cents: 10000 }] });
  const { data } = await admin.from("gift_cards").select("id, code, is_gift, client_id, holder_client_id, owner_client_id").eq("sale_id", saleId).single();
  cards.push(data!.id);
  return data!;
}

// Buys the product with the card, for a client or a walk-in.
const spend = (code: string, clientId: string | null) =>
  sell({ client_id: clientId, lines: [{ kind: "product", product_id: productId, quantity: 1 }], payments: [{ method: "gift_card", amount_cents: productTotal, code }] });

const card = async (id: string) => (await admin.from("gift_cards").select("holder_client_id, owner_client_id").eq("id", id).single()).data!;
const accountCards = async (clientId: string) =>
  (await loadAccount(admin, { accountId: "test", clientId, businessId: B, firstName: "Test" })).giftCards.map((g) => g.last4);

beforeAll(async () => {
  frontDesk = await signIn("frontdesk@mapleandash.test");
  const { data } = await admin
    .from("clients")
    .insert([
      { business_id: B, first_name: `${PREFIX}Buyer`, last_name: "Test" },
      { business_id: B, first_name: `${PREFIX}Friend`, last_name: "Test" },
    ])
    .select("id");
  [buyer, friend] = data!.map((c) => c.id);
  const { data: p } = await admin.from("products").insert({ business_id: B, brand: PREFIX, name: "Spray", type: "retail", unit: "unit", size: 1, cost_cents: 500, price_cents: 2000 }).select("id").single();
  productId = p!.id;
  await admin.from("stock_levels").insert({ business_id: B, location_id: L, product_id: productId, on_hand: 10 });
  const { data: b } = await admin.from("businesses").select("tax_rate_retail_bp").eq("id", B).single();
  productTotal = 2000 + Math.round((2000 * b!.tax_rate_retail_bp) / 10000);
});

afterAll(async () => {
  for (const id of sales) await admin.from("sales").delete().eq("id", id);
  for (const id of cards) {
    await admin.from("gift_card_events").delete().eq("card_id", id);
    await admin.from("gift_cards").delete().eq("id", id);
  }
  await admin.from("stock_movements").delete().eq("product_id", productId);
  await admin.from("stock_levels").delete().eq("product_id", productId);
  await admin.from("products").delete().eq("id", productId);
  await admin.from("clients").delete().in("id", [buyer, friend]);
});

describe("a gift card sold as a gift", () => {
  it("is in nobody's account until it's used, then only the account of the client who used it", async () => {
    const gift = await buyCard(`${PREFIX}GIFT01`.toUpperCase(), true);
    expect(gift).toMatchObject({ is_gift: true, client_id: buyer, holder_client_id: null, owner_client_id: null });
    expect(await accountCards(buyer)).not.toContain(gift.code.slice(-4));

    // A walk-in using it makes nobody its holder.
    await spend(gift.code, null);
    expect(await card(gift.id)).toEqual({ holder_client_id: null, owner_client_id: null });

    // The friend using it does, and from then on it's theirs.
    await spend(gift.code, friend);
    expect(await card(gift.id)).toEqual({ holder_client_id: friend, owner_client_id: friend });
    await spend(gift.code, buyer);
    expect(await card(gift.id)).toEqual({ holder_client_id: friend, owner_client_id: friend });
    expect(await accountCards(friend)).toContain(gift.code.slice(-4));
    expect(await accountCards(buyer)).not.toContain(gift.code.slice(-4));
  });

  it("isn't how other cards work: those stay the buyer's", async () => {
    const own = await buyCard(`${PREFIX}OWN001`.toUpperCase(), false);
    expect(own).toMatchObject({ is_gift: false, owner_client_id: buyer });
    await spend(own.code, friend);
    expect(await card(own.id)).toEqual({ holder_client_id: null, owner_client_id: buyer });
    expect(await accountCards(buyer)).toContain(own.code.slice(-4));
  });
});
