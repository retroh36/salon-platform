// Row Level Security checks against the local Supabase database.
// Run with `npm run test:db` after `npx supabase db reset`.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "password123";
const SEED_BUSINESS = "b0000000-0000-4000-8000-000000000001";
const SEED_LOCATION = "c0000000-0000-4000-8000-000000000001";
const SEED_STYLIST = "d0000000-0000-4000-8000-000000000006"; // Hannah, no login
const SEED_STAFF_COUNT = 9;

type Client = SupabaseClient<Database>;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

const admin: Client = createClient<Database>(url, secretKey, options);
const anon: Client = createClient<Database>(url, publishableKey, options);

async function signIn(email: string): Promise<Client> {
  const client = createClient<Database>(url, publishableKey, options);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

// A second salon, created fresh for this run, to check tenants can't see each other.
const other = { email: `owner-${Date.now()}@othersalon.test`, userId: "", businessId: "", locationId: "" };

let owner: Client;
let manager: Client;
let stylist: Client;
let otherOwner: Client;

beforeAll(async () => {
  if (!url || !publishableKey || !secretKey) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in .env.local");
  }

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email: other.email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userError) throw userError;
  other.userId = user.user.id;

  const { data: business, error: bError } = await admin
    .from("businesses")
    .insert({ name: "Other Salon" })
    .select("id")
    .single();
  if (bError) throw bError;
  other.businessId = business.id;

  const { data: location, error: lError } = await admin
    .from("locations")
    .insert({ business_id: other.businessId, name: "Other Salon Main", timezone: "America/New_York" })
    .select("id")
    .single();
  if (lError) throw lError;
  other.locationId = location.id;

  const { error: sError } = await admin.from("staff").insert({
    business_id: other.businessId,
    location_id: other.locationId,
    user_id: other.userId,
    first_name: "Other",
    role: "owner",
  });
  if (sError) throw sError;

  [owner, manager, stylist, otherOwner] = await Promise.all([
    signIn("owner@mapleandash.test"),
    signIn("manager@mapleandash.test"),
    signIn("priya@mapleandash.test"),
    signIn(other.email),
  ]);
});

afterAll(async () => {
  if (other.businessId) await admin.from("businesses").delete().eq("id", other.businessId);
  if (other.userId) await admin.auth.admin.deleteUser(other.userId);
});

describe("signed-out visitors", () => {
  it("see no businesses, locations or staff", async () => {
    for (const table of ["businesses", "locations", "staff"] as const) {
      const { data, error } = await anon.from(table).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });
});

describe("tenant isolation", () => {
  it("each owner sees only their own business", async () => {
    const mine = await owner.from("businesses").select("id");
    expect(mine.data?.map((b) => b.id)).toEqual([SEED_BUSINESS]);

    const theirs = await otherOwner.from("businesses").select("id");
    expect(theirs.data?.map((b) => b.id)).toEqual([other.businessId]);
  });

  it("each owner sees only their own staff", async () => {
    const mine = await owner.from("staff").select("business_id");
    expect(mine.data).toHaveLength(SEED_STAFF_COUNT);
    expect(new Set(mine.data?.map((s) => s.business_id))).toEqual(new Set([SEED_BUSINESS]));

    const theirs = await otherOwner.from("staff").select("business_id");
    expect(theirs.data).toHaveLength(1);
  });

  it("an owner can't add staff to another business", async () => {
    const { error } = await otherOwner.from("staff").insert({
      business_id: SEED_BUSINESS,
      location_id: SEED_LOCATION,
      first_name: "Intruder",
    });
    expect(error?.code).toBe("42501"); // RLS violation
  });

  it("an owner can't update or delete another business's staff", async () => {
    const update = await otherOwner.from("staff").update({ first_name: "Hacked" }).eq("id", SEED_STYLIST).select();
    expect(update.data).toEqual([]);

    const remove = await otherOwner.from("staff").delete().eq("id", SEED_STYLIST).select();
    expect(remove.data).toEqual([]);

    const { data } = await admin.from("staff").select("first_name").eq("id", SEED_STYLIST).single();
    expect(data?.first_name).toBe("Hannah");
  });

  it("staff can't be attached to a location in another business", async () => {
    const { error } = await otherOwner.from("staff").insert({
      business_id: other.businessId,
      location_id: SEED_LOCATION,
      first_name: "Wrong location",
    });
    expect(error).not.toBeNull();
  });
});

describe("roles", () => {
  it("stylists can view staff but not change them", async () => {
    const { data } = await stylist.from("staff").select("id");
    expect(data).toHaveLength(SEED_STAFF_COUNT);

    const insert = await stylist.from("staff").insert({
      business_id: SEED_BUSINESS,
      location_id: SEED_LOCATION,
      first_name: "New",
    });
    expect(insert.error?.code).toBe("42501");

    const update = await stylist.from("staff").update({ first_name: "Changed" }).eq("id", SEED_STYLIST).select();
    expect(update.data).toEqual([]);
  });

  it("managers can edit stylists", async () => {
    const { data, error } = await manager
      .from("staff")
      .update({ phone: "(555) 010-0199" })
      .eq("id", SEED_STYLIST)
      .select("phone");
    expect(error).toBeNull();
    expect(data).toEqual([{ phone: "(555) 010-0199" }]);

    await admin.from("staff").update({ phone: "(555) 010-0106" }).eq("id", SEED_STYLIST);
  });

  it("managers can't promote anyone to owner", async () => {
    const { error } = await manager.from("staff").update({ role: "owner" }).eq("id", SEED_STYLIST);
    expect(error?.code).toBe("42501");
  });

  it("only owners can update the business", async () => {
    const byManager = await manager.from("businesses").update({ plan: "pro" }).eq("id", SEED_BUSINESS).select();
    expect(byManager.data).toEqual([]);

    const byOwner = await owner.from("businesses").update({ plan: "trial" }).eq("id", SEED_BUSINESS).select("plan");
    expect(byOwner.data).toEqual([{ plan: "trial" }]);
  });
});
