// Purchase orders (draft, sent, received), receiving into stock, and
// Denise's reorder drafts. Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { suggestReorders } from "@/lib/denise/reorder";
import { fromLocal, todayIn, addDays } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const RUN = `Ord${Date.now().toString(36)}`;

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let manager: Client;
let frontDesk: Client;
let stylist: Client;
let otherOwner: Client;
let supplier: string;
let tube: string;
let bottle: string;

const save = (client: Client, lines: { product_id: string; quantity: number; unit_cost_cents?: number }[], orderId: string | null = null) =>
  client.rpc("save_purchase_order", { p_order_id: orderId!, p_location_id: L, p_supplier_id: supplier, p_notes: "Test", p_lines: lines });

async function level(productId: string) {
  const { data } = await admin.from("stock_levels").select("on_hand").eq("product_id", productId).eq("location_id", L).maybeSingle();
  return data?.on_hand ?? 0;
}

async function order(id: string) {
  const { data } = await admin.from("purchase_orders").select("status, sent_at, received_at, ai_action_id, purchase_order_lines(id, product_id, quantity, received_quantity, unit_cost_cents)").eq("id", id).maybeSingle();
  return data;
}

beforeAll(async () => {
  other = await createOtherSalon();
  [manager, frontDesk, stylist, otherOwner] = await Promise.all([
    signIn("manager@mapleandash.test"),
    signIn("frontdesk@mapleandash.test"),
    signIn("bridget@mapleandash.test"),
    signIn(other.email),
  ]);
  const { data: s } = await admin.from("suppliers").insert({ business_id: B, name: `${RUN} Supply`, lead_time_days: 2 }).select("id").single();
  supplier = s!.id;
  const { data: p } = await admin
    .from("products")
    .insert([
      { business_id: B, supplier_id: supplier, brand: RUN, line: "Test", name: "7N", type: "back_bar", unit: "g", size: 60, cost_cents: 950 },
      { business_id: B, supplier_id: supplier, brand: RUN, line: "Test", name: "20 Vol", type: "back_bar", unit: "ml", size: 1000, cost_cents: 1400 },
    ])
    .select("id, name");
  tube = p!.find((x) => x.name === "7N")!.id;
  bottle = p!.find((x) => x.name === "20 Vol")!.id;
});

afterEach(async () => {
  await admin.from("purchase_orders").delete().eq("supplier_id", supplier);
  await admin.from("ai_actions").delete().eq("feature", "reorder").like("subject", `reorder:${supplier}:%`);
});

afterAll(async () => {
  await admin.from("stock_movements").delete().in("product_id", [tube, bottle]);
  await admin.from("stock_levels").delete().in("product_id", [tube, bottle]);
  await admin.from("products").delete().eq("brand", RUN);
  await admin.from("suppliers").delete().eq("id", supplier);
  await other?.cleanup();
});

