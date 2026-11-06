// Paying by "Other" (migrations …_paid_by_other.sql, …_paid_by_other_rules.sql):
// only with a note, an alert to whoever has the audit trail, and a void
// takes it back as "Other".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const since = new Date().toISOString();
let owner: Client;
let manager: Client;
let frontDesk: Client;
const sales: string[] = [];

beforeAll(async () => {
  [owner, manager, frontDesk] = await Promise.all([signIn("owner@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
});

afterAll(async () => {
  for (const id of sales) await manager.rpc("void_sale", { p_sale_id: id, p_reason: "Test sale" });
  await admin.from("notifications").delete().eq("business_id", B).like("template", "alert\\_%").gte("created_at", since);
});

const sell = (reference: string | null) =>
  frontDesk.rpc("complete_sale", {
    p_location_id: L,
    p_input: { lines: [{ kind: "gift_card", amount_cents: 2500, recipient_name: "Ava" }], payments: [{ method: "other", amount_cents: 2500, reference }] } as never,
  });

describe("paid by other", () => {
  it("needs a note saying what it was", async () => {
    for (const note of [null, "", "  ", "ok"]) {
      const { error } = await sell(note);
      expect(error?.hint, String(note)).toBe("other_note");
    }
  });

  it("is kept with its note, alerts owners and managers but not who took it, and a void takes it back", async () => {
    const { data: saleId, error } = await sell("Check #1043");
    expect(error).toBeNull();
    sales.push(saleId as unknown as string);
    const { data: pay } = await admin.from("payments").select("method, amount_cents, reference").eq("sale_id", saleId as unknown as string);
    expect(pay).toEqual([{ method: "other", amount_cents: 2500, reference: "Check #1043" }]);
    const { data: sale } = await admin.from("sales").select("number").eq("id", saleId as unknown as string).single();

    const alerts = async (c: Client) => (await c.from("notifications").select("template, body").eq("template", "alert_paid_other").gte("created_at", since)).data ?? [];
    const body = `Sam Rivera took $25 as "Other" on sale #${sale!.number}: Check #1043.`;
    expect(await alerts(owner)).toEqual([{ template: "alert_paid_other", body }]);
    expect(await alerts(manager)).toEqual([{ template: "alert_paid_other", body }]);
    expect(await alerts(frontDesk)).toEqual([]);

    await manager.rpc("void_sale", { p_sale_id: saleId as unknown as string, p_reason: "Wrong client" });
    sales.pop();
    const { data: after } = await admin.from("payments").select("method, amount_cents").eq("sale_id", saleId as unknown as string).order("amount_cents");
    expect(after).toEqual([{ method: "other", amount_cents: -2500 }, { method: "other", amount_cents: 2500 }]);
    // The void raised its own alert, not another "Other" one.
    expect((await alerts(owner)).length).toBe(1);
  });
});
