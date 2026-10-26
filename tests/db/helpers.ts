import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fromLocal, todayIn, toLocal, weekdayOf } from "@/lib/scheduling/time";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

if (!url || !publishableKey || !secretKey) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in .env.local");
}

export type Client = SupabaseClient<Database>;

// Runs SQL in the local database as its owner, for what the API can't
// reach (functions in the private schema, the clock). One value per line.
export function sql(text: string): string {
  return execFileSync("docker", ["exec", "-i", "supabase_db_salon-platform", "psql", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: text, encoding: "utf8" }).trim();
}

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
  owner: ["adjust_points", "big_discounts", "billing", "delete_business", "export_data", "payroll", "reports", "see_team_numbers", "settings", "team", "void_refund", "waive_fees"],
  manager: ["adjust_points", "big_discounts", "export_data", "payroll", "reports", "see_team_numbers", "settings", "team", "void_refund", "waive_fees"],
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

// A stylist of their own for a test's fixture visits, written straight into
// the tables: the database never double-books anyone, so visits set up at
// "now" can't share a seeded stylist with the demo calendar. Delete the
// visits first, then call remove().
export async function throwawayStylist(firstName: string, level: "artisan" | "senior" | "master" | null = null) {
  const { data, error } = await admin.from("staff").insert({ business_id: SEED.business, location_id: SEED.location, first_name: firstName, role: "stylist", level }).select("id").single();
  if (error) throw error;
  return {
    id: data.id,
    async remove() {
      const { error: e } = await admin.from("staff").delete().eq("id", data.id);
      if (e) throw e;
    },
  };
}

// Today at the salon as a known open day, for tests about "today" that
// would otherwise depend on when they run (the salon is closed Sundays and
// Mondays, and in the evening): the salon open all day on today's weekday
// and these stylists working all day today, on top of whatever the demo
// has today. Returns the undo, which puts the hours back as they were.
export async function openAllDay(staffIds: string[], { location = SEED.location, business = SEED.business, timeZone = "America/Chicago" } = {}) {
  const today = todayIn(timeZone);
  const weekday = weekdayOf(today);
  const check = <T>(r: { data: T | null; error: unknown }): T => {
    if (r.error) throw r.error;
    return r.data as T;
  };
  const hours = check(await admin.from("location_hours").select("business_id, location_id, weekday, start_minute, end_minute").eq("location_id", location).eq("weekday", weekday));
  const changes = check(await admin.from("staff_schedule_overrides").select("business_id, staff_id, on_date, start_minute, end_minute").in("staff_id", staffIds).eq("on_date", today));
  check(await admin.from("location_hours").delete().eq("location_id", location).eq("weekday", weekday));
  check(await admin.from("location_hours").insert({ business_id: business, location_id: location, weekday, start_minute: 0, end_minute: 1440 }));
  check(await admin.from("staff_schedule_overrides").delete().in("staff_id", staffIds).eq("on_date", today));
  check(await admin.from("staff_schedule_overrides").insert(staffIds.map((staff_id) => ({ business_id: business, staff_id, on_date: today, start_minute: 0, end_minute: 1440 }))));
  return async () => {
    check(await admin.from("location_hours").delete().eq("location_id", location).eq("weekday", weekday));
    if (hours.length) check(await admin.from("location_hours").insert(hours));
    check(await admin.from("staff_schedule_overrides").delete().in("staff_id", staffIds).eq("on_date", today));
    if (changes.length) check(await admin.from("staff_schedule_overrides").insert(changes));
  };
}

// The first day from today with visits on the demo calendar (the salon is
// closed Sundays and Mondays), and 11am there: a fixed clock for tests
// about "today" that would otherwise depend on the day they run.
export async function busyDay(timeZone = "America/Chicago") {
  const { data, error } = await admin
    .from("appointments")
    .select("starts_at")
    .eq("location_id", SEED.location)
    .neq("status", "canceled")
    .gte("starts_at", fromLocal(todayIn(timeZone), 0, timeZone)!.toISOString())
    .order("starts_at")
    .limit(1)
    .single();
  if (error) throw error;
  const date = toLocal(new Date(data.starts_at), timeZone).date;
  return { date, at11: fromLocal(date, 11 * 60, timeZone)! };
}

// Room on a seeded stylist's calendar for a test's own visit at a set
// time: whatever the demo has for them overlapping from-to (on a working
// day there's usually something) is marked as imported for the test, the
// one exemption from the database's no double-booking rule, so the fixture
// goes in beside it and nothing about those visits changes. Returns the
// undo: call it after the fixture's visits are deleted.
export async function makeRoom(staffId: string, from: Date, to: Date) {
  const { data, error } = await admin
    .from("appointment_items")
    .select("id")
    .eq("staff_id", staffId)
    .eq("holds_time", true)
    .eq("imported", false)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString());
  if (error) throw error;
  const ids = data.map((i) => i.id);
  if (ids.length) {
    const { error: e } = await admin.from("appointment_items").update({ imported: true }).in("id", ids);
    if (e) throw e;
  }
  return async () => {
    if (!ids.length) return;
    const { error: e } = await admin.from("appointment_items").update({ imported: false }).in("id", ids);
    if (e) throw e;
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