describe("purchase orders", () => {
  it("go from draft to sent to partly received to received, adding stock and recording the cost", async () => {
    const before = { tube: await level(tube), bottle: await level(bottle) };
    const { data: id, error } = await save(manager, [
      { product_id: tube, quantity: 6, unit_cost_cents: 1000 },
      { product_id: bottle, quantity: 2 },
    ]);
    expect(error).toBeNull();
    expect(await order(id!)).toMatchObject({ status: "draft", sent_at: null });
    const lines = (await order(id!))!.purchase_order_lines;
    // The product's cost when none is given.
    expect(lines.find((l) => l.product_id === bottle)!.unit_cost_cents).toBe(1400);

    // A draft can't be received; sending it can.
    expect((await frontDesk.rpc("receive_purchase_order", { p_order_id: id!, p_lines: [] })).error?.code).toBe("55000");
    expect((await frontDesk.rpc("send_purchase_order", { p_order_id: id! })).error?.code).toBe("42501");
    expect((await manager.rpc("send_purchase_order", { p_order_id: id! })).error).toBeNull();
    expect((await save(manager, [{ product_id: tube, quantity: 1 }], id)).error?.code).toBe("55000");

    // Part of it arrives: 4 of 6 tubes.
    const tubeLine = lines.find((l) => l.product_id === tube)!.id;
    const bottleLine = lines.find((l) => l.product_id === bottle)!.id;
    const first = await frontDesk.rpc("receive_purchase_order", { p_order_id: id!, p_lines: [{ line_id: tubeLine, quantity: 4 }] });
    expect(first).toMatchObject({ data: "partly_received", error: null });
    expect(await level(tube)).toBeCloseTo(before.tube + 240, 2);
    const { data: moves } = await admin.from("stock_movements").select("change, reason, unit_cost_cents, purchase_order_id, note, created_by").eq("product_id", tube).eq("reason", "order_received");
    expect(moves).toEqual([{ change: 240, reason: "order_received", unit_cost_cents: 1000, purchase_order_id: id, note: expect.stringMatching(/^PO-\d+$/), created_by: SEED.staff.frontDesk }]);
    const { data: product } = await admin.from("products").select("cost_cents").eq("id", tube).single();
    expect(product!.cost_cents).toBe(1000);

    // More than ordered is refused; the rest arrives.
    expect((await frontDesk.rpc("receive_purchase_order", { p_order_id: id!, p_lines: [{ line_id: tubeLine, quantity: 3 }] })).error?.code).toBe("22023");
    const rest = await manager.rpc("receive_purchase_order", { p_order_id: id!, p_lines: [{ line_id: tubeLine, quantity: 2 }, { line_id: bottleLine, quantity: 2 }] });
    expect(rest.data).toBe("received");
    expect(await order(id!)).toMatchObject({ status: "received", received_at: expect.any(String) });
    expect(await level(bottle)).toBeCloseTo(before.bottle + 2000, 2);
    expect((await frontDesk.rpc("receive_purchase_order", { p_order_id: id!, p_lines: [{ line_id: bottleLine, quantity: 0 }] })).error?.code).toBe("55000");
  });

  it("lets only owners and managers write, send and delete them, the front desk see and receive, and no one else", async () => {
    expect((await save(frontDesk, [{ product_id: tube, quantity: 1 }])).error?.code).toBe("42501");
    expect((await save(stylist, [{ product_id: tube, quantity: 1 }])).error?.code).toBe("42501");
    const { data: id } = await save(manager, [{ product_id: tube, quantity: 1 }]);
    const { data: seenByDesk } = await frontDesk.from("purchase_orders").select("id").eq("id", id!);
    expect(seenByDesk).toHaveLength(1);
    const { data: seenByStylist } = await stylist.from("purchase_orders").select("id").eq("id", id!);
    expect(seenByStylist).toEqual([]);
    const { data: seenElsewhere } = await otherOwner.from("purchase_orders").select("id").eq("id", id!);
    expect(seenElsewhere).toEqual([]);
    expect((await frontDesk.rpc("delete_purchase_order", { p_order_id: id! })).error?.code).toBe("42501");
    expect((await manager.from("purchase_orders").update({ status: "received" }).eq("id", id!).select("id")).data ?? []).toEqual([]);
    expect((await manager.rpc("delete_purchase_order", { p_order_id: id! })).error).toBeNull();
    expect(await order(id!)).toBeNull();
    // Unknown products are refused.
    expect((await save(manager, [{ product_id: crypto.randomUUID(), quantity: 1 }])).error?.code).toBe("22023");
  });
});

