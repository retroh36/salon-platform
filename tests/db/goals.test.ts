// Goals in the database: who may set, change, remove and see them, the
// alert preference and celebrations, and goal_progress's rebooking, new
// clients and what's booked ahead, checked against the rows directly.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const { bridget: BRIDGET, gil: GIL } = SEED.staff;

let owner: Client;
let manager: Client;
let frontDesk: Client;
let bridget: Client;
let saved: { staff_id: string; metric: string; period: string; target: number; set_by_owner: boolean; created_by: string | null; updated_by: string | null }[] = [];
const clients: string[] = [];

beforeAll(async () => {
  [owner, manager, frontDesk, bridget] = await Promise.all([
    signIn("owner@mapleandash.test"),
    signIn("manager@mapleandash.test"),
    signIn("frontdesk@mapleandash.test"),
    signIn("bridget@mapleandash.test"),
  ]);
  // Set the demo's goals aside, and put them back after.
  saved = (await admin.from("staff_goals").select("staff_id, metric, period, target, set_by_owner, created_by, updated_by").eq("business_id", B)).data!;
  await admin.from("staff_goals").delete().eq("business_id", B);
});

afterAll(async () => {
  await admin.from("staff_goals").delete().eq("business_id", B);
  if (saved.length) await admin.from("staff_goals").insert(saved.map((g) => ({ ...g, business_id: B })));
  await admin.from("staff").update({ goal_alerts: "daily", goal_alert_seen_on: null }).eq("id", BRIDGET);
  if (clients.length) {
    await admin.from("appointments").delete().in("client_id", clients);
    await admin.from("clients").delete().in("id", clients);
  }
});

const save = (c: Client, staffId: string, metric: string, period: string, target: number) =>
  c.rpc("save_staff_goal", { p_staff_id: staffId, p_metric: metric as never, p_period: period as never, p_target: target });

describe("who sets goals", () => {
  it("lets owners set anyone's; a stylist sets their own but can't change one an owner set", async () => {
    const { data: id, error } = await save(owner, BRIDGET, "service_revenue", "month", 900000);
    expect(error).toBeNull();
    expect((await save(bridget, BRIDGET, "service_revenue", "month", 500000)).error?.code).toBe("42501");
    expect((await bridget.rpc("delete_staff_goal", { p_goal_id: id! })).error?.code).toBe("42501");
    // Her own: set, changed and removed.
    const { data: own } = await save(bridget, BRIDGET, "rebooking_rate", "month", 65);
    expect((await save(bridget, BRIDGET, "rebooking_rate", "month", 70)).data).toBe(own);
    expect((await admin.from("staff_goals").select("target, set_by_owner").eq("id", own!).single()).data).toEqual({ target: 70, set_by_owner: false });
    expect((await save(bridget, BRIDGET, "rebooking_rate", "month", 120)).error).not.toBeNull();
    expect((await bridget.rpc("delete_staff_goal", { p_goal_id: own! })).error).toBeNull();
    // Nobody but an owner sets goals for others.
    for (const c of [manager, frontDesk, bridget]) expect((await save(c, GIL, "retail_revenue", "week", 30000)).error?.code).toBe("42501");
    expect((await save(owner, GIL, "retail_revenue", "week", 30000)).error).toBeNull();
  });

  it("shows owners and managers everyone's goals, and anyone else only their own", async () => {
    await save(bridget, BRIDGET, "new_clients", "quarter", 8);
    const seen = async (c: Client) => new Set(((await c.from("staff_goals").select("staff_id").eq("business_id", B)).data ?? []).map((g) => g.staff_id));
    for (const c of [owner, manager]) expect(await seen(c)).toEqual(new Set([BRIDGET, GIL]));
    expect(await seen(bridget)).toEqual(new Set([BRIDGET]));
    expect(await seen(frontDesk)).toEqual(new Set());
  });
});

describe("Denise's alert", () => {
  it("keeps their choice of daily or weekly, and records what they've seen and celebrated, for their own goals only", async () => {
    expect((await bridget.rpc("set_goal_alerts", { p_frequency: "weekly" })).error).toBeNull();
    expect((await admin.from("staff").select("goal_alerts").eq("id", BRIDGET).single()).data!.goal_alerts).toBe("weekly");
    expect((await bridget.rpc("set_goal_alerts", { p_frequency: "hourly" })).error).not.toBeNull();
    const { data: mine } = await admin.from("staff_goals").select("id").eq("staff_id", BRIDGET).eq("metric", "service_revenue").single();
    const { data: gils } = await admin.from("staff_goals").select("id").eq("staff_id", GIL).single();
    const milestones = [
      { goal_id: mine!.id, period_from: "2026-11-01", milestone: 50 },
      { goal_id: gils!.id, period_from: "2026-11-09", milestone: 100 },
    ];
    expect((await bridget.rpc("seen_goal_alert", { p_on: "2026-11-12", p_milestones: milestones })).error).toBeNull();
    expect((await admin.from("staff").select("goal_alert_seen_on").eq("id", BRIDGET).single()).data!.goal_alert_seen_on).toBe("2026-11-12");
    expect((await admin.from("goal_celebrations").select("goal_id, milestone").in("goal_id", [mine!.id, gils!.id])).data).toEqual([{ goal_id: mine!.id, milestone: 50 }]);
    // Bridget sees her own celebrations, not Gil's.
    expect((await bridget.from("goal_celebrations").select("goal_id")).data!.every((c) => c.goal_id === mine!.id)).toBe(true);
  });
});

