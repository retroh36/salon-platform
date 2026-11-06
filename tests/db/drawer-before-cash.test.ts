// The opening count before the first cash of the day (migration
// …_drawer_before_cash.sql): cash is refused until the drawer is counted or
// a manager skips the count with a reason (logged and alerted); cards are
// never held up, and a count that's off doesn't stop anything.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const today = todayIn("America/Chicago");
const since = new Date().toISOString();
let owner: Client;
let manager: Client;
let frontDesk: Client;
const sales: string[] = [];

const clear = () => Promise.all([admin.from("drawer_counts").delete().eq("location_id", L).eq("day", today), admin.from("drawer_skips").delete().eq("location_id", L).eq("day", today)]);

beforeAll(async () => {
  [owner, manager, frontDesk] = await Promise.all([signIn("owner@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  const { count } = await admin.from("cash_closeouts").select("id", { count: "exact", head: true }).eq("location_id", L).eq("day", today);
  expect(count, "today's drawer is already closed out").toBe(0);
  await clear();
});

afterAll(async () => {
  for (const id of sales) await manager.rpc("void_sale", { p_sale_id: id, p_reason: "Test sale" });
  await clear();
  await admin.from("notifications").delete().eq("business_id", B).like("template", "alert\\_drawer%").gte("created_at", since);
});

async function sell(method: "cash" | "card") {
  const { data, error } = await frontDesk.rpc("complete_sale", {
    p_location_id: L,
    p_input: { lines: [{ kind: "gift_card", amount_cents: 2500, recipient_name: "Ava" }], payments: [{ method, amount_cents: 2500, ...(method === "cash" ? { tendered_cents: 2500 } : {}) }] } as never,
  });
  if (data) sales.push(data as unknown as string);
  return error;
}

describe("the drawer before cash", () => {
  it("refuses cash until the drawer is counted, but never a card", async () => {
    expect((await sell("cash"))?.hint).toBe("drawer_not_counted");
    expect(await sell("card")).toBeNull();
  });

  it("lets only a manager or owner skip the count, with a reason, logged and alerted", async () => {
    expect((await frontDesk.rpc("skip_drawer_count", { p_location_id: L, p_reason: "Drawer key is lost" })).error?.code).toBe("42501");
    expect((await manager.rpc("skip_drawer_count", { p_location_id: L, p_reason: " " })).error?.hint).toBe("reason");
    expect((await manager.rpc("skip_drawer_count", { p_location_id: L, p_reason: "Drawer key is lost", p_asked_by: SEED.staff.frontDesk })).error).toBeNull();

    const { data: skip } = await frontDesk.from("drawer_skips").select("reason, skipped_by, asked_by").eq("location_id", L).eq("day", today).single();
    expect(skip).toEqual({ reason: "Drawer key is lost", skipped_by: SEED.staff.manager, asked_by: SEED.staff.frontDesk });
    const alerts = async (c: Client) => (await c.from("notifications").select("body").eq("template", "alert_drawer_skipped").gte("created_at", since)).data ?? [];
    expect(await alerts(owner)).toEqual([{ body: "Daniel Okafor let cash be taken today without the opening drawer count (asked by Sam Rivera): Drawer key is lost." }]);
    expect(await alerts(manager)).toEqual([]);

    expect(await sell("cash")).toBeNull();
  });

  it("takes cash once the drawer is counted, even when the count is off", async () => {
    await clear();
    const { data: diff, error } = await frontDesk.rpc("count_drawer", { p_location_id: L, p_kind: "open", p_counted_cents: 1 });
    expect(error).toBeNull();
    expect(diff).not.toBe(0);
    expect(await sell("cash")).toBeNull();
  });
});
