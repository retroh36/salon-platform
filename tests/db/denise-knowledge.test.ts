// What Ask Denise's tools can see (lib/denise/knowledge.ts), as each role,
// against the demo data: stylists get their own stats and no money; owners
// and managers get sales; nobody gets client contact details or notes.
// Also usage logging and the brief cache are server-only.
import { beforeAll, describe, expect, it } from "vitest";
import { computeInsights } from "@/lib/insights/compute";
import { knowledgeFor, salesRange, type Asker } from "@/lib/denise/knowledge";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { admin, anon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const today = todayIn(TZ);
const asker = (role: Asker["role"], staffId: string): Asker => ({ role, staffId, businessId: B, location: { id: L, timezone: TZ }, salon: "Maple & Ash", today });

let owner: Client;
let frontDesk: Client;
let shae: Client;

beforeAll(async () => {
  [owner, frontDesk, shae] = await Promise.all([signIn("owner@mapleandash.test"), signIn("frontdesk@mapleandash.test"), signIn("shae@mapleandash.test")]);
  await computeInsights(admin, B);
});

// No contact details, notes or allergies in anything Claude would see.
const PRIVATE = /@|\(\d{3}\)|\d{3}-\d{4}|allerg|phone|email|"notes"|address/i;

describe("as a stylist", () => {
  const k = () => knowledgeFor(shae, asker("stylist", SEED.staff.shae));

  it("sees only their own durations, and is told so when asking about someone else", async () => {
    expect(await k().durations({ staffId: SEED.staff.bridget, serviceId: null })).toEqual({ restricted: "Stylists can see their own times only, not other stylists'." });
    const mine = (await k().durations({ staffId: null, serviceId: null })) as { rows: { stylist: string }[]; scope: string };
    expect(mine.scope).toBe("your own services");
    expect(mine.rows.length).toBeGreaterThan(0);
    expect(new Set(mine.rows.map((r) => r.stylist))).toEqual(new Set(["Shae"]));
  });

  it("sees their own regulars due back, their own rebooking rate, and no money", async () => {
    const overdue = (await k().overdue(20)) as { scope: string; clients: { usual_stylist: string | null }[] };
    expect(overdue.scope).toBe("your regulars");
    expect(overdue.clients.every((c) => c.usual_stylist === "Shae")).toBe(true);
    const salon = (await k().salon()) as { rebooking_by_stylist: { stylist: string }[]; salon_rebooked_percent: number | null };
    expect(salon.rebooking_by_stylist.map((r) => r.stylist)).toEqual(["Shae"]);
    expect(salon.salon_rebooked_percent).toBeNull();
    expect(k().sales).toBeNull();
    expect(k().fixes).toBeNull();
    const { data: someone } = await admin.from("clients").select("first_name").eq("business_id", B).gte("id", "e0000000-0000-4000-8000-000000000000").order("id").limit(1).single();
    const clients = JSON.stringify(await k().clients(someone!.first_name));
    expect(clients).not.toMatch(/spend|retail/);
    expect(clients).not.toMatch(PRIVATE);
  });
});

describe("as the front desk", () => {
  const k = () => knowledgeFor(frontDesk, asker("front_desk", SEED.staff.frontDesk));

  it("sees client habits with spend, by first name only", async () => {
    const { data: c } = await admin.from("clients").select("first_name").eq("business_id", B).gte("id", "e0000000-0000-4000-8000-000000000000").order("id").limit(1).single();
    const out = (await k().clients(c!.first_name)) as { matches: Record<string, unknown>[] };
    expect(out.matches.length).toBeGreaterThan(0);
    expect(out.matches[0].first_name).toBe(c!.first_name);
    expect(Object.keys(out.matches.find((m) => (m.visits as number) > 0) ?? {})).toEqual(expect.arrayContaining(["usual_gap_days", "due_status", "lifetime_spend_dollars"]));
    expect(JSON.stringify(out)).not.toMatch(PRIVATE);
    expect(JSON.stringify(out)).not.toContain("last_name");
  });

  it("gets every stylist's durations, the salon's patterns and a day's schedule with first names", async () => {
    const all = (await k().durations({ staffId: null, serviceId: null })) as { rows: { stylist: string }[] };
    expect(new Set(all.rows.map((r) => r.stylist)).size).toBeGreaterThan(3);
    const salon = (await k().salon()) as { running_over_by_day: { day: string }[]; busiest_hours: unknown[] };
    expect(salon.running_over_by_day.length).toBeGreaterThan(3);
    expect(salon.busiest_hours).toHaveLength(3);
    const day = JSON.stringify(await k().schedule(today));
    expect(day).not.toMatch(PRIVATE);
  });

  it("has no sales, but can look for fixes, with clients' first names only", async () => {
    expect(k().sales).toBeNull();
    const fixes = JSON.stringify(await k().fixes!(today));
    const { data: visits } = await admin
      .from("appointments")
      .select("client:clients(last_name)")
      .eq("location_id", L)
      .gte("starts_at", startOfLocalDay(today, TZ).toISOString())
      .lt("starts_at", startOfLocalDay(addDays(today, 1), TZ).toISOString());
    const lastNames = new Set(visits!.flatMap((v) => (v.client?.last_name ? [v.client.last_name] : [])));
    expect(lastNames.size).toBeGreaterThan(0);
    for (const name of lastNames) expect(fixes).not.toContain(name);
    const stock = (await k().stock("olaplex")) as { products: { product: string }[] };
    expect(stock.products.every((p) => p.product.includes("Olaplex"))).toBe(true);
  });
});

describe("as the owner", () => {
  it("gets sales from the sales taken at checkout", async () => {
    const k = knowledgeFor(owner, asker("owner", SEED.staff.owner));
    const out = (await k.sales!("last_30_days")) as { from: string; to: string; services_dollars: number; retail_dollars: number; visits_checked_out: number; previous_period: { from: string } };
    const range = salesRange("last_30_days", today);
    expect(out).toMatchObject({ from: range.from, to: range.to });
    expect(out.previous_period.from).toBe(addDays(range.from, -30));
    // The change is worked out for Claude, not by it.
    const o = out as unknown as { total_dollars: number; previous_period: { total_dollars: number }; change: { total_dollars: number } };
    expect(o.change.total_dollars).toBeCloseTo(o.total_dollars - o.previous_period.total_dollars, 2);

    // The same sums, worked out independently from the sales taken (the
    // demo's checked-out visits all have one).
    const start = startOfLocalDay(range.from, TZ).toISOString();
    const end = startOfLocalDay(addDays(range.to, 1), TZ).toISOString();
    let cents = 0;
    const visits = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const { data } = await admin.from("sales").select("appointment_id, sale_items(kind, unit_price_cents, quantity, discount_cents)").eq("location_id", L).neq("status", "voided").gte("created_at", start).lt("created_at", end).order("id").range(offset, offset + 999);
      for (const sale of data!) {
        for (const i of sale.sale_items) if (i.kind === "service") cents += i.unit_price_cents * i.quantity - i.discount_cents;
        if (sale.appointment_id) visits.add(sale.appointment_id);
      }
      if (data!.length < 1000) break;
    }
    expect(out.services_dollars).toBe(cents / 100);
    expect(out.visits_checked_out).toBe(visits.size);
    expect(visits.size).toBeGreaterThan(100);
    expect(out.retail_dollars).toBeGreaterThan(0);
  });
});

