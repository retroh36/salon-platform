// Shifts carry a working role (migration …_shift_roles.sql): drafts,
// publishing and patterns keep it; only a role the person works is taken;
// taking them off a role takes it off their shifts to come.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveBooking } from "@/lib/scheduling/book";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, type Client, SEED, signIn, throwawayStylist } from "./helpers";

const B = SEED.business;
const L = SEED.location;
let manager: Client;
let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
let wash: string;
let bar: string;
// A Tuesday five weeks out, clear of the demo's drafts.
const tuesday = addDays(startOfWeek(todayIn("America/Chicago")), 36);

beforeAll(async () => {
  manager = await signIn("manager@mapleandash.test");
  stylist = await throwawayStylist("Shiftroles");
  const role = async (name: string) => (await manager.rpc("save_working_role", { p_business_id: B, p_role_id: null!, p_name: name, p_online: true, p_service_ids: [] })).data!;
  [wash, bar] = [await role("Wash House Shift Test"), await role("Beauty Bar Shift Test")];
  await manager.rpc("set_staff_working_roles", { p_staff_id: stylist.id, p_role_ids: [wash, bar] });
});

afterAll(async () => {
  await admin.from("schedule_drafts").delete().eq("staff_id", stylist.id);
  await admin.from("staff_schedule_overrides").delete().eq("staff_id", stylist.id);
  await admin.from("staff_working_hours").delete().eq("staff_id", stylist.id);
  await admin.from("notifications").delete().eq("staff_id", stylist.id);
  await stylist.remove();
  await admin.from("working_roles").delete().in("id", [wash, bar]);
});

const day = (shifts: { start: number; end: number; role?: string | null }[]) => manager.rpc("save_schedule_drafts", { p_location_id: L, p_days: [{ staff_id: stylist.id, on_date: tuesday, shifts }] });
const overrides = async () =>
  (await admin.from("staff_schedule_overrides").select("start_minute, end_minute, role_id").eq("staff_id", stylist.id).eq("on_date", tuesday).order("start_minute")).data;

describe("shifts with working roles", () => {
  it("are drafted and published with their roles", async () => {
    expect(
      (
        await day([
          { start: 840, end: 1080, role: bar },
          { start: 540, end: 780, role: wash },
        ])
      ).error,
    ).toBeNull();
    const { data: draft } = await admin.from("schedule_drafts").select("shifts").eq("staff_id", stylist.id).eq("on_date", tuesday).single();
    expect(draft!.shifts).toEqual([
      { start: 540, end: 780, role: wash },
      { start: 840, end: 1080, role: bar },
    ]);

    // The same times with another role is a change.
    expect((await manager.rpc("publish_schedule_week", { p_location_id: L, p_week_start: tuesday })).error).toBeNull();
    expect(await overrides()).toEqual([
      { start_minute: 540, end_minute: 780, role_id: wash },
      { start_minute: 840, end_minute: 1080, role_id: bar },
    ]);
    await day([
      { start: 540, end: 780, role: bar },
      { start: 840, end: 1080, role: bar },
    ]);
    expect((await admin.from("schedule_drafts").select("id").eq("staff_id", stylist.id)).data).toHaveLength(1);
  });

  it("only take a role the person works", async () => {
    const { data: other } = await manager.rpc("save_working_role", { p_business_id: B, p_role_id: null!, p_name: "Not Theirs Shift Test", p_online: true, p_service_ids: [] });
    const r = await day([{ start: 540, end: 780, role: other }]);
    expect(r.error?.hint).toBe("not_their_role");
    const p = await manager.rpc("set_staff_pattern", { p_staff_id: stylist.id, p_weeks: 1, p_starts_on: null!, p_hours: [{ cycle_week: 0, weekday: 2, start_minute: 540, end_minute: 780, role_id: other }] });
    expect(p.error?.hint).toBe("not_their_role");
    await admin.from("working_roles").delete().eq("id", other!);
  });

  it("keep their role in a pattern", async () => {
    expect((await manager.rpc("set_staff_pattern", { p_staff_id: stylist.id, p_weeks: 1, p_starts_on: null!, p_hours: [{ cycle_week: 0, weekday: 3, start_minute: 540, end_minute: 1020, role_id: wash }] })).error).toBeNull();
    expect((await admin.from("staff_working_hours").select("role_id").eq("staff_id", stylist.id)).data).toEqual([{ role_id: wash }]);
  });

  it("lose a role the person is taken off, in the pattern, published days and drafts", async () => {
    await manager.rpc("set_staff_working_roles", { p_staff_id: stylist.id, p_role_ids: [bar] });
    expect((await admin.from("staff_working_hours").select("role_id").eq("staff_id", stylist.id)).data).toEqual([{ role_id: null }]);
    expect((await overrides())!.map((o) => o.role_id)).toEqual([null, bar]);
    // The draft from the first test (both Beauty Bar) keeps its roles.
    const { data: draft } = await admin.from("schedule_drafts").select("shifts").eq("staff_id", stylist.id).single();
    expect(draft!.shifts).toEqual([
      { start: 540, end: 780, role: bar },
      { start: 840, end: 1080, role: bar },
    ]);
    await manager.rpc("set_staff_working_roles", { p_staff_id: stylist.id, p_role_ids: [] });
    const { data: after } = await admin.from("schedule_drafts").select("shifts").eq("staff_id", stylist.id).single();
    expect(after!.shifts).toEqual([
      { start: 540, end: 780 },
      { start: 840, end: 1080 },
    ]);
  });

  it("never publish a role the person doesn't work (as when a swap hands their day to someone else)", async () => {
    const wednesday = addDays(tuesday, 1);
    await admin.from("schedule_drafts").insert({ business_id: B, location_id: L, staff_id: stylist.id, on_date: wednesday, shifts: [{ start: 600, end: 900, role: wash }], updated_by: SEED.staff.manager });
    expect((await manager.rpc("publish_schedule_week", { p_location_id: L, p_week_start: wednesday })).error).toBeNull();
    expect((await admin.from("staff_schedule_overrides").select("role_id").eq("staff_id", stylist.id).eq("on_date", wednesday)).data).toEqual([{ role_id: null }]);
  });
});

