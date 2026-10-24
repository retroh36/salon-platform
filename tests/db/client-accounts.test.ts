import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountForToken } from "@/lib/online-booking/account";
import { loadAccount, ownsVisit } from "@/lib/online-booking/account-data";
import { verifyLink } from "@/lib/online-booking/codes";
import { newSecret, sha256 } from "@/lib/online-booking/security";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

// Client accounts on the booking site (migration …_client_accounts.sql):
// separate from staff logins, a session sees one client at one salon.

const B = SEED.business;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
let frontDesk: Client;
let bridget: Client;
let clientA: string;
let clientB: string;
const tokens: Record<string, string> = {};

async function session(clientId: string, opts: { business?: string; expires?: Date; revoked?: boolean } = {}) {
  const business = opts.business ?? B;
  const { data: account, error } = await admin
    .from("client_accounts")
    .upsert({ business_id: business, client_id: clientId, verified_channel: "email" }, { onConflict: "business_id,client_id" })
    .select("id")
    .single();
  if (error) throw error;
  const token = newSecret();
  await admin.from("client_sessions").insert({
    business_id: business,
    account_id: account.id,
    token_hash: sha256(token),
    expires_at: (opts.expires ?? new Date(Date.now() + 86_400_000)).toISOString(),
    revoked_at: opts.revoked ? new Date().toISOString() : null,
  });
  return token;
}

beforeAll(async () => {
  [frontDesk, bridget, other] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test"), createOtherSalon()]);
  // Two clients with visits: each account sees only its own.
  const { data: busy } = await admin.from("appointments").select("client_id").eq("business_id", B).eq("status", "completed").not("client_id", "is", null).limit(200);
  const ids = [...new Set(busy!.map((a) => a.client_id!))];
  [clientA, clientB] = ids;
  tokens.a = await session(clientA);
  tokens.b = await session(clientB);
});

afterAll(async () => {
  await admin.from("client_accounts").delete().eq("business_id", B).in("client_id", [clientA, clientB]);
  await other.cleanup();
});

describe("a client's session", () => {
  it("is their own client at this salon, and nowhere else", async () => {
    expect(await accountForToken(admin, B, tokens.a)).toMatchObject({ clientId: clientA, businessId: B });
    expect(await accountForToken(admin, other.businessId, tokens.a)).toBeNull();
    expect(await accountForToken(admin, B, newSecret())).toBeNull();
    expect(await accountForToken(admin, B, "not a token")).toBeNull();
  });

  it("stops working once it's expired or signed out", async () => {
    expect(await accountForToken(admin, B, await session(clientA, { expires: new Date(Date.now() - 1000) }))).toBeNull();
    expect(await accountForToken(admin, B, await session(clientA, { revoked: true }))).toBeNull();
  });

  it("loads only that client's visits, balances and card", async () => {
    const a = (await accountForToken(admin, B, tokens.a))!;
    const data = await loadAccount(admin, a);
    const ids = [...data.upcoming, ...data.past].map((v) => v.id);
    expect(ids.length).toBeGreaterThan(0);
    const { data: owners } = await admin.from("appointments").select("client_id").in("id", ids);
    expect(new Set(owners!.map((o) => o.client_id))).toEqual(new Set([clientA]));
    // Nothing internal.
    expect(JSON.stringify(data)).not.toMatch(/"notes"|allerg|cost_cents/);
  });

  it("can't open someone else's visit", async () => {
    const a = (await accountForToken(admin, B, tokens.a))!;
    const { data: theirs } = await admin.from("appointments").select("id").eq("client_id", clientB).limit(1).single();
    const { data: mine } = await admin.from("appointments").select("id").eq("client_id", clientA).limit(1).single();
    expect(await ownsVisit(admin, a, theirs!.id)).toBe(false);
    expect(await ownsVisit(admin, a, mine!.id)).toBe(true);
  });
});

describe("sign-in links", () => {
  it("work once, and only for their salon", async () => {
    const secret = newSecret();
    const { data: v } = await admin
      .from("online_verifications")
      .insert({ business_id: B, channel: "email", destination: "link-test@example.com", code_hash: sha256("x"), link_hash: sha256(secret), expires_at: new Date(Date.now() + 600_000).toISOString() })
      .select("id")
      .single();
    expect(await verifyLink(admin, other.businessId, v!.id, secret)).toEqual({ ok: false, error: "expired" });
    expect(await verifyLink(admin, B, v!.id, newSecret())).toEqual({ ok: false, error: "expired" });
    expect(await verifyLink(admin, B, v!.id, secret)).toMatchObject({ ok: true });
    expect(await verifyLink(admin, B, v!.id, secret)).toEqual({ ok: false, error: "expired" });
    await admin.from("online_verifications").delete().eq("id", v!.id);
  });
});

describe("staff", () => {
  it("never read sessions; the front desk sees who has an account, stylists don't", async () => {
    const { data: sessions } = await frontDesk.from("client_sessions").select("id").limit(1);
    expect(sessions).toEqual([]);
    const { data: desk } = await frontDesk.from("client_accounts").select("client_id").in("client_id", [clientA, clientB]);
    expect(desk).toHaveLength(2);
    const { data: stylist } = await bridget.from("client_accounts").select("client_id").limit(1);
    expect(stylist).toEqual([]);
  });

  it("the account functions are for the booking site only", async () => {
    const { error } = await frontDesk.rpc("remove_own_card", { p_business_id: B, p_client_id: clientA });
    expect(error?.code).toBe("42501");
  });
});
