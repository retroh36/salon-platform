// The bookkeeper (migrations …_bookkeeper_role.sql, …_bookkeeper_access.sql):
// the money (sales, payments, close-outs, gift cards, fees, packages,
// memberships, payroll once an owner allows it), and none of the calendar
// or client details; reading only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "@/lib/scheduling/time";
import { admin, DEFAULT_PERMISSIONS, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
let books: Client;
let owner: Client;

beforeAll(async () => {
  [books, owner] = await Promise.all([signIn("books@mapleandash.test"), signIn("owner@mapleandash.test")]);
});

afterAll(async () => {
  await admin.from("staff_permissions").delete().eq("staff_id", SEED.staff.bookkeeper);
});

const count = async (c: Client, table: string) => {
  const { count, error } = await c.from(table as "sales").select("business_id", { count: "exact", head: true }).eq("business_id", B);
  if (error) throw new Error(`${table}: ${error.code} ${error.message}`);
  return count ?? 0;
};

describe("a bookkeeper", () => {
  it("has Reports and the audit trail, and only money switches can be turned on", async () => {
    expect((await books.rpc("my_permissions", { p_business_id: B })).data).toEqual(DEFAULT_PERMISSIONS.bookkeeper);
    const { data } = await owner.rpc("staff_permission_list", { p_staff_id: SEED.staff.bookkeeper });
    expect(data!.filter((r) => r.toggleable).map((r) => r.permission).sort()).toEqual(["audit", "export_data", "payroll", "reports"]);
  });

  it("reads every sale, payment, close-out, gift card, fee, package and membership", async () => {
    for (const table of ["sales", "payments", "sale_items", "sale_tips", "gift_cards", "gift_card_events", "policy_fees", "client_packages", "client_memberships", "reward_points"])
      expect(await count(books, table), table).toBe(await count(admin, table));
  });

  it("reads no client, visit, event, formula or calendar detail", async () => {
    const tables = ["clients", "appointments", "appointment_items", "events", "client_formulas", "visit_photos", "time_blocks", "schedule_disruptions", "appointment_groups", "appointment_series", "waitlist_entries", "walk_ins", "client_messages", "insights"];
    const seen = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(books, t)])));
    expect(seen).toEqual(Object.fromEntries(tables.map((t) => [t, 0])));
    // A sale's client comes back empty.
    const { data } = await books.from("sales").select("client:clients(first_name)").not("client_id", "is", null).limit(1).single();
    expect(data!.client).toBeNull();
  });

  it("changes nothing: no close-out, discount, void, sale or client", async () => {
    const today = todayIn("America/Chicago");
    expect((await books.rpc("save_closeout", { p_location_id: L, p_day: today, p_counted_cents: 0, p_note: "" })).error?.code).toBe("42501");
    expect((await books.rpc("count_drawer", { p_location_id: L, p_kind: "mid", p_counted_cents: 0 })).error?.code).toBe("42501");
    const { data: sale } = await admin.from("sales").select("id").eq("business_id", B).eq("status", "completed").limit(1).single();
    expect((await books.rpc("void_sale", { p_sale_id: sale!.id, p_reason: "test" })).error?.code).toBe("42501");
    expect((await books.from("clients").insert({ business_id: B, first_name: "No", last_name: "One" })).error).not.toBeNull();
  });

  it("gets everyone's payroll only once an owner turns it on", async () => {
    const args = { p_business_id: B, p_from: new Date(Date.now() - 30 * 86_400_000).toISOString(), p_to: new Date().toISOString(), p_staff_id: null as unknown as string };
    expect((await books.rpc("payroll_sales", args)).error?.code).toBe("42501");
    await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.bookkeeper, p_permission: "payroll", p_allowed: true });
    const { data, error } = await books.rpc("payroll_sales", args);
    expect(error).toBeNull();
    expect((data as unknown[]).length).toBeGreaterThan(0);
  });
});
