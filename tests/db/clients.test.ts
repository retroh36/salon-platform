// Clients and client_formulas: RLS, constraints and generated search columns.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const PREFIX = `Test${crypto.randomUUID().slice(0, 8)}`;

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let owner: Client;
let frontDesk: Client;
let stylist: Client; // Priya
let otherOwner: Client;
let clientId: string; // a seeded client

async function newClient(fields: { first_name?: string; phone?: string | null; preferred_staff_id?: string | null } = {}) {
  const { data, error } = await admin
    .from("clients")
    .insert({ business_id: SEED.business, first_name: PREFIX, last_name: "Client", ...fields })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

beforeAll(async () => {
  other = await createOtherSalon();
  [owner, frontDesk, stylist, otherOwner] = await Promise.all([
    signIn("owner@mapleandash.test"),
    signIn("frontdesk@mapleandash.test"),
    signIn("priya@mapleandash.test"),
    signIn(other.email),
  ]);
  const { data } = await admin.from("clients").select("id").eq("business_id", SEED.business).limit(1).single();
  clientId = data!.id;
});

afterAll(async () => {
  await admin.from("clients").delete().like("first_name", `${PREFIX}%`);
  await other?.cleanup();
});

describe("seed data", () => {
  it("has 500 clients, some with formula history", async () => {
    const { count } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("business_id", SEED.business);
    expect(count).toBe(500);

    const { data } = await admin.from("client_formulas").select("client_id, staff_id").eq("business_id", SEED.business);
    const withHistory = new Set(data!.map((f) => f.client_id)).size;
    expect(withHistory).toBeGreaterThan(100);
    expect(withHistory).toBeLessThan(300);
  });
});

describe("search columns", () => {
  it("keeps lowercase name and digits-only phone in sync", async () => {
    const id = await newClient({ first_name: `${PREFIX} Mía`, phone: "(312) 555-0199" });
    const { data } = await admin.from("clients").select("search_name, phone_digits").eq("id", id).single();
    expect(data).toEqual({ search_name: `${PREFIX.toLowerCase()} mía client`, phone_digits: "3125550199" });

    await admin.from("clients").update({ last_name: "Okafor", phone: null }).eq("id", id);
    const { data: after } = await admin.from("clients").select("search_name, phone_digits").eq("id", id).single();
    expect(after).toEqual({ search_name: `${PREFIX.toLowerCase()} mía okafor`, phone_digits: "" });
  });
});

describe("who can change clients", () => {
  it("front desk can add and edit clients", async () => {
    const { data, error } = await frontDesk
      .from("clients")
      .insert({ business_id: SEED.business, first_name: `${PREFIX} Desk`, phone: "(312) 555-0198" })
      .select("id")
      .single();
    expect(error).toBeNull();

    const update = await frontDesk.from("clients").update({ allergies: "Latex" }).eq("id", data!.id).select("allergies");
    expect(update.data).toEqual([{ allergies: "Latex" }]);
  });

  it("stylists can view clients but not add or edit them", async () => {
    const view = await stylist.from("clients").select("id, allergies, notes").eq("id", clientId);
    expect(view.data).toHaveLength(1);

    const insert = await stylist.from("clients").insert({ business_id: SEED.business, first_name: `${PREFIX} Nope` });
    expect(insert.error?.code).toBe("42501");

    const update = await stylist.from("clients").update({ notes: "changed" }).eq("id", clientId).select();
    expect(update.data).toEqual([]);
  });

  it("nobody can delete clients through the API", async () => {
    const id = await newClient();
    const removed = await owner.from("clients").delete().eq("id", id).select();
    expect(removed.data).toEqual([]);
    const { data } = await admin.from("clients").select("id").eq("id", id);
    expect(data).toHaveLength(1);
  });

  it("rejects a malformed email", async () => {
    const { error } = await frontDesk.from("clients").insert({ business_id: SEED.business, first_name: `${PREFIX} Bad`, email: "nope" });
    expect(error?.code).toBe("23514");
  });
});

describe("formulas", () => {
  it("a stylist can add an entry as themselves", async () => {
    const id = await newClient();
    const { error } = await stylist.from("client_formulas").insert({
      business_id: SEED.business,
      client_id: id,
      staff_id: SEED.staff.priya,
      formula: "6N + 6NB, 20 vol, 35 min",
    });
    expect(error).toBeNull();

    const { data } = await admin.from("client_formulas").select("staff_id, formula").eq("client_id", id);
    expect(data).toEqual([{ staff_id: SEED.staff.priya, formula: "6N + 6NB, 20 vol, 35 min" }]);
  });

  it("nobody can write an entry in someone else's name", async () => {
    const id = await newClient();
    const asOther = await stylist.from("client_formulas").insert({
      business_id: SEED.business,
      client_id: id,
      staff_id: SEED.staff.hannah,
      formula: "forged",
    });
    expect(asOther.error?.code).toBe("42501");

    const ownerForging = await owner.from("client_formulas").insert({
      business_id: SEED.business,
      client_id: id,
      staff_id: SEED.staff.priya,
      formula: "forged",
    });
    expect(ownerForging.error?.code).toBe("42501");
  });

  it("entries can't be edited or deleted, even by their author or the owner", async () => {
    const id = await newClient();
    const { data: entry } = await stylist
      .from("client_formulas")
      .insert({ business_id: SEED.business, client_id: id, staff_id: SEED.staff.priya, formula: "original" })
      .select("id")
      .single();

    for (const client of [stylist, owner]) {
      const update = await client.from("client_formulas").update({ formula: "changed" }).eq("id", entry!.id).select();
      expect(update.data).toEqual([]);
      const remove = await client.from("client_formulas").delete().eq("id", entry!.id).select();
      expect(remove.data).toEqual([]);
    }

    const { data } = await admin.from("client_formulas").select("formula").eq("id", entry!.id).single();
    expect(data!.formula).toBe("original");
  });

  it("rejects visit dates in the future", async () => {
    const id = await newClient();
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const { error } = await stylist.from("client_formulas").insert({
      business_id: SEED.business,
      client_id: id,
      staff_id: SEED.staff.priya,
      formula: "later",
      visit_date: future,
    });
    expect(error?.code).toBe("23514");
  });

  it("inactive staff can't add entries", async () => {
    const id = await newClient();
    await admin.from("staff").update({ is_active: false }).eq("id", SEED.staff.priya);
    try {
      const { error } = await stylist.from("client_formulas").insert({
        business_id: SEED.business,
        client_id: id,
        staff_id: SEED.staff.priya,
        formula: "after leaving",
      });
      expect(error?.code).toBe("42501");
    } finally {
      await admin.from("staff").update({ is_active: true }).eq("id", SEED.staff.priya);
    }
  });
});

describe("tenant isolation", () => {
  it("another salon sees none of this salon's clients or formulas", async () => {
    const clients = await otherOwner.from("clients").select("id").eq("business_id", SEED.business);
    expect(clients.data).toEqual([]);
    const formulas = await otherOwner.from("client_formulas").select("id").eq("business_id", SEED.business);
    expect(formulas.data).toEqual([]);
  });

  it("another salon can't add clients or edit this salon's clients", async () => {
    const insert = await otherOwner.from("clients").insert({ business_id: SEED.business, first_name: `${PREFIX} Intruder` });
    expect(insert.error?.code).toBe("42501");

    const update = await otherOwner.from("clients").update({ notes: "hacked" }).eq("id", clientId).select();
    expect(update.data).toEqual([]);
  });

  it("another salon can't attach formulas to this salon's clients", async () => {
    // Claiming its own business: the client isn't in it.
    const ownBusiness = await otherOwner.from("client_formulas").insert({
      business_id: other.businessId,
      client_id: clientId,
      staff_id: other.staffId,
      formula: "x",
    });
    expect(ownBusiness.error?.code).toBe("23503");

    // Claiming this salon's business: its staff member isn't in it.
    const thisBusiness = await otherOwner.from("client_formulas").insert({
      business_id: SEED.business,
      client_id: clientId,
      staff_id: other.staffId,
      formula: "x",
    });
    expect(thisBusiness.error?.code).toBe("42501");
  });

  it("a client's preferred stylist must work at the same salon", async () => {
    const { error } = await otherOwner
      .from("clients")
      .insert({ business_id: other.businessId, first_name: `${PREFIX} Poach`, preferred_staff_id: SEED.staff.priya });
    expect(error?.code).toBe("23503");
  });
});

describe("preferred stylist", () => {
  it("is cleared, not the whole client, when the stylist is removed", async () => {
    const { data: staff } = await admin
      .from("staff")
      .insert({ business_id: SEED.business, location_id: SEED.location, first_name: `${PREFIX} Temp`, role: "stylist" })
      .select("id")
      .single();
    const id = await newClient({ preferred_staff_id: staff!.id });

    await admin.from("staff").delete().eq("id", staff!.id);
    const { data } = await admin.from("clients").select("business_id, preferred_staff_id").eq("id", id).single();
    expect(data).toEqual({ business_id: SEED.business, preferred_staff_id: null });
  });
});
