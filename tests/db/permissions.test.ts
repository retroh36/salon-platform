import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { admin, DEFAULT_PERMISSIONS, SEED, signIn, type Client } from "./helpers";

// Roles and per-person permissions (migration …_permissions.sql): what
// each role can and can't reach, owners' toggles, stylists' and assistants'
// own book, the front desk's today-only sales, and the shared iPad's PINs.

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const today = todayIn(TZ);
const startOfToday = startOfLocalDay(today, TZ).toISOString();

let owner: Client;
let manager: Client;
let frontDesk: Client;
let bridget: Client;
let ari: Client;

beforeAll(async () => {
  [owner, manager, frontDesk, bridget, ari] = await Promise.all(
    ["owner", "manager", "frontdesk", "bridget", "ari"].map((n) => signIn(`${n}@mapleandash.test`)),
  );
});

afterAll(async () => {
  await admin.from("staff_permissions").delete().eq("business_id", B);
  await admin.from("staff").update({ assists_staff_id: SEED.staff.bridget }).eq("id", SEED.staff.ari);
  await admin.from("staff_pins").update({ failed_attempts: 0, locked_until: null }).eq("business_id", B);
});

const permissionsOf = async (c: Client) => {
  const { data, error } = await c.rpc("my_permissions", { p_business_id: B });
  if (error) throw error;
  return [...(data ?? [])].sort();
};

describe("each role's defaults", () => {
  it("match what the app expects", async () => {
    expect(await permissionsOf(owner)).toEqual(DEFAULT_PERMISSIONS.owner);
    expect(await permissionsOf(manager)).toEqual(DEFAULT_PERMISSIONS.manager);
    expect(await permissionsOf(frontDesk)).toEqual(DEFAULT_PERMISSIONS.front_desk);
    expect(await permissionsOf(bridget)).toEqual(DEFAULT_PERMISSIONS.stylist);
    expect(await permissionsOf(ari)).toEqual(DEFAULT_PERMISSIONS.assistant);
  });
});

describe("the front desk", () => {
  it("can't reach payroll, pay rates, reports, the data export or settings", async () => {
    const { error: payroll } = await frontDesk.rpc("payroll_sales", { p_business_id: B, p_from: addDays(today, -14), p_to: today });
    // Payroll gives anyone but owners and managers only their own lines.
    expect(payroll === null || payroll.code === "42501").toBe(true);
    // Only their own pay rate.
    const { data: rates } = await frontDesk.from("staff_compensation").select("staff_id");
    expect(rates!.map((r) => r.staff_id)).toEqual([SEED.staff.frontDesk]);
    const { error: closeout } = await frontDesk.rpc("save_closeout", { p_location_id: L, p_day: today, p_counted_cents: 0, p_note: "" });
    expect(closeout?.code).toBe("42501");
    const { error: exportLog } = await frontDesk.rpc("log_data_export", { p_business_id: B, p_bytes: 1, p_row_counts: {} });
    expect(exportLog?.code).toBe("42501");
    const { data: renamed } = await frontDesk.from("businesses").update({ receipt_footer: "x" }).eq("id", B).select("id");
    expect(renamed).toEqual([]);
  });

  it("sees today's sales but not earlier ones, unless an owner gives them reports", async () => {
    const { count: older } = await admin.from("sales").select("id", { count: "exact", head: true }).eq("business_id", B).lt("created_at", startOfToday);
    expect(older).toBeGreaterThan(0);
    const { data: seen } = await frontDesk.from("sales").select("id, created_at").lt("created_at", startOfToday).limit(5);
    expect(seen).toEqual([]);
    const { data: payments } = await frontDesk.from("payments").select("id, sale:sales!inner(created_at)").lt("sale.created_at", startOfToday).limit(5);
    expect(payments).toEqual([]);

    const { error } = await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.frontDesk, p_permission: "reports", p_allowed: true });
    expect(error).toBeNull();
    expect(await permissionsOf(frontDesk)).toContain("reports");
    const { data: now } = await frontDesk.from("sales").select("id").lt("created_at", startOfToday).limit(1);
    expect(now).toHaveLength(1);

    await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.frontDesk, p_permission: "reports", p_allowed: false });
    const { data: back } = await frontDesk.from("sales").select("id").lt("created_at", startOfToday).limit(1);
    expect(back).toEqual([]);
  });

  it("can't void a sale until an owner allows it", async () => {
    const { data: sale } = await admin.from("sales").select("id").eq("business_id", B).eq("status", "completed").gte("created_at", startOfToday).limit(1).maybeSingle();
    const id = sale?.id ?? "00000000-0000-4000-8000-000000000000";
    const { error } = await frontDesk.rpc("void_sale", { p_sale_id: id, p_reason: "test" });
    expect(error?.code).toBe("42501");
  });
});

