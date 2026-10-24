// The owners' reports against the demo data: gift card and package
// liabilities (checked against the database independently), the day's
// close-out, Denise's owner-only answers, and credit in the morning brief.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { briefFacts } from "@/lib/denise/brief";
import { knowledgeFor, type Asker } from "@/lib/denise/knowledge";
import { loadCloseout, loadGiftCardLiability, loadUnusedPackages } from "@/lib/reports-load";
import { todayIn } from "@/lib/scheduling/time";
import { admin, DEFAULT_PERMISSIONS, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const today = todayIn(TZ);
const asker = (role: Asker["role"], staffId: string): Asker => ({ role, permissions: DEFAULT_PERMISSIONS[role], staffId, businessId: B, location: { id: L, timezone: TZ }, salon: "Maple & Ash", today });

let owner: Client;
let manager: Client;
let frontDesk: Client;

beforeAll(async () => {
  [owner, manager, frontDesk] = await Promise.all([signIn("owner@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
});

afterAll(async () => {
  await admin.from("cash_closeouts").delete().eq("location_id", L);
});

describe("what's owed", () => {
  it("adds up live purchased gift card balances, and unused package uses by what they're worth", async () => {
    const l = await loadGiftCardLiability(owner, B);
    const { data: cards } = await admin.from("gift_cards").select("balance_cents, expires_at").eq("business_id", B).eq("kind", "purchased").eq("status", "active").gt("balance_cents", 0);
    const live = cards!.filter((c) => !c.expires_at || new Date(c.expires_at) > new Date());
    expect(l.purchased).toEqual({ cents: live.reduce((n, c) => n + c.balance_cents, 0), count: live.length });
    expect(l.purchased.cents).toBeGreaterThan(0);
    expect(l.expired.count).toBeGreaterThan(0);

    const p = await loadUnusedPackages(owner, B);
    const { data: items } = await admin.from("client_package_items").select("total, used, use_value_cents, client_package:client_packages!inner(status)").eq("business_id", B).eq("client_package.status", "active");
    expect(p.cents).toBe(items!.reduce((n, i) => n + (i.total - i.used) * i.use_value_cents, 0));
    expect(p.clients.length).toBeGreaterThan(0);
  });

  it("is for owners and managers: the front desk gets Denise's answers without these totals", async () => {
    const forOwner = knowledgeFor(owner, asker("owner", SEED.staff.owner));
    const cards = (await forOwner.giftCards!()) as { purchased_balance_dollars: number };
    expect(cards.purchased_balance_dollars).toBe((await loadGiftCardLiability(owner, B)).purchased.cents / 100);
    const packages = (await forOwner.packages!(3)) as { clients: Record<string, unknown>[] };
    expect(packages.clients.length).toBeLessThanOrEqual(3);
    // First names only.
    expect(Object.keys(packages.clients[0])).toEqual(["first_name", "packages", "uses_left", "value_dollars"]);
    expect(knowledgeFor(manager, asker("manager", SEED.staff.manager)).giftCards).not.toBeNull();
    expect(knowledgeFor(frontDesk, asker("front_desk", SEED.staff.frontDesk)).giftCards).toBeNull();
    expect(knowledgeFor(frontDesk, asker("front_desk", SEED.staff.frontDesk)).packages).toBeNull();
  });
});

describe("closing out the day", () => {
  it("works out the expected cash itself, saves the count, and is for owners and managers only", async () => {
    const close = await loadCloseout(owner, B, { id: L, timezone: TZ }, today);
    const desk = await signIn("frontdesk@mapleandash.test");
    expect((await desk.rpc("save_closeout", { p_location_id: L, p_day: today, p_counted_cents: 1000, p_note: "" })).error?.code).toBe("42501");
    const { data: difference, error } = await owner.rpc("save_closeout", { p_location_id: L, p_day: today, p_counted_cents: close.expectedCashCents + 500, p_note: "Found a $5 tip" });
    expect(error).toBeNull();
    expect(difference).toBe(500);
    const { data: saved } = await owner.from("cash_closeouts").select("expected_cents, counted_cents, note").eq("location_id", L).eq("day", today).single();
    expect(saved).toEqual({ expected_cents: close.expectedCashCents, counted_cents: close.expectedCashCents + 500, note: "Found a $5 tip" });
    expect((await manager.from("cash_closeouts").select("id").eq("location_id", L)).data).toHaveLength(1);
    expect((await desk.from("cash_closeouts").select("id").eq("location_id", L)).data).toEqual([]);
  });

  it("counts the starting float: the salon's usual one, or the day's", async () => {
    await admin.from("cash_closeouts").delete().eq("location_id", L).eq("day", today);
    expect((await owner.rpc("set_checkout_settings", { p_business_id: B, p_settings: { cash_float_cents: 15000 } })).error).toBeNull();
    try {
      const close = await loadCloseout(owner, B, { id: L, timezone: TZ }, today);
      expect(close).toMatchObject({ floatCents: 15000, usualFloatCents: 15000, expectedCashCents: 15000 + close.cashNetCents });
      // The usual float, when the day's isn't given.
      expect((await owner.rpc("save_closeout", { p_location_id: L, p_day: today, p_counted_cents: close.expectedCashCents, p_note: "" })).data).toBe(0);
      // A different float for the day: $100 less expected.
      expect((await owner.rpc("save_closeout", { p_location_id: L, p_day: today, p_counted_cents: close.expectedCashCents, p_note: "", p_float_cents: 5000 })).data).toBe(10000);
      // It sticks for the day.
      expect((await loadCloseout(owner, B, { id: L, timezone: TZ }, today)).floatCents).toBe(5000);
      expect((await owner.rpc("save_closeout", { p_location_id: L, p_day: today, p_counted_cents: 0, p_note: "", p_float_cents: -1 })).error?.code).toBe("22023");
    } finally {
      await owner.rpc("set_checkout_settings", { p_business_id: B, p_settings: { cash_float_cents: 0 } });
      await admin.from("cash_closeouts").delete().eq("location_id", L).eq("day", today);
    }
  });
});

describe("the morning brief", () => {
  it("names today's clients with package uses or gift card money", async () => {
    // A client of our own with a package, booked today.
    const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: "Briefy", last_name: "Credit" }).select("id").single();
    try {
      const { data: template } = await admin.from("package_templates").select("id, price_cents").eq("business_id", B).eq("name", "5 Blowouts").single();
      const { error } = await frontDesk.rpc("complete_sale", { p_location_id: L, p_input: { client_id: c!.id, lines: [{ kind: "package", template_id: template!.id }], payments: [{ method: "card", amount_cents: template!.price_cents }] } as never });
      expect(error).toBeNull();
      const { data: service } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single();
      const start = new Date(Date.now() + 60_000);
      const end = new Date(start.getTime() + 45 * 60_000);
      const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: c!.id, starts_at: start.toISOString(), ends_at: end.toISOString() }).select("id").single();
      await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: service!.id, staff_id: SEED.staff.shae, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 45, price_cents: 4500 });

      const facts = await briefFacts(frontDesk, { businessId: B, location: { id: L, timezone: TZ } }, todayIn(TZ, start), { conflicts: [], openings: [] });
      expect(facts.credits).toContainEqual({ clientId: c!.id, appointmentId: a!.id, client: "Briefy C.", packages: ["5 Blowouts left"], giftCardCents: 0 });
    } finally {
      const { data: sales } = await admin.from("client_packages").select("sale_id").eq("client_id", c!.id);
      await admin.from("sales").delete().in("id", (sales ?? []).flatMap((x) => (x.sale_id ? [x.sale_id] : [])));
      await admin.from("appointments").delete().eq("client_id", c!.id);
      await admin.from("clients").delete().eq("id", c!.id);
    }
  });
});
