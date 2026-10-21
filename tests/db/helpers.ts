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

// IDs from supabase/seed.sql.
export const SEED = {
  business: "b0000000-0000-4000-8000-000000000001",
  location: "c0000000-0000-4000-8000-000000000001",
  staff: {
    owner: "d0000000-0000-4000-8000-000000000001",
    manager: "d0000000-0000-4000-8000-000000000002",
    frontDesk: "d0000000-0000-4000-8000-000000000003",
    priya: "d0000000-0000-4000-8000-000000000004",
    marcus: "d0000000-0000-4000-8000-000000000005",
    hannah: "d0000000-0000-4000-8000-000000000006", // stylist, no login
    jamal: "d0000000-0000-4000-8000-000000000007",
    sofia: "d0000000-0000-4000-8000-000000000008",
    ethan: "d0000000-0000-4000-8000-000000000009",
  },
  staffCount: 9,
};

const options = { auth: { persistSession: false, autoRefreshToken: false } };

// Bypasses RLS. Only for test setup, cleanup and checking results.
export const admin: Client = createClient<Database>(url, secretKey, options);
export const anon: Client = createClient<Database>(url, publishableKey, options);

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
