import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

if (!url || !publishableKey || !secretKey) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in .env.local");
}

export type Client = SupabaseClient<Database>;

export const PASSWORD = "password123";

// IDs from supabase/seed.sql. The tests also expect the demo month from
// supabase/seed-demo.sql (npm run seed:demo).
export const SEED = {
  business: "b0000000-0000-4000-8000-000000000001",
  location: "c0000000-0000-4000-8000-000000000001",
  staff: {
    owner: "d0000000-0000-4000-8000-000000000001",
    manager: "d0000000-0000-4000-8000-000000000002",
    frontDesk: "d0000000-0000-4000-8000-000000000003",
    bridget: "d0000000-0000-4000-8000-000000000004",
    gil: "d0000000-0000-4000-8000-000000000005",
    hannah: "d0000000-0000-4000-8000-000000000006",
    nola: "d0000000-0000-4000-8000-000000000007",
    sandra: "d0000000-0000-4000-8000-000000000008",
    shae: "d0000000-0000-4000-8000-000000000009",
    lois: "d0000000-0000-4000-8000-000000000010",
    ari: "d0000000-0000-4000-8000-000000000011",
  },
  staffCount: 11,
  // The second, larger demo salon (supabase/seed-large.sql): 35 stylists.
  large: {
    business: "b1000000-0000-4000-8000-000000000001",
    location: "c1000000-0000-4000-8000-000000000001",
    owner: "d1000000-0000-4000-8000-000000000001",
    stylists: 35,
  },
};

const options = { auth: { persistSession: false, autoRefreshToken: false } };

// Bypasses RLS. Only for test setup, cleanup and checking results.
export const admin: Client = createClient<Database>(url, secretKey, options);
export const anon: Client = createClient<Database>(url, publishableKey, options);

// What each role can do by default (private.role_default; owners can't be
// limited). tests/db/permissions.test.ts checks the database agrees.
export const DEFAULT_PERMISSIONS: Record<"owner" | "manager" | "front_desk" | "stylist" | "assistant", string[]> = {
  owner: ["big_discounts", "billing", "delete_business", "export_data", "payroll", "reports", "see_team_numbers", "settings", "team", "void_refund", "waive_fees"],
  manager: ["big_discounts", "export_data", "payroll", "reports", "see_team_numbers", "settings", "team", "void_refund", "waive_fees"],
  front_desk: [],
  stylist: [],
  assistant: [],
};

export async function signIn(email: string): Promise<Client> {
  const client = createClient<Database>(url, publishableKey, options);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

// A second salon with its own owner login, to check tenants can't see each
// other. Call cleanup() in afterAll.
export async function createOtherSalon() {
  const email = `owner-${crypto.randomUUID()}@othersalon.test`;

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userError) throw userError;

  const { data: business, error: bError } = await admin
    .from("businesses")
    .insert({ name: "Other Salon" })
    .select("id")
    .single();
  if (bError) throw bError;

  const { data: location, error: lError } = await admin
    .from("locations")
    .insert({ business_id: business.id, name: "Other Salon Main", timezone: "America/New_York" })
    .select("id")
    .single();
  if (lError) throw lError;

  const { data: staff, error: sError } = await admin
    .from("staff")
    .insert({ business_id: business.id, location_id: location.id, user_id: user.user.id, first_name: "Other", role: "owner" })
    .select("id")
    .single();
  if (sError) throw sError;

  return {
    email,
    userId: user.user.id,
    businessId: business.id,
    locationId: location.id,
    staffId: staff.id,
    async cleanup() {
      await admin.from("businesses").delete().eq("id", business.id);
      await admin.auth.admin.deleteUser(user.user.id);
    },
  };
}

// The default seed has a clear calendar; the tests need the demo month.
export async function requireDemoData() {
  const { count, error } = await admin.from("appointments").select("id", { count: "exact", head: true }).eq("business_id", SEED.business);
  if (error) throw error;
  if (!count) throw new Error("These tests need the demo data. Run `npm run seed:demo` first.");
}

// Denise's risk check flags visits likely to run over from what she's
// learned. Tests about reported problems set that aside, then restore it.
export async function setAsideLearnedDurations() {
  const { error } = await admin.from("insights").delete().eq("business_id", SEED.business).eq("kind", "duration");
  if (error) throw error;
}

export async function restoreLearnedDurations() {
  const { computeInsights } = await import("@/lib/insights/compute");
  await computeInsights(admin, SEED.business);
}

// How many rows a business has right now, for tests that check counts
// against the database rather than the seed's numbers (so clients or staff
// added while testing by hand don't break them).
// For staff, `locationId` counts one location's team.
export async function countFor(table: "clients" | "staff", businessId: string = SEED.business, locationId?: string): Promise<number> {
  const { count, error } =
    table === "staff" && locationId
      ? await admin.from("staff").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("location_id", locationId)
      : await admin.from(table).select("id", { count: "exact", head: true }).eq("business_id", businessId);
  if (error) throw error;
  return count ?? 0;
}

// The seed's own clients: their ids are fixed (e0000000-…), so this stays
// 500 whatever else is added.
export const SEEDED_CLIENT_IDS = { from: "e0000000-0000-4000-8000-000000000000", to: "e0000000-0000-4000-8000-0000ffffffff" };
