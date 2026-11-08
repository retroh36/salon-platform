// Card authorization (migration …_card_authorizations.sql): a family
// member's visits held by another member's card, approved by the card's
// owner from a link; it ends with the card or when staff end it.
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { answerAuthorization } from "@/app/authorize/[token]/actions";
import { admin, type Client, createOtherSalon, SEED, signIn } from "./helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));

const B = SEED.business;
const TAG = `Cau${Date.now().toString(36)}`;

let frontDesk: Client;
let stylist: Client;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
let otherOwner: Client;
const ids: string[] = [];

const token = () => randomBytes(32).toString("base64url");
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

async function client(first: string) {
  const { data, error } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}${first}`, last_name: "Park", phone: "3125550188" }).select("id").single();
  if (error) throw error;
  ids.push(data.id);
  return data.id;
}

// A card on file of their own, as the card link page saves one.
async function giveCard(clientId: string, label = "Visa …4242") {
  const { data: consent } = await admin.from("policy_consents").insert({ business_id: B, client_id: clientId, policy_text: "Policy.", terms: {}, channel: "link" }).select("id").single();
  const { data, error } = await admin.from("client_cards").insert({ business_id: B, client_id: clientId, provider: "test", payment_method_ref: "test_visa_4242", label, consent_id: consent!.id }).select("id").single();
  if (error) throw error;
  return data.id;
}

// A family of a parent with a card and a child without.
async function family() {
  const [mom, kid] = [await client("Jen"), await client("Mia")];
  const { error } = await frontDesk.rpc("save_family", { p_business_id: B, p_family_id: null as never, p_name: `The ${TAG}`, p_client_ids: [mom, kid], p_payer_client_id: mom });
  if (error) throw error;
  const card = await giveCard(mom);
  return { mom, kid, card };
}

const ask = (who: Client, kid: string, mom: string, t = token()) =>
  who.rpc("create_card_authorization", { p_client_id: kid, p_payer_client_id: mom, p_token_hash: hash(t), p_channel: "sms", p_to: "3125550188", p_hours: 72 }).then((r) => ({ ...r, token: t }));

const ownCard = async (clientId: string) => (await admin.from("client_cards").select("label, authorization_id, payment_method_ref").eq("client_id", clientId).is("removed_at", null).maybeSingle()).data;

beforeAll(async () => {
  frontDesk = await signIn("frontdesk@mapleandash.test");
  stylist = await signIn("bridget@mapleandash.test");
  other = await createOtherSalon();
  otherOwner = await signIn(other.email);
});

afterAll(async () => {
  await admin.from("client_cards").update({ authorization_id: null }).in("client_id", ids);
  await admin.from("card_authorizations").delete().in("client_id", ids);
  await admin.from("client_cards").delete().in("client_id", ids);
  await admin.from("policy_fees").delete().in("client_id", ids);
  await admin.from("policy_consents").delete().in("client_id", ids);
  const { data } = await admin.from("clients").select("family_id").in("id", ids);
  const families = [...new Set((data ?? []).map((c) => c.family_id).filter(Boolean))] as string[];
  await admin.from("clients").delete().in("id", ids);
  if (families.length) await admin.from("families").delete().in("id", families);
  await other.cleanup();
});

describe("card authorization", () => {
  it("gives the child a card on file from the parent's, with what the parent agreed to", async () => {
    const { mom, kid } = await family();
    const asked = await ask(frontDesk, kid, mom);
    expect(asked.error).toBeNull();
    expect(await ownCard(kid)).toBeNull();

    // Approving needs a full name and a tick.
    expect(await answerAuthorization(asked.token, true, "Jen", true)).toEqual({ ok: false, message: "Type your full name to approve." });
    expect(await answerAuthorization(asked.token, true, "Jen Park", false)).toEqual({ ok: false, message: "Tick the box to agree." });
    expect(await answerAuthorization(asked.token, true, "Jen Park", true)).toEqual({ ok: true, approved: true });

    const card = await ownCard(kid);
    expect(card).toMatchObject({ label: `Visa …4242 (${TAG}Jen's)`, payment_method_ref: "test_visa_4242" });
    const { data: a } = await admin.from("card_authorizations").select("status, signed_name, agreed_text").eq("id", card!.authorization_id!).single();
    expect(a!.status).toBe("approved");
    expect(a!.signed_name).toBe("Jen Park");
    expect(a!.agreed_text).toContain(`I, Jen Park, allow Maple & Ash`);
    expect(a!.agreed_text).toContain(`to hold ${TAG}Mia's bookings`);
    // Their consent is what the parent read.
    const { data: consent } = await admin.from("client_cards").select("consent:policy_consents(policy_text, channel)").eq("client_id", kid).is("removed_at", null).single();
    expect(consent!.consent).toMatchObject({ channel: "link", policy_text: a!.agreed_text });

    // A link answers once.
    expect(await answerAuthorization(asked.token, true, "Jen Park", true)).toEqual({ ok: false, message: "This has already been answered. Thank you." });
  });

  it("a fee waiting for a card is tried once it's approved", async () => {
    const { mom, kid } = await family();
    // A fee of the test's own, on a past seeded visit that has none (a
    // visit made here would be without services for a moment, which the
    // seed checks running alongside would catch).
    const { data: fees } = await admin.from("policy_fees").select("appointment_id").eq("business_id", B);
    const { data: past } = await admin.from("appointments").select("id").eq("business_id", B).eq("status", "completed").order("starts_at").limit(200);
    const visit = past!.find((v) => !fees!.some((f) => f.appointment_id === v.id))!;
    const { error: feeError } = await admin.from("policy_fees").insert({ business_id: B, location_id: SEED.location, client_id: kid, appointment_id: visit!.id, kind: "no_show", fee_cents: 2500, status: "no_card" });
    expect(feeError).toBeNull();
    const asked = await ask(frontDesk, kid, mom);
    await answerAuthorization(asked.token, true, "Jen Park", true);
    expect((await admin.from("policy_fees").select("status").eq("appointment_id", visit!.id).single()).data!.status).toBe("pending");
    await admin.from("policy_fees").delete().eq("appointment_id", visit!.id);
  });

  it("a decline leaves no card", async () => {
    const { mom, kid } = await family();
    const asked = await ask(frontDesk, kid, mom);
    expect(await answerAuthorization(asked.token, false, "", false)).toEqual({ ok: true, approved: false });
    expect(await ownCard(kid)).toBeNull();
    expect((await admin.from("card_authorizations").select("status").eq("token_hash", hash(asked.token)).single()).data!.status).toBe("declined");
  });

  it("ends when the parent's card goes, when staff end it, or when the child adds their own", async () => {
    // The parent's card replaced: the child's card from it goes too.
    const first = await family();
    let asked = await ask(frontDesk, first.kid, first.mom);
    await answerAuthorization(asked.token, true, "Jen Park", true);
    expect((await frontDesk.rpc("remove_client_card", { p_client_id: first.mom })).error).toBeNull();
    expect(await ownCard(first.kid)).toBeNull();
    expect((await admin.from("card_authorizations").select("status, end_reason").eq("token_hash", hash(asked.token)).single()).data).toEqual({ status: "ended", end_reason: "card_removed" });

    // Staff end it: the card comes off, the parent's stays.
    const second = await family();
    asked = await ask(frontDesk, second.kid, second.mom);
    await answerAuthorization(asked.token, true, "Jen Park", true);
    const { data: a } = await admin.from("card_authorizations").select("id").eq("token_hash", hash(asked.token)).single();
    expect((await stylist.rpc("end_card_authorization", { p_id: a!.id })).error).toMatchObject({ code: "42501" });
    expect((await frontDesk.rpc("end_card_authorization", { p_id: a!.id })).error).toBeNull();
    expect(await ownCard(second.kid)).toBeNull();
    expect(await ownCard(second.mom)).not.toBeNull();
    expect((await admin.from("card_authorizations").select("status, end_reason").eq("id", a!.id).single()).data).toEqual({ status: "ended", end_reason: "staff" });

    // A link still out stops working when the card it's for is removed.
    const third = await family();
    asked = await ask(frontDesk, third.kid, third.mom);
    await frontDesk.rpc("remove_client_card", { p_client_id: third.mom });
    expect((await admin.from("card_authorizations").select("status").eq("token_hash", hash(asked.token)).single()).data!.status).toBe("canceled");
    expect((await answerAuthorization(asked.token, true, "Jen Park", true)).ok).toBe(false);
  });

  it("refuses outside a family, a client with a card, a payer without one, and staff who aren't front of house", async () => {
    const [a, b] = [await client("Al"), await client("Bo")];
    await giveCard(a);
    expect((await ask(frontDesk, b, a)).error).toMatchObject({ hint: "family" });
    const { mom, kid } = await family();
    expect((await ask(stylist, kid, mom)).error).toMatchObject({ code: "42501" });
    expect((await ask(frontDesk, mom, kid)).error).toMatchObject({ hint: "has_card" });
    await giveCard(kid, "Mastercard …4444");
    expect((await ask(frontDesk, kid, mom)).error).toMatchObject({ hint: "has_card" });
    const lone = await family();
    await frontDesk.rpc("remove_client_card", { p_client_id: lone.mom });
    expect((await ask(frontDesk, lone.kid, lone.mom)).error).toMatchObject({ hint: "no_card" });
  });

  it("is the salon's own, and never answered by a signed-in user", async () => {
    const { mom, kid } = await family();
    const asked = await ask(frontDesk, kid, mom);
    expect((await otherOwner.from("card_authorizations").select("id").eq("client_id", kid)).data).toEqual([]);
    expect((await frontDesk.from("card_authorizations").select("id").eq("client_id", kid)).data).toHaveLength(1);
    expect((await stylist.from("card_authorizations").select("id").eq("client_id", kid)).data).toEqual([]);
    const { error } = await frontDesk.rpc("answer_card_authorization", { p_token_hash: hash(asked.token), p_approve: true, p_signed_name: "Jen Park", p_agreed_text: "x", p_terms: {}, p_ip_hash: null as never });
    expect(error).not.toBeNull();
  });
});
