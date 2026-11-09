// send_campaign: who may send, consent checked again, sent only once.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canSendAt } from "@/lib/automations";
import { toLocal } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const TAG = `Camp${Date.now().toString(36)}`;
const open = canSendAt(toLocal(new Date(), "America/Chicago").minute);
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
let manager: Client;
let frontDesk: Client;
let yes: string;
let no: string;
const campaigns: string[] = [];

const send = (c: Client, id: string, ids: string[]) => {
  campaigns.push(id);
  return c.rpc("send_campaign", {
    p_business_id: B, p_campaign_id: id, p_name: TAG, p_report: {}, p_description: "A list", p_subject: "Hello", p_body: "Hi", p_left_out: 0,
    p_recipients: ids.map((client_id) => ({ client_id, channel: "email", body: `Hi ${TAG}`, opt_out_hash: hash() })) as never,
  });
};

beforeAll(async () => {
  [manager, frontDesk] = await Promise.all(["manager", "frontdesk"].map((u) => signIn(`${u}@mapleandash.test`)));
  const { data, error } = await admin.from("clients").insert([
    { business_id: B, first_name: `${TAG}Y`, last_name: "T", email: `${TAG}y@example.com`.toLowerCase(), email_opt_in: true },
    { business_id: B, first_name: `${TAG}N`, last_name: "T", email: `${TAG}n@example.com`.toLowerCase(), email_opt_in: false },
  ]).select("id, first_name");
  if (error) throw error;
  yes = data.find((c) => c.first_name.endsWith("Y"))!.id;
  no = data.find((c) => c.first_name.endsWith("N"))!.id;
});

afterAll(async () => {
  await admin.from("outbox_messages").delete().like("body", `%${TAG}%`);
  await admin.from("campaigns").delete().in("id", campaigns);
  await admin.from("clients").delete().in("id", [yes, no]);
});

describe("campaigns", () => {
  it("are for those with the settings permission", async () => {
    expect((await send(frontDesk, randomUUID(), [yes])).error?.code).toBe("42501");
  });
  it("go only to clients who said yes, once, logged with who sent it", async () => {
    const id = randomUUID();
    const first = await send(manager, id, [yes, no]);
    if (!open) return expect(first.error?.hint).toBe("hours");
    expect(first.data).toEqual({ sent: 1, skipped: 1 });
    expect((await send(manager, id, [yes])).error?.hint).toBe("sent");
    const { data } = await admin.from("client_messages").select("client_id, sent_by, purpose, template").eq("campaign_id", id);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ client_id: yes, purpose: "marketing", template: "custom" });
    expect(data![0].sent_by).not.toBeNull();
    // The week's limit: a second campaign has nobody to reach.
    expect((await send(manager, randomUUID(), [yes])).error?.hint).toBe("nobody");
  });
  it("can't be written directly", async () => {
    const { error } = await manager.from("campaigns").insert({ id: randomUUID(), business_id: B, name: "x", report: {}, description: "x", subject: "x", body: "x", sent_count: 0, left_out: 0 });
    expect(error).not.toBeNull();
  });
  it("aren't read by the front desk", async () => {
    expect((await frontDesk.from("campaigns").select("id")).data).toEqual([]);
  });
});
