// Which hours pay people paid by the hour: owners choose, only through
// set_payroll_hours, each change logged; clocked hours need the time clock;
// payroll shows scheduled and clocked hours and pays the chosen ones.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPayroll } from "@/lib/payroll-load";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { admin, signIn, SEED, type Client } from "./helpers";

const B = SEED.business;
const TZ = "America/Chicago";
const started = new Date().toISOString();
let owner: Client;
let manager: Client;
let frontDesk: Client;

beforeAll(async () => {
  [owner, manager, frontDesk] = await Promise.all([signIn("owner@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
});

afterAll(async () => {
  await admin.from("businesses").update({ payroll_hours: "scheduled", time_clock: true }).eq("id", B);
  await admin.from("payroll_hours_changes").delete().eq("business_id", B).gte("created_at", started);
});

describe("choosing which hours pay", () => {
  it("is for owners, only through set_payroll_hours, and logged", async () => {
    expect((await manager.rpc("set_payroll_hours", { p_business_id: B, p_basis: "clocked" })).error?.code).toBe("42501");
    expect((await owner.from("businesses").update({ payroll_hours: "clocked" }).eq("id", B)).error?.code).toBe("42501");
    expect((await owner.rpc("set_payroll_hours", { p_business_id: B, p_basis: "hourly" })).error?.hint).toBe("basis");
    expect((await owner.rpc("set_payroll_hours", { p_business_id: B, p_basis: "clocked" })).error).toBeNull();
    const { data: b } = await admin.from("businesses").select("payroll_hours").eq("id", B).single();
    expect(b!.payroll_hours).toBe("clocked");
    const { data: log } = await admin.from("payroll_hours_changes").select("from_basis, to_basis, by_staff_id").eq("business_id", B).gte("created_at", started);
    expect(log).toEqual([{ from_basis: "scheduled", to_basis: "clocked", by_staff_id: SEED.staff.owner }]);
    // Saving the same again logs nothing.
    await owner.rpc("set_payroll_hours", { p_business_id: B, p_basis: "clocked" });
    expect((await admin.from("payroll_hours_changes").select("id").eq("business_id", B).gte("created_at", started)).data).toHaveLength(1);
  });

  it("is read by payroll and the audit trail, not the front desk", async () => {
    expect((await manager.from("payroll_hours_changes").select("id").eq("business_id", B)).data!.length).toBeGreaterThan(0);
    expect((await frontDesk.from("payroll_hours_changes").select("id").eq("business_id", B)).data).toEqual([]);
  });

  it("needs the time clock for clocked hours", async () => {
    await owner.rpc("set_payroll_hours", { p_business_id: B, p_basis: "scheduled" });
    await admin.from("businesses").update({ time_clock: false }).eq("id", B);
    try {
      expect((await owner.rpc("set_payroll_hours", { p_business_id: B, p_basis: "clocked" })).error?.hint).toBe("no_clock");
    } finally {
      await admin.from("businesses").update({ time_clock: true }).eq("id", B);
    }
  });
});

describe("payroll", () => {
  it("shows scheduled and clocked hours for hourly staff and pays the chosen ones", async () => {
    // The last two weeks, which the demo's punches cover.
    const today = todayIn(TZ);
    const period = { from: addDays(today, -13), to: addDays(today, -1) };
    await owner.rpc("set_payroll_hours", { p_business_id: B, p_basis: "scheduled" });
    const scheduled = (await loadPayroll(owner, B, TZ, period, today)).find((l) => l.staffId === SEED.staff.frontDesk)!;
    expect(scheduled.hoursBasis).toBe("scheduled");
    expect(scheduled.minutes).toBe(scheduled.scheduledMinutes);
    expect(scheduled.clockedMinutes).toBeGreaterThan(0);

    await owner.rpc("set_payroll_hours", { p_business_id: B, p_basis: "clocked" });
    const clocked = (await loadPayroll(owner, B, TZ, period, today)).find((l) => l.staffId === SEED.staff.frontDesk)!;
    expect(clocked.hoursBasis).toBe("clocked");
    expect(clocked.minutes).toBe(clocked.clockedMinutes);
    expect(clocked.scheduledMinutes).toBe(scheduled.scheduledMinutes);
    // The same rate all period: pay follows the hours.
    const rate = clocked.rates.hourly[0];
    expect(clocked.rates.hourly).toHaveLength(1);
    expect(clocked.hourlyPayCents).toBe(Math.round((clocked.clockedMinutes! * rate) / 60));
    await owner.rpc("set_payroll_hours", { p_business_id: B, p_basis: "scheduled" });
  });
});