describe("goal progress", () => {
  it("is for owners, managers and the stylist themselves", async () => {
    const range = { p_from: "2026-10-01T05:00:00Z", p_to: "2026-11-01T05:00:00Z" };
    for (const c of [owner, manager, bridget]) expect((await c.rpc("goal_progress", { p_staff_id: BRIDGET, ...range })).error).toBeNull();
    expect((await bridget.rpc("goal_progress", { p_staff_id: GIL, ...range })).error?.code).toBe("42501");
    expect((await frontDesk.rpc("goal_progress", { p_staff_id: BRIDGET, ...range })).error?.code).toBe("42501");
  });

  it("counts checkouts and rebooks where they were the main stylist, as the sales say", async () => {
    const range = { p_from: "2026-09-01T05:00:00Z", p_to: "2026-10-01T05:00:00Z" };
    const { data } = await owner.rpc("goal_progress", { p_staff_id: BRIDGET, ...range });
    const { data: sales } = await admin
      .from("sales")
      .select("rebook_appointment_id, sale_items(kind, staff_id, position)")
      .eq("business_id", B)
      .not("appointment_id", "is", null)
      .neq("status", "voided")
      .gte("created_at", range.p_from)
      .lt("created_at", range.p_to)
      .limit(5000);
    const hers = sales!.filter((s) => s.sale_items.filter((i) => i.kind === "service").sort((a, b) => a.position - b.position)[0]?.staff_id === BRIDGET);
    expect((data as { rebook: unknown }).rebook).toEqual({ visits: hers.length, rebooked: hers.filter((s) => s.rebook_appointment_id).length });
    expect(hers.length).toBeGreaterThan(0);
  });

  it("counts a first visit as a new client, and what's booked ahead, new clients among it", async () => {
    const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single();
    const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: "Goalie", last_name: "Test" }).select("id").single();
    clients.push(c!.id);
    // A completed first visit in 2020 and a second the next week; a visit booked ahead.
    const visit = async (start: string, status: "completed" | "booked", staff = BRIDGET, price = 10000) => {
      const end = new Date(Date.parse(start) + 3_600_000).toISOString();
      const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: c!.id, starts_at: start, ends_at: end, status }).select("id").single();
      await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: s!.id, staff_id: staff, starts_at: start, ends_at: end, active_minutes: 60, price_cents: price });
    };
    await visit("2020-03-03T16:00:00Z", "completed");
    await visit("2020-03-10T16:00:00Z", "completed");
    const first = await owner.rpc("goal_progress", { p_staff_id: BRIDGET, p_from: "2020-03-01T06:00:00Z", p_to: "2020-03-08T06:00:00Z" });
    const second = await owner.rpc("goal_progress", { p_staff_id: BRIDGET, p_from: "2020-03-08T06:00:00Z", p_to: "2020-03-15T05:00:00Z" });
    expect((first.data as { new_clients: number }).new_clients).toBe(1);
    expect((second.data as { new_clients: number }).new_clients).toBe(0);

    // A brand-new client booked with Bridget two days from now.
    const { data: n } = await admin.from("clients").insert({ business_id: B, first_name: "Newbie", last_name: "Test" }).select("id").single();
    clients.push(n!.id);
    const start = new Date(Date.now() + 2 * 86_400_000);
    const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: n!.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString(), status: "booked" }).select("id").single();
    await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: s!.id, staff_id: BRIDGET, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString(), active_minutes: 60, price_cents: 12345 });
    const range = { p_from: new Date().toISOString(), p_to: new Date(Date.now() + 5 * 86_400_000).toISOString() };
    const { data: ahead } = await bridget.rpc("goal_progress", { p_staff_id: BRIDGET, ...range });
    const { data: rows } = await admin
      .from("appointment_items")
      .select("price_cents, appointment:appointments!inner(id, status)")
      .eq("staff_id", BRIDGET)
      .in("appointment.status", ["booked", "confirmed", "checked_in"])
      .gte("starts_at", range.p_from)
      .lt("starts_at", range.p_to);
    const got = (ahead as { ahead: { service_cents: number; visits: number; new_clients: number } }).ahead;
    expect(got.service_cents).toBe(rows!.reduce((n, r) => n + r.price_cents, 0));
    expect(got.visits).toBe(new Set(rows!.map((r) => r.appointment.id)).size);
    expect(got.new_clients).toBeGreaterThanOrEqual(1);
  });
});