describe("managers", () => {
  it("can't change the plan or Denise's limit (billing), or anyone's permissions", async () => {
    const { error: plan } = await manager.from("businesses").update({ plan: "pro" }).eq("id", B);
    expect(plan?.code).toBe("42501");
    const { error: limit } = await manager.from("businesses").update({ ai_daily_token_limit: 1 }).eq("id", B);
    expect(limit?.code).toBe("42501");
    const { error: toggle } = await manager.rpc("set_staff_permission", { p_staff_id: SEED.staff.frontDesk, p_permission: "reports", p_allowed: true });
    expect(toggle?.code).toBe("42501");
  });

  it("lose what an owner switches off", async () => {
    await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.manager, p_permission: "payroll", p_allowed: false });
    const { data: rates } = await manager.from("staff_compensation").select("staff_id");
    expect(rates!.map((r) => r.staff_id)).toEqual([SEED.staff.manager]);
    const { error } = await manager.rpc("set_payroll_settings", { p_business_id: B, p_pay_period: "weekly", p_anchor: today });
    expect(error?.code).toBe("42501");
    await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.manager, p_permission: "payroll", p_allowed: null as unknown as boolean });
    const { data: restored } = await manager.from("staff_compensation").select("staff_id");
    expect(restored!.length).toBeGreaterThan(1);
  });
});

describe("owners' toggles", () => {
  it("only change what the role allows, never billing, and never for an owner", async () => {
    const { error: billing } = await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.manager, p_permission: "billing", p_allowed: true });
    expect(billing?.code).toBe("22023");
    const { error: stylistPayroll } = await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.bridget, p_permission: "payroll", p_allowed: true });
    expect(stylistPayroll?.code).toBe("22023");
    const { error: ownerToggle } = await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.owner, p_permission: "reports", p_allowed: false });
    expect(ownerToggle?.code).toBe("22023");
    const { data: list } = await owner.rpc("staff_permission_list", { p_staff_id: SEED.staff.bridget });
    expect(list!.filter((r) => r.toggleable).map((r) => r.permission)).toEqual(["see_team_numbers"]);
  });

  it("let a stylist see other stylists' numbers", async () => {
    const { data: goal } = await admin
      .from("staff_goals")
      .upsert({ business_id: B, staff_id: SEED.staff.gil, metric: "average_ticket", period: "quarter", target: 12000, set_by_owner: true }, { onConflict: "staff_id,metric,period" })
      .select("id")
      .single();
    try {
      const { data: before } = await bridget.from("staff_goals").select("id").eq("id", goal!.id);
      expect(before).toEqual([]);
      await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.bridget, p_permission: "see_team_numbers", p_allowed: true });
      const { data: after } = await bridget.from("staff_goals").select("id").eq("id", goal!.id);
      expect(after).toHaveLength(1);
    } finally {
      await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.bridget, p_permission: "see_team_numbers", p_allowed: false });
      await admin.from("staff_goals").delete().eq("id", goal!.id);
    }
  });
});

describe("stylists and assistants", () => {
  it("a stylist sees only clients on their own book, and only their own pay", async () => {
    const { count: all } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("business_id", B);
    const { count: mine } = await bridget.from("clients").select("id", { count: "exact", head: true });
    expect(mine).toBeGreaterThan(0);
    expect(mine).toBeLessThan(all!);
    const { data: rates } = await bridget.from("staff_compensation").select("staff_id");
    expect(rates!.map((r) => r.staff_id)).toEqual([SEED.staff.bridget]);
    const { data: sales } = await bridget.from("sales").select("id").limit(1);
    expect(sales).toEqual([]);
  });

  it("an assistant sees their stylist's visits and clients, and no money", async () => {
    // Every visit they see has Bridget on it (a shared visit shows all of it).
    const { data: items } = await ari.from("appointment_items").select("appointment_id, staff_id").limit(1000);
    expect(items!.length).toBeGreaterThan(0);
    const withBridget = new Set(items!.filter((i) => i.staff_id === SEED.staff.bridget).map((i) => i.appointment_id));
    expect(items!.every((i) => withBridget.has(i.appointment_id))).toBe(true);
    const { count: hers } = await admin.from("appointment_items").select("id", { count: "exact", head: true }).eq("staff_id", SEED.staff.bridget);
    const { count: seen } = await ari.from("appointment_items").select("id", { count: "exact", head: true }).eq("staff_id", SEED.staff.bridget);
    expect(seen).toBe(hers);
    const { count: bridgetsClients } = await bridget.from("clients").select("id", { count: "exact", head: true });
    const { count: arisClients } = await ari.from("clients").select("id", { count: "exact", head: true });
    expect(arisClients).toBe(bridgetsClients);
    const { data: sales } = await ari.from("sales").select("id").limit(1);
    expect(sales).toEqual([]);
    const { data: rates } = await ari.from("staff_compensation").select("staff_id");
    expect(rates!.map((r) => r.staff_id)).toEqual([SEED.staff.ari]);
    // Read-only: they can't check anyone in.
    const { data: visit } = await admin.from("appointment_items").select("appointment_id").eq("staff_id", SEED.staff.bridget).gte("starts_at", startOfToday).limit(1).single();
    const { error } = await ari.rpc("set_appointment_status", { p_appointment_id: visit!.appointment_id, p_status: "checked_in", p_reason: "" });
    expect(error?.code).toBe("42501");
  });

  it("an assistant with no stylist sees no one's book", async () => {
    const { error } = await manager.rpc("set_assistant_stylist", { p_staff_id: SEED.staff.ari, p_stylist_id: null as unknown as string });
    expect(error).toBeNull();
    const { data } = await ari.from("appointment_items").select("id").limit(1);
    expect(data).toEqual([]);
    await manager.rpc("set_assistant_stylist", { p_staff_id: SEED.staff.ari, p_stylist_id: SEED.staff.bridget });
  });

  it("only owners and managers choose an assistant's stylist, and only a stylist", async () => {
    const { error: desk } = await frontDesk.rpc("set_assistant_stylist", { p_staff_id: SEED.staff.ari, p_stylist_id: SEED.staff.gil });
    expect(desk?.code).toBe("42501");
    const { error: notStylist } = await manager.rpc("set_assistant_stylist", { p_staff_id: SEED.staff.ari, p_stylist_id: SEED.staff.frontDesk });
    expect(notStylist?.code).toBe("22023");
  });
});

