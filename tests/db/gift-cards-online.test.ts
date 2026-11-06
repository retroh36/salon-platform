// Gift cards in a client's online account: adding one by code (refused for
// unknown, voided, expired and empty cards alike, and for one in someone
// else's account) and reloading one they hold, recorded once per charge.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, signIn, SEED } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const PREFIX = `Go${Date.now().toString(36)}`.toUpperCase();
let me: string;
let other: string;
const cards: Record<string, string> = {};
const sales: string[] = [];

const add = (code: string, client = me) => admin.rpc("add_account_gift_card", { p_business_id: B, p_client_id: client, p_code: code }).single();
const reload = (card: string, reference: string, client = me, amount = 2000) =>
  admin.rpc("reload_gift_card_online", {
    p_business_id: B,
    p_location_id: L,
    p_client_id: client,
    p_card_id: card,
    p_amount_cents: amount,
    p_card_label: "Visa …4242",
    p_provider: "test",
    p_reference: reference,
  });

beforeAll(async () => {
  const { data } = await admin
    .from("clients")
    .insert([
      { business_id: B, first_name: `${PREFIX}Me`, last_name: "Test" },
      { business_id: B, first_name: `${PREFIX}Other`, last_name: "Test" },
    ])
    .select("id");
  [me, other] = data!.map((c) => c.id);
  const base = { business_id: B, kind: "purchased" as "purchased" | "promotional", initial_cents: 3000, balance_cents: 3000, physical: true };
  const rows = {
    loose: base,
    theirs: { ...base, client_id: other },
    voided: { ...base, status: "voided" as const },
    expired: { ...base, expires_at: new Date(Date.now() - 86_400_000).toISOString() },
    empty: { ...base, balance_cents: 0 },
    promo: { ...base, kind: "promotional" as const, physical: false },
  };
  for (const [name, row] of Object.entries(rows)) {
    const { data: card, error } = await admin.from("gift_cards").insert({ ...row, code: `${PREFIX}${name}`.toUpperCase().padEnd(8, "X") }).select("id").single();
    if (error) throw error;
    cards[name] = card!.id;
  }
});

afterAll(async () => {
  await admin.from("sales").delete().in("id", sales);
  await admin.from("gift_card_events").delete().in("card_id", Object.values(cards));
  await admin.from("gift_cards").delete().in("id", Object.values(cards));
  await admin.from("clients").delete().in("id", [me, other]);
});

const code = (name: string) => `${PREFIX}${name}`.toUpperCase().padEnd(8, "X");

describe("adding a gift card by its code", () => {
  it("gives one answer for unknown, voided, expired and empty cards", async () => {
    for (const c of [`${PREFIX}NOPE0000`, code("voided"), code("expired"), code("empty")]) {
      expect((await add(c)).error?.hint).toBe("not_found");
    }
  });

  it("refuses a card in someone else's account, and adds one in nobody's (again is fine)", async () => {
    expect((await add(code("theirs"))).error?.hint).toBe("taken");
    expect((await add(code("loose").toLowerCase())).data).toEqual({ card_id: cards.loose, balance_cents: 3000 });
    expect((await add(code("loose"))).error).toBeNull();
    expect((await add(code("loose"), other)).error?.hint).toBe("taken");
    const { data: card } = await admin.from("gift_cards").select("holder_client_id, owner_client_id").eq("id", cards.loose).single();
    expect(card).toEqual({ holder_client_id: me, owner_client_id: me });
    const { count } = await admin.from("gift_card_events").select("id", { count: "exact", head: true }).eq("card_id", cards.loose).eq("kind", "added");
    expect(count).toBe(1);
  });

  it("is only for the booking site's server", async () => {
    const staff = await signIn("frontdesk@mapleandash.test");
    expect((await staff.rpc("add_account_gift_card", { p_business_id: B, p_client_id: me, p_code: code("loose") })).error).not.toBeNull();
  });
});

describe("reloading a card online", () => {
  it("records a sale paid by card online, once per charge", async () => {
    const reference = `test_${PREFIX}_1`;
    const first = await reload(cards.loose, reference);
    expect(first.error).toBeNull();
    sales.push(first.data!);
    const again = await reload(cards.loose, reference);
    expect(again.data).toBe(first.data);
    const { data: card } = await admin.from("gift_cards").select("balance_cents").eq("id", cards.loose).single();
    expect(card!.balance_cents).toBe(5000);
    const { data: sale } = await admin.from("sales").select("total_cents, client_id, payments(method, processor, processor_reference)").eq("id", first.data!).single();
    expect(sale).toEqual({ total_cents: 2000, client_id: me, payments: [{ method: "card", processor: "test", processor_reference: reference }] });
  });

  it("refuses a card that isn't theirs, promotional credit and amounts out of range", async () => {
    expect((await reload(cards.theirs, `test_${PREFIX}_2`)).error).not.toBeNull();
    await add(code("promo"));
    expect((await reload(cards.promo, `test_${PREFIX}_3`)).error?.hint).toBe("not_reloadable");
    expect((await reload(cards.loose, `test_${PREFIX}_4`, me, 400)).error).not.toBeNull();
  });
});