describe("Denise's reorders", () => {
  // Four color appointments over the next few days, each with a formula
  // using 30 g of the test 7N (one tube, 60 g, on hand).
  async function colorWeek() {
    const today = todayIn(TZ);
    // A new client, so no other visits of theirs count.
    const { data: client } = await admin.from("clients").insert({ business_id: B, first_name: `${RUN} Client` }).select("id").single();
    const { data: service } = await admin.from("services").select("id, active_minutes, processing_minutes, finishing_minutes, duration_minutes").eq("business_id", B).eq("name", "All-Over Color").single();
    await admin.from("stock_movements").insert({ business_id: B, location_id: L, product_id: tube, change: 60, on_hand_after: 60, reason: "count" });
    await admin.from("stock_levels").upsert({ business_id: B, location_id: L, product_id: tube, on_hand: 60, reorder_point: 60, reorder_quantity: 4 }, { onConflict: "location_id,product_id" });
    const ids: string[] = [];
    for (const [i, days] of [2, 3, 3, 4].entries()) {
      // Early, before the salon's day, and apart: never over Bridget's own.
      const start = fromLocal(addDays(today, days), (1 + 2 * i) * 60, TZ)!;
      const end = new Date(start.getTime() + service!.duration_minutes! * 60_000);
      const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: client!.id, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "confirmed" }).select("id").single();
      const { data: it } = await admin
        .from("appointment_items")
        .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: service!.id, staff_id: SEED.staff.bridget, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: service!.active_minutes, processing_minutes: service!.processing_minutes, finishing_minutes: service!.finishing_minutes, price_cents: 0 })
        .select("id")
        .single();
      const { data: f } = await admin.from("client_formulas").insert({ business_id: B, client_id: client!.id, staff_id: SEED.staff.bridget, formula: `${RUN} formula`, appointment_item_id: it!.id }).select("id").single();
      await admin.from("formula_products").insert({ business_id: B, formula_id: f!.id, product_id: tube, amount: 30 });
      ids.push(a!.id);
    }
    return ids;
  }

  async function cleanWeek(ids: string[]) {
    await admin.from("client_formulas").delete().eq("formula", `${RUN} formula`);
    await admin.from("appointments").delete().in("id", ids);
    // Everything of the run's clients, even a visit a failed setup left.
    const { data: theirs } = await admin.from("clients").select("id").eq("first_name", `${RUN} Client`);
    await admin.from("appointments").delete().in("client_id", (theirs ?? []).map((c) => c.id));
    await admin.from("clients").delete().eq("first_name", `${RUN} Client`);
    await admin.from("stock_movements").delete().eq("product_id", tube);
    await admin.from("stock_levels").delete().eq("product_id", tube);
  }

  const viewer = (canManage: boolean) => ({ location: { id: L, timezone: TZ }, canManage });

  it("suggests an order before color runs out, and drafts it on approval, with undo", async () => {
    const ids = await colorWeek();
    try {
      const suggestions = await suggestReorders(manager, viewer(true));
      const mine = suggestions.find((s) => s.supplierId === supplier)!;
      expect(mine.headline).toMatch(new RegExp(`^You'll run out of ${RUN} Test 7N before \\w+ — 4 color appointments need it\\.$`));
      expect(mine.lines).toEqual([expect.objectContaining({ product: `${RUN} Test 7N`, quantity: "4 tubes" })]);
      expect(mine.actionId).toBeTruthy();
      const { data: logged } = await admin.from("ai_actions").select("feature, status, proposal").eq("id", mine.actionId!).single();
      expect(logged).toMatchObject({ feature: "reorder", status: "proposed" });

      // Nothing is ordered until a manager approves, and then only a draft.
      expect((await frontDesk.rpc("apply_reorder_draft", { p_action_id: mine.actionId! })).error?.code).toBe("42501");
      const { data: orderId, error } = await manager.rpc("apply_reorder_draft", { p_action_id: mine.actionId! });
      expect(error).toBeNull();
      const drafted = await order(orderId!);
      expect(drafted).toMatchObject({ status: "draft", ai_action_id: mine.actionId, purchase_order_lines: [expect.objectContaining({ product_id: tube, quantity: 4, unit_cost_cents: expect.any(Number) })] });

      // On order now, so it isn't suggested again.
      const again = await suggestReorders(manager, viewer(true));
      expect(again.find((s) => s.supplierId === supplier)).toBeUndefined();

      expect((await manager.rpc("undo_reorder_draft", { p_action_id: mine.actionId! })).error).toBeNull();
      expect(await order(orderId!)).toBeNull();
      const { data: undone } = await admin.from("ai_actions").select("status").eq("id", mine.actionId!).single();
      expect(undone!.status).toBe("undone");
    } finally {
      await cleanWeek(ids);
    }
  });

  it("won't undo once the order is sent, and doesn't suggest a dismissed order again today", async () => {
    const ids = await colorWeek();
    try {
      const first = (await suggestReorders(manager, viewer(true))).find((s) => s.supplierId === supplier)!;
      const { data: orderId } = await manager.rpc("apply_reorder_draft", { p_action_id: first.actionId! });
      await manager.rpc("send_purchase_order", { p_order_id: orderId! });
      expect((await manager.rpc("undo_reorder_draft", { p_action_id: first.actionId! })).error?.code).toBe("55000");
      await admin.from("purchase_orders").delete().eq("id", orderId!);
      await admin.from("ai_actions").delete().eq("id", first.actionId!);

      const second = (await suggestReorders(manager, viewer(true))).find((s) => s.supplierId === supplier)!;
      expect((await manager.rpc("reject_ai_action", { p_action_id: second.actionId! })).error).toBeNull();
      expect((await suggestReorders(manager, viewer(true))).find((s) => s.supplierId === supplier)).toBeUndefined();
      // Others see suggestions without recording them.
      await admin.from("ai_actions").delete().eq("id", second.actionId!);
      const forDesk = (await suggestReorders(frontDesk, viewer(false))).find((s) => s.supplierId === supplier)!;
      expect(forDesk.actionId).toBeNull();
    } finally {
      await cleanWeek(ids);
    }
  });
});
