// Alerts (migration …_money_alerts.sql): a void, a refund or a $0 sale tells
// everyone with `audit` but whoever did it, in our own words; nobody else
// reads them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
let owner: Client;
let manager: Client;
let frontDesk: Client;
let saleId: string;
let saleNumber: number;
const events: string[] = [];
const since = new Date().toISOString();

beforeAll(async () => {
  [owner, manager, frontDesk] = await Promise.all([signIn("owner@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  const { data } = await admin.from("sales").select("id, number").eq("business_id", B).eq("status", "completed").order("created_at").limit(1).single();
  saleId = data!.id;
  saleNumber = data!.number;
});

afterAll(async () => {
  if (events.length) await admin.from("sale_events").delete().in("id", events);
  await admin.from("notifications").delete().eq("business_id", B).like("template", "alert\\_%").gte("created_at", since);
});

async function event(kind: "voided" | "refunded", amount: number | null, detail: string | null) {
  const { data, error } = await admin.from("sale_events").insert({ business_id: B, sale_id: saleId, kind, amount_cents: amount, detail, staff_id: SEED.staff.manager }).select("id").single();
  if (error) throw error;
  events.push(data.id);
}

async function alerts(client: Client) {
  const { data } = await client.from("notifications").select("staff_id, template, body").like("template", "alert\\_%").gte("created_at", since);
  return data ?? [];
}

describe("alerts", () => {
  it("tell the owner who refunded what, not the manager who did it, and nobody else reads them", async () => {
    await event("refunded", -4000, "Color didn't take");
    const mine = await alerts(owner);
    expect(mine).toEqual([{ staff_id: SEED.staff.owner, template: "alert_sale_refunded", body: `Daniel Okafor refunded $40 on sale #${saleNumber}: Color didn't take.` }]);
    expect(await alerts(manager)).toEqual([]);
    expect(await alerts(frontDesk)).toEqual([]);
  });

  it("include a front desk member an owner gave the audit permission", async () => {
    await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.frontDesk, p_permission: "audit", p_allowed: true });
    try {
      await event("voided", null, null);
      expect((await alerts(frontDesk)).map((a) => a.template)).toEqual(["alert_sale_voided"]);
    } finally {
      await admin.from("staff_permissions").delete().eq("staff_id", SEED.staff.frontDesk);
    }
  });
});
