// A guardian and their dependent: who may set it, what the guardian's
// account shows, where messages go.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Account } from "@/lib/online-booking/account";
import { loadAccount, loadDependent, managedVisitClient } from "@/lib/online-booking/account-data";
import { appointmentChannel } from "@/lib/messaging/send";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const TAG = `Dep${Date.now().toString(36)}`;
let frontDesk: Client;
let bridget: Client;
let family: string;
let parent: string;
let child: string;
let otherAdult: string;
const account = (clientId: string): Account => ({ accountId: "x", clientId, businessId: B, firstName: "x" });

beforeAll(async () => {
  [frontDesk, bridget] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  const { data, error } = await admin.from("clients").insert([
    { business_id: B, first_name: `${TAG}P`, last_name: "T", email: `${TAG}p@example.com`.toLowerCase() },
    { business_id: B, first_name: `${TAG}C`, last_name: "T", email: `${TAG}c@example.com`.toLowerCase() },
    { business_id: B, first_name: `${TAG}A`, last_name: "T" },
  ]).select("id, first_name");
  if (error) throw error;
  const id = (s: string) => data.find((c) => c.first_name.endsWith(s))!.id;
  [parent, child, otherAdult] = [id("P"), id("C"), id("A")];
  const saved = await frontDesk.rpc("save_family", { p_business_id: B, p_family_id: null as never, p_name: TAG, p_client_ids: [parent, child], p_payer_client_id: null as never });
  if (saved.error) throw saved.error;
  family = saved.data as string;
});

afterAll(async () => {
  await admin.from("clients").update({ family_id: null, guardian_client_id: null }).in("id", [parent, child]);
  await admin.from("families").delete().eq("id", family);
  await admin.from("clients").delete().in("id", [parent, child, otherAdult]);
});

const set = (c: Client, client: string, guardian: string | null) => c.rpc("set_client_guardian", { p_client_id: client, p_guardian_id: guardian as string });

describe("dependents", () => {
  it("are set by the front of house, never by a stylist or directly", async () => {
    expect((await set(bridget, child, parent)).error).not.toBeNull();
    expect((await frontDesk.from("clients").update({ guardian_client_id: parent }).eq("id", child)).error?.code).toBe("42501");
  });
  it("need a guardian in the family", async () => {
    expect((await set(frontDesk, child, otherAdult)).error?.hint).toBe("family");
  });
  it("give the guardian their visits and messages, and nobody else", async () => {
    expect((await set(frontDesk, child, parent)).error).toBeNull();
    expect((await set(frontDesk, parent, child)).error?.hint).toBe("guardian_dependent");
    expect(await loadDependent(admin, account(parent), child)).toMatchObject({ id: child });
    expect(await loadDependent(admin, account(child), parent)).toBeNull();
    expect(await loadDependent(admin, account(otherAdult), child)).toBeNull();
    expect((await loadAccount(admin, account(parent))).dependents.map((d) => d.id)).toEqual([child]);
    expect((await loadAccount(admin, account(otherAdult))).dependents).toEqual([]);
    const to = await appointmentChannel(admin, child, "email");
    expect(to).toMatchObject({ channel: "email", to: `${TAG}p@example.com`.toLowerCase(), dependent: `${TAG}C` });
    expect(await managedVisitClient(admin, account(otherAdult), "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
  it("fall back to their own contact when the guardian can't be reached", async () => {
    await admin.from("clients").update({ appointment_email_ok: false }).eq("id", parent);
    expect(await appointmentChannel(admin, child, "email")).toMatchObject({ to: `${TAG}c@example.com`.toLowerCase(), dependent: null });
    await admin.from("clients").update({ appointment_email_ok: true }).eq("id", parent);
  });
  it("end when they leave the family", async () => {
    const saved = await frontDesk.rpc("save_family", { p_business_id: B, p_family_id: family, p_name: TAG, p_client_ids: [parent, otherAdult], p_payer_client_id: null as never });
    expect(saved.error).toBeNull();
    const { data } = await admin.from("clients").select("guardian_client_id, family_id").eq("id", child).single();
    expect(data).toEqual({ guardian_client_id: null, family_id: null });
  });
});