describe("booking a shift in a working role", () => {
  // A Tuesday far from the demo, and a role with only the blowout.
  const DAY = "2031-06-10";
  const at = (hour: number) => fromLocal(DAY, hour * 60, "America/Chicago")!;
  const made: string[] = [];
  let washOnly: string;
  let blowout: string;
  let cut: string;
  let clientId: string;
  let desk: Client;

  beforeAll(async () => {
    desk = await signIn("frontdesk@mapleandash.test");
    const names = (await admin.from("services").select("id, name").eq("business_id", B).in("name", ["Blowout", "Women's Cut & Style"])).data!;
    blowout = names.find((n) => n.name === "Blowout")!.id;
    cut = names.find((n) => n.name !== "Blowout")!.id;
    clientId = (await admin.from("clients").select("id").eq("business_id", B).limit(1).single()).data!.id;
    washOnly = (await manager.rpc("save_working_role", { p_business_id: B, p_role_id: null!, p_name: "Wash Only Booking Test", p_online: false, p_service_ids: [blowout] })).data!;
    await admin.from("staff_services").insert([blowout, cut].map((service_id) => ({ business_id: B, staff_id: stylist.id, service_id })));
    await manager.rpc("set_staff_working_roles", { p_staff_id: stylist.id, p_role_ids: [washOnly] });
    await admin.from("staff_schedule_overrides").insert({ business_id: B, staff_id: stylist.id, on_date: DAY, start_minute: 540, end_minute: 780, role_id: washOnly });
  });

  afterAll(async () => {
    if (made.length) await admin.from("appointments").delete().in("id", made);
    await admin.from("staff_schedule_overrides").delete().eq("staff_id", stylist.id).eq("on_date", DAY);
    await admin.from("staff_services").delete().eq("staff_id", stylist.id);
    await admin.from("working_roles").delete().eq("id", washOnly);
  });

  const book = async (serviceId: string) => {
    const r = await saveBooking(desk, { id: L, timezone: "America/Chicago" }, { clientId, notes: null, items: [{ serviceId, staffId: stylist.id, start: at(10), resource: { kind: "any" } }] });
    if (r.ok) made.push(r.appointmentId);
    return r;
  };

  it("takes only the role's services", async () => {
    const refused = await book(cut);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && "problems" in refused ? refused.problems.flat().map((p) => p.code) : []).toContain("role_service");
    expect((await book(blowout)).ok).toBe(true);
  });

  it("counts an archived role as no role", async () => {
    await manager.rpc("save_working_role", { p_business_id: B, p_role_id: washOnly, p_name: "Wash Only Booking Test", p_online: false, p_service_ids: [blowout], p_archive: true });
    if (made.length) await admin.from("appointments").delete().in("id", made.splice(0));
    expect((await book(cut)).ok).toBe(true);
  });
});

