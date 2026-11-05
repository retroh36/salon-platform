// The cash drawer (migration …_cash_drawer.sql): the front of house counts
// it at opening and during the day against what the database says it
// should hold; the close-out takes the deposit, and the rest is the next
// opening's expected; a count that's off alerts those with `audit`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, fromLocal, todayIn } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const L = SEED.location;
const today = todayIn("America/Chicago");
const yesterday = addDays(today, -1);
let desk: Client;
let owner: Client;
let bridget: Client;
let savedYesterday: Record<string, unknown> | null;
let savedToday: Record<string, unknown> | null;
const since = new Date().toISOString();


beforeAll(async () => {
  [desk, owner, bridget] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("owner@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  savedYesterday = (await admin.from("cash_closeouts").select("*").eq("location_id", L).eq("day", yesterday).maybeSingle()).data;
  savedToday = (await admin.from("cash_closeouts").select("*").eq("location_id", L).eq("day", today).maybeSingle()).data;
  await admin.from("cash_closeouts").delete().eq("location_id", L).in("day", [yesterday, today]);
  await admin.from("drawer_counts").delete().eq("location_id", L).eq("day", today);
});

afterAll(async () => {
  await admin.from("drawer_counts").delete().eq("location_id", L).eq("day", today);
  await admin.from("cash_closeouts").delete().eq("location_id", L).in("day", [yesterday, today]);
  for (const row of [savedYesterday, savedToday]) if (row) await admin.from("cash_closeouts").insert(row as never);
  await admin.from("notifications").delete().eq("template", "alert_drawer_off").gte("created_at", since);
});

describe("the cash drawer", () => {
  it("checks the opening count against what yesterday's close-out left in the drawer", async () => {
    await admin.from("cash_closeouts").insert({ business_id: SEED.business, location_id: L, day: yesterday, expected_cents: 64000, counted_cents: 64000, float_cents: 20000, deposit_cents: 44000 });
    expect((await desk.rpc("count_drawer", { p_location_id: L, p_kind: "open", p_counted_cents: 20000 })).data).toBe(0);
    // Counting again replaces it.
    expect((await desk.rpc("count_drawer", { p_location_id: L, p_kind: "open", p_counted_cents: 18800, p_note: "Recount" })).data).toBe(-1200);
    const { data } = await admin.from("drawer_counts").select("kind, expected_cents, counted_cents, counted_by").eq("location_id", L).eq("day", today);
    expect(data).toEqual([{ kind: "open", expected_cents: 20000, counted_cents: 18800, counted_by: SEED.staff.frontDesk }]);
    // It was off: the owner hears about it, the front desk doesn't.
    const { data: alerts } = await owner.from("notifications").select("body").eq("template", "alert_drawer_off").gte("created_at", since);
    expect(alerts!.map((a) => a.body)).toContain("Sam Rivera's opening drawer count was $12 short: Recount.");
  });

  it("expects the opening count plus the day's cash during the day", async () => {
    const diff = (await desk.rpc("count_drawer", { p_location_id: L, p_kind: "mid", p_counted_cents: 18800 })).data!;
    const { data: mid } = await admin.from("drawer_counts").select("expected_cents").eq("location_id", L).eq("day", today).eq("kind", "mid").single();
    const { data: cash } = await admin.from("payments").select("amount_cents").eq("location_id", L).eq("method", "cash").gte("created_at", fromLocal(today, 0, "America/Chicago")!.toISOString());
    expect(mid!.expected_cents).toBe(18800 + cash!.reduce((n, p) => n + p.amount_cents, 0));
    expect(diff).toBe(18800 - mid!.expected_cents);
  });

  it("is counted by the front of house only, and the deposit can't exceed the count", async () => {
    expect((await bridget.rpc("count_drawer", { p_location_id: L, p_kind: "mid", p_counted_cents: 100 })).error?.code).toBe("42501");
    expect((await desk.rpc("count_drawer", { p_location_id: L, p_kind: "close" as never, p_counted_cents: 100 })).error?.code).toBe("22023");
    expect((await owner.rpc("save_closeout", { p_location_id: L, p_day: today, p_counted_cents: 1000, p_note: "", p_deposit_cents: 2000 })).error?.code).toBe("22023");
    // The close-out starts from the opening count.
    await owner.rpc("save_closeout", { p_location_id: L, p_day: today, p_counted_cents: 1000, p_note: "", p_deposit_cents: 500 });
    const { data } = await admin.from("cash_closeouts").select("float_cents, deposit_cents").eq("location_id", L).eq("day", today).single();
    expect(data).toEqual({ float_cents: 18800, deposit_cents: 500 });
  });
});