describe("usage and the brief cache", () => {
  it("only the server records usage; owners and managers read it, the front desk doesn't", async () => {
    const args = { p_business_id: B, p_model: "claude-haiku-5-5", p_feature: "test_feature", p_input: 100, p_output: 20, p_cache_read: 0 };
    expect((await owner.rpc("record_ai_usage", args)).error?.code).toBe("42501");
    expect((await anon.rpc("record_ai_usage", args)).error?.code).toBe("42501");
    expect((await admin.rpc("record_ai_usage", args)).error).toBeNull();
    await admin.rpc("record_ai_usage", args);
    const { data } = await owner.from("ai_usage").select("requests, input_tokens, output_tokens").eq("business_id", B).eq("feature", "test_feature").single();
    expect(data).toEqual({ requests: 2, input_tokens: 200, output_tokens: 40 });
    expect((await frontDesk.from("ai_usage").select("feature").eq("feature", "test_feature")).data).toEqual([]);
    const { data: today } = await admin.rpc("ai_usage_today", { p_business_id: B });
    expect(Number(today![0].used)).toBeGreaterThanOrEqual(240);
    expect(today![0].daily_limit).toBe(1500000);
    await admin.from("ai_usage").delete().eq("feature", "test_feature");
  });

  it("keeps the cached brief away from staff", async () => {
    await admin.from("denise_briefs").upsert({ location_id: L, day: today, facts_hash: "a".repeat(64), text: "Test brief", model: "claude-sonnet-5-5" });
    expect((await owner.from("denise_briefs").select("text")).data).toEqual([]);
    await admin.from("denise_briefs").delete().eq("location_id", L);
  });
});