describe("the shared iPad's PINs", () => {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  let deviceId: string;

  beforeAll(async () => {
    const { data, error } = await manager.rpc("register_shared_device", { p_location_id: L, p_name: "Test iPad", p_token_hash: hash });
    if (error) throw error;
    deviceId = data;
  });
  afterAll(async () => {
    await admin.from("shared_devices").delete().eq("id", deviceId);
  });

  it("only owners and managers set up a device", async () => {
    const other = createHash("sha256").update("x" + token).digest("hex");
    const { error } = await frontDesk.rpc("register_shared_device", { p_location_id: L, p_name: "Mine", p_token_hash: other });
    expect(error?.code).toBe("42501");
  });

  it("refuses easy PINs", async () => {
    for (const pin of ["1234", "1111", "9876", "12"]) {
      const { error } = await bridget.rpc("set_my_pin", { p_business_id: B, p_pin: pin });
      expect(error?.code).toBe("22023");
    }
  });

  it("checks PINs only with the service role, and returns the login to sign in", async () => {
    const { error: signedIn } = await frontDesk.rpc("check_staff_pin", { p_token_hash: hash, p_staff_id: SEED.staff.frontDesk, p_pin: "4826" });
    expect(signedIn).not.toBeNull();
    const { data } = await admin.rpc("check_staff_pin", { p_token_hash: hash, p_staff_id: SEED.staff.frontDesk, p_pin: "4826" });
    expect(data).toMatchObject({ ok: true, email: "frontdesk@mapleandash.test" });
    const { data: listed } = await admin.rpc("shared_device", { p_token_hash: hash });
    const staff = (listed as { staff: { first_name: string; last_name?: string }[] }).staff;
    expect(staff.map((s) => s.first_name)).toEqual(expect.arrayContaining(["Olivia", "Sam", "Bridget", "Ari"]));
    // Never a last name or a PIN.
    expect(JSON.stringify(listed)).not.toMatch(/Rivera|pin_hash|4826/);
  });

  it("locks someone out for a few minutes after five wrong PINs", async () => {
    const tries = [];
    for (let i = 0; i < 5; i++) tries.push((await admin.rpc("check_staff_pin", { p_token_hash: hash, p_staff_id: SEED.staff.bridget, p_pin: "0000" })).data);
    expect(tries[0]).toMatchObject({ ok: false, reason: "wrong", left: 4 });
    expect(tries[4]).toMatchObject({ ok: false, reason: "locked" });
    const { data: right } = await admin.rpc("check_staff_pin", { p_token_hash: hash, p_staff_id: SEED.staff.bridget, p_pin: "5937" });
    expect(right).toMatchObject({ ok: false, reason: "locked" });
    const { data: log } = await manager.from("device_switches").select("outcome").eq("device_id", deviceId).eq("staff_id", SEED.staff.bridget);
    expect(log!.filter((l) => l.outcome === "wrong_pin")).toHaveLength(5);
  });

  it("stops working once removed, and never for another salon's device", async () => {
    await manager.rpc("revoke_shared_device", { p_device_id: deviceId });
    const { data } = await admin.rpc("check_staff_pin", { p_token_hash: hash, p_staff_id: SEED.staff.frontDesk, p_pin: "4826" });
    expect(data).toMatchObject({ ok: false, reason: "unknown" });
    const { data: gone } = await admin.rpc("shared_device", { p_token_hash: hash });
    expect(gone).toBeNull();
  });
});
