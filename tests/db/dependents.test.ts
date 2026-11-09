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
  describe("once the guardian hears and pays", () => {
    let visit: string;
    beforeAll(async () => {
      expect((await set(frontDesk, child, parent)).error).toBeNull();
      const { data: loc } = await admin.from("locations").select("id").eq("business_id", B).limit(1).single();
      const { data, error } = await admin.from("appointments").insert({ business_id: B, location_id: loc!.id, client_id: child, starts_at: new Date(Date.now() + 864e5).toISOString(), ends_at: new Date(Date.now() + 87e6).toISOString(), status: "booked", source: "front_desk" }).select("id").single();
      if (error) throw error;
      visit = data.id;
    });
    afterAll(async () => {
      await admin.from("client_cards").delete().in("client_id", [parent, child]);
      await admin.from("client_messages").delete().eq("appointment_id", visit);
      await admin.from("appointments").delete().eq("id", visit);
    });

    it("sends staff's message to the guardian, saying whose visit", async () => {
      const sent = await frontDesk.rpc("send_client_message", { p_appointment_id: visit, p_purpose: "appointment", p_template: "custom", p_channel: "email", p_subject: "Hello", p_body: "We can take you at 2.", p_opt_out_hash: null as never });
      expect(sent.error).toBeNull();
      const { data } = await admin.from("outbox_messages").select("to_address, body").eq("to_address", `${TAG}p@example.com`.toLowerCase()).order("created_at", { ascending: false }).limit(1).single();
      expect(data!.body).toContain(`About ${TAG}C's visit:`);
      const { data: log } = await admin.from("client_messages").select("client_id").eq("appointment_id", visit).single();
      expect(log!.client_id).toBe(child);
    });

    it("saves a card on the guardian only, and uses it for the dependent", async () => {
      const refused = await admin.rpc("record_online_card", { p_appointment_id: visit, p_card: { provider: "test", ref: "tok_x", label: "Visa …4242" } as never, p_consent: { policy_text: "Policy", terms: {} } as never, p_deposit: null as never, p_card_client_id: otherAdult });
      expect(refused.error?.code).toBe("42501");
      const saved = await admin.rpc("record_online_card", { p_appointment_id: visit, p_card: { provider: "test", ref: "tok_x", label: "Visa …4242" } as never, p_consent: { policy_text: "Policy", terms: {} } as never, p_deposit: null as never, p_card_client_id: parent });
      expect(saved.error).toBeNull();
      const { data } = await admin.from("client_cards").select("client_id").in("client_id", [parent, child]).is("removed_at", null);
      expect(data!.map((c) => c.client_id)).toEqual([parent]);
      const standing = await admin.rpc("client_policy_standing", { p_client_id: child });
      expect((standing.data as { has_card: boolean }).has_card).toBe(true);
    });

    it("charges the dependent's fee to the guardian's card", async () => {
      const { data: a } = await admin.from("appointments").select("location_id").eq("id", visit).single();
      const { data: fee, error } = await admin.from("policy_fees").insert({ business_id: B, location_id: a!.location_id, appointment_id: visit, client_id: child, kind: "no_show", fee_cents: 2500, from_deposit_cents: 0, status: "pending", charge_after: new Date(Date.now() - 1000).toISOString(), attempts: 0 }).select("id").single();
      if (error) throw error;
      const { data: claimed, error: claimError } = await admin.rpc("claim_policy_fees", { p_business_id: B, p_fee_id: fee.id, p_limit: 1 });
      expect(claimError).toBeNull();
      expect(claimed).toHaveLength(1);
      expect(claimed![0].payment_method_ref).toBe("tok_x");
      expect(claimed![0].client_id).toBe(child);
      await admin.from("policy_fee_events").delete().eq("fee_id", fee.id);
      await admin.from("policy_fees").delete().eq("id", fee.id);
    });
  });

  it("end when they leave the family", async () => {
    const saved = await frontDesk.rpc("save_family", { p_business_id: B, p_family_id: family, p_name: TAG, p_client_ids: [parent, otherAdult], p_payer_client_id: null as never });
    expect(saved.error).toBeNull();
    const { data } = await admin.from("clients").select("guardian_client_id, family_id").eq("id", child).single();
    expect(data).toEqual({ guardian_client_id: null, family_id: null });
  });
});
