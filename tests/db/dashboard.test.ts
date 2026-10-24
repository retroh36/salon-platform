// The Dashboard's data for each role, against the demo data: owners see
// money, the front desk sees everything else, stylists get their own day.
// Counts are checked against the database independently.
import { beforeAll, describe, expect, it } from "vitest";
import { loadDashboard, loadDueBack, type DashboardData, type DashboardMe } from "@/lib/dashboard-load";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const TZ = "America/Chicago";
const today = todayIn(TZ);
const location = { id: SEED.location, name: "Maple & Ash Downtown", timezone: TZ, business: { name: "Maple & Ash Hair Studio" } };
const me = (id: string, role: DashboardMe["role"], first: string): DashboardMe => ({ id, first_name: first, role, permissions: role === "owner" || role === "manager" ? ["reports", "payroll", "settings", "team"] : [], business_id: SEED.business, location });

let owner: DashboardData;
let frontDesk: DashboardData;
let stylist: DashboardData;
let shae: Client;

beforeAll(async () => {
  const [o, f, s] = await Promise.all([signIn("owner@mapleandash.test"), signIn("frontdesk@mapleandash.test"), signIn("shae@mapleandash.test")]);
  shae = s;
  owner = await loadDashboard(o, me(SEED.staff.owner, "owner", "Olivia"));
  frontDesk = await loadDashboard(f, me(SEED.staff.frontDesk, "front_desk", "Sam"));
  stylist = await loadDashboard(s, me(SEED.staff.shae, "stylist", "Shae"));
}, 60_000);

async function appointmentsToday(staffId?: string) {
  let q = admin
    .from("appointment_items")
    .select("appointment_id, price_cents, staff_id, appointment:appointments!inner(status)")
    .eq("location_id", SEED.location)
    .gte("starts_at", startOfLocalDay(today, TZ).toISOString())
    .lt("starts_at", startOfLocalDay(addDays(today, 1), TZ).toISOString());
  if (staffId) q = q.eq("staff_id", staffId);
  const { data } = await q;
  return data!;
}

describe("the owner", () => {
  it("sees today's numbers, money, Denise and the whole team", async () => {
    const items = await appointmentsToday();
    const held = items.filter((i) => i.appointment.status !== "canceled");
    expect(owner.tiles.appointments.now).toBe(new Set(held.map((i) => i.appointment_id)).size);
    expect(owner.tiles.revenueCents!.now).toBe(items.filter((i) => !["canceled", "no_show"].includes(i.appointment.status)).reduce((n, i) => n + i.price_cents, 0));
    expect(owner.tiles.fullness.now).toBeGreaterThan(0);
    expect(owner.tiles.fullness.now).toBeLessThanOrEqual(100);
    expect(owner.week.sales).not.toBeNull();
    expect(owner.week.days).toHaveLength(7);
    expect(owner.denise).not.toBeNull();
    expect(owner.denise!.brief).not.toBeNull();
    expect(owner.live.team.length).toBeGreaterThan(3);
    expect(owner.opportunities!.overdue).toHaveLength(3);
    expect(owner.me).toBeNull();
  });
});

describe("the front desk", () => {
  it("sees everything but money, with no money in the data at all", () => {
    expect(frontDesk.seesMoney).toBe(false);
    expect(frontDesk.tiles.revenueCents).toBeNull();
    expect(frontDesk.week.sales).toBeNull();
    expect(frontDesk.denise!.reorders.every((r) => r.totalCents === 0)).toBe(true);
    expect(JSON.stringify(frontDesk)).not.toMatch(/priceCents|"expectedCents"/);
    expect(frontDesk.tiles.appointments).toEqual(owner.tiles.appointments);
    expect(frontDesk.live.team.map((s) => s.staffId)).toEqual(owner.live.team.map((s) => s.staffId));
    expect(frontDesk.opportunities!.overdueTotal).toBe(owner.opportunities!.overdueTotal);
  });
});

describe("a stylist", () => {
  it("gets their own day: their visits, numbers, regulars and Denise's notes, no salon money", async () => {
    expect(stylist.seesMoney).toBe(false);
    expect(stylist.tiles.revenueCents).toBeNull();
    expect(stylist.week.sales).toBeNull();
    expect(stylist.denise).toBeNull();
    expect(stylist.me).not.toBeNull();

    const mine = (await appointmentsToday(SEED.staff.shae)).filter((i) => i.appointment.status !== "canceled");
    expect(stylist.tiles.appointments.now).toBe(new Set(mine.map((i) => i.appointment_id)).size);
    expect(stylist.me!.visits.every((v) => v.staffId === SEED.staff.shae)).toBe(true);
    expect(stylist.live.team.map((s) => s.staffId)).toEqual([SEED.staff.shae]);
    for (const v of [...stylist.live.inChair, ...stylist.live.upNext, ...stylist.live.late]) expect(v.staffId).toBe(SEED.staff.shae);
    expect(JSON.stringify(stylist)).not.toMatch(/priceCents|Cents"?:\s*[1-9]/);

    // Their regulars only.
    const { overdue } = await loadDueBack(shae, me(SEED.staff.shae, "stylist", "Shae"), 20);
    const { data: insights } = await admin.from("insights").select("key, data").eq("kind", "client").in("key", overdue.map((c) => c.clientId));
    expect(insights!.every((r) => (r.data as { preferredStaffId: string }).preferredStaffId === SEED.staff.shae)).toBe(true);
  });
});

describe("a brand-new salon", () => {
  it("says so, with nothing to count and no one's numbers but its own", async () => {
    const other = await createOtherSalon();
    try {
      const client = await signIn(other.email);
      const loc = { id: other.locationId, name: "Other Salon Main", timezone: "America/New_York", business: { name: "Other Salon" } };
      const data = await loadDashboard(client, { id: other.staffId, first_name: "Other", role: "owner", permissions: ["reports"], business_id: other.businessId, location: loc });
      expect(data.newSalon).toBe(true);
      expect(data.tiles.appointments.now).toBe(0);
      expect(data.tiles.fullness.now).toBeNull();
      expect(data.live.team).toEqual([]);
      expect(data.opportunities!.overdue).toEqual([]);
      expect(data.week.sales).toEqual({ thisWeek: 0, lastWeek: 0, through: expect.any(String) });
    } finally {
      await other.cleanup();
    }
  });
});