describe("paying a shift in a working role", () => {
  // A Tuesday far from the demo: Wash House 9–1 at $18 an hour, then Beauty
  // Bar 2–6 on commission (40%, the stylist's own 45%).
  const DAY = "2031-06-17";
  const at = (hour: number) => fromLocal(DAY, hour * 60, "America/Chicago")!;
  const made: string[] = [];
  let washPay: string;
  let barPay: string;
  let saleId: string;
  let desk: Client;
  let owner: Client;

  beforeAll(async () => {
    desk = await signIn("frontdesk@mapleandash.test");
    owner = await signIn("owner@mapleandash.test");
    const role = async (name: string) => (await manager.rpc("save_working_role", { p_business_id: B, p_role_id: null!, p_name: name, p_online: true, p_service_ids: [] })).data!;
    [washPay, barPay] = [await role("Wash House Pay Test"), await role("Beauty Bar Pay Test")];
    await owner.rpc("save_working_role_pay", { p_role_id: washPay, p_method: "hourly", p_hourly_rate_cents: 1800, p_commission_pct: null! });
    await owner.rpc("save_working_role_pay", { p_role_id: barPay, p_method: "commission", p_hourly_rate_cents: null!, p_commission_pct: 40 });
    await manager.rpc("set_staff_working_roles", { p_staff_id: stylist.id, p_role_ids: [washPay, barPay] });
    await owner.rpc("set_staff_role_pay", { p_staff_id: stylist.id, p_role_id: barPay, p_hourly_rate_cents: null!, p_commission_pct: 45 });
    await admin.from("staff_schedule_overrides").insert([
      { business_id: B, staff_id: stylist.id, on_date: DAY, start_minute: 540, end_minute: 780, role_id: washPay },
      { business_id: B, staff_id: stylist.id, on_date: DAY, start_minute: 840, end_minute: 1080, role_id: barPay },
    ]);
  });

  afterAll(async () => {
    if (saleId) await admin.from("sales").delete().eq("id", saleId);
    if (made.length) await admin.from("appointments").delete().in("id", made);
    await admin.from("staff_schedule_overrides").delete().eq("staff_id", stylist.id).eq("on_date", DAY);
    await admin.from("staff_services").delete().eq("staff_id", stylist.id);
    await admin.from("working_roles").delete().in("id", [washPay, barPay]);
  });

  it("records each service's role at the rate that pays it, and pays the hours by role", async () => {
    const blowout = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single()).data!.id;
    await admin.from("staff_services").insert({ business_id: B, staff_id: stylist.id, service_id: blowout });
    const clientId = (await admin.from("clients").select("id").eq("business_id", B).limit(1).single()).data!.id;
    const items: string[] = [];
    for (const hour of [10, 15]) {
      const r = await saveBooking(desk, { id: L, timezone: "America/Chicago" }, { clientId, notes: null, items: [{ serviceId: blowout, staffId: stylist.id, start: at(hour), resource: { kind: "any" } }] });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      made.push(r.appointmentId);
      items.push((await admin.from("appointment_items").select("id").eq("appointment_id", r.appointmentId).single()).data!.id);
    }
    const { data: sale } = await admin
      .from("sales")
      .insert({ business_id: B, location_id: L, number: 900000 + Math.floor(Math.random() * 99999), subtotal_cents: 10000, total_cents: 10000 })
      .select("id")
      .single();
    saleId = sale!.id;
    const line = (position: number, appointment_item_id: string) => ({
      sale_id: saleId,
      business_id: B,
      position,
      kind: "service" as const,
      service_id: blowout,
      appointment_item_id,
      staff_id: stylist.id,
      description: "Blowout",
      unit_price_cents: 5000,
      total_cents: 5000,
    });
    await admin.from("sale_items").insert([line(0, items[0]), line(1, items[1])]);
    const { data: lines } = await admin.from("sale_items").select("working_role_id, commission_pct, commission_version_id").eq("sale_id", saleId).order("position");
    // Wash House pays hourly: no commission. Beauty Bar: their own 45%.
    expect(lines).toEqual([
      { working_role_id: washPay, commission_pct: 0, commission_version_id: null },
      { working_role_id: barPay, commission_pct: 45, commission_version_id: null },
    ]);

    // A rate changed now doesn't change what was recorded, and is kept as history.
    await owner.rpc("save_working_role_pay", { p_role_id: barPay, p_method: "commission", p_hourly_rate_cents: null!, p_commission_pct: 50 });
    // (It started as the person's usual pay, then 40%, now 50%.)
    expect((await admin.from("working_role_pay_history").select("method, commission_pct").eq("role_id", barPay).is("staff_id", null).order("effective_from")).data).toEqual([
      { method: "usual", commission_pct: null },
      { method: "commission", commission_pct: 40 },
      { method: "commission", commission_pct: 50 },
    ]);

    // Payroll for that week: 4 hours at $18, 4 hours unpaid, and the services by role.
    const { loadPayroll } = await import("@/lib/payroll-load");
    const [pay] = await loadPayroll(owner, B, "America/Chicago", { from: "2031-06-16", to: "2031-06-22" }, "2031-06-30", stylist.id);
    expect(pay.roles).toEqual([
      { roleId: barPay, name: "Beauty Bar Pay Test", method: "commission", minutes: 240, hourlyPayCents: 0, serviceCents: 0, commissionCents: 0 },
      { roleId: washPay, name: "Wash House Pay Test", method: "hourly", minutes: 240, hourlyPayCents: 7200, serviceCents: 0, commissionCents: 0 },
    ]);
    expect(pay.hourlyPayCents).toBe(7200);
  });
});
