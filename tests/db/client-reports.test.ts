// Client reports: client_report runs as the person asking (a stylist gets
// their own book, a bookkeeper no clients), and saved reports are each
// person's own unless shared by someone with reports.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runClientReport } from "@/lib/client-reports-load";
import { EMPTY_REPORT, type ClientReport } from "@/lib/client-reports";
import { admin, SEED, signIn, throwawayStylist, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const TODAY = "2026-11-06";
const TAG = `Rp${Date.now().toString(36)}`;
const where = { businessId: B, timezone: TZ, today: TODAY };

let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
let frontDesk: Client;
let bridget: Client;
let manager: Client;
let books: Client;
let regular: string;
let once: string;
let colorId: string;

async function completedVisit(client: string, day: string) {
  const start = new Date(`${day}T15:00:00Z`);
  const end = new Date(start.getTime() + 60 * 60_000);
  const { data: a, error } = await admin
    .from("appointments")
    .insert({ business_id: B, location_id: L, client_id: client, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "completed" })
    .select("id")
    .single();
  if (error) throw error;
  const { error: e } = await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a.id, service_id: colorId, staff_id: stylist.id, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: 9000 });
  if (e) throw e;
}

// Three color visits with the throwaway stylist in 2019, then nothing.
const regulars: ClientReport = { ...EMPTY_REPORT, categories: ["Color"], from: "2019-01", to: "2020-01", minVisits: 3, noVisitSince: "this_year" };

beforeAll(async () => {
  [frontDesk, bridget, manager, books] = await Promise.all(["frontdesk", "bridget", "manager", "books"].map((who) => signIn(`${who}@mapleandash.test`)));
  stylist = await throwawayStylist(`${TAG}Rae`);
  colorId = (await admin.from("services").select("id").eq("business_id", B).eq("category", "Color").limit(1).single()).data!.id;
  const { data } = await admin
    .from("clients")
    .insert([
      { business_id: B, first_name: `${TAG}Ava`, last_name: "Test" },
      { business_id: B, first_name: `${TAG}Bo`, last_name: "Test" },
    ])
    .select("id, first_name");
  regular = data!.find((c) => c.first_name === `${TAG}Ava`)!.id;
  once = data!.find((c) => c.first_name === `${TAG}Bo`)!.id;
  for (const day of ["2019-02-05", "2019-05-07", "2019-09-10"]) await completedVisit(regular, day);
  await completedVisit(once, "2019-03-05");
});

afterAll(async () => {
  await admin.from("saved_reports").delete().like("name", `${TAG}%`);
  await admin.from("appointments").delete().in("client_id", [regular, once]);
  await admin.from("clients").delete().in("id", [regular, once]);
  await stylist.remove();
});

describe("running a report", () => {
  it("lists the clients who match, with the visits it counted", async () => {
    const { rows, total } = await runClientReport(frontDesk, where, { ...regulars, staffIds: [stylist.id] }, { spend: true });
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({ id: regular, visits: 3, lastVisit: "2019-09-10", nextVisit: null });
    // Exactly one visit: only the client who came once.
    const few = await runClientReport(frontDesk, where, { ...regulars, staffIds: [stylist.id], minVisits: 1, maxVisits: 1 }, { spend: true });
    expect(few.rows.map((r) => r.id)).toEqual([once]);
  });

  it("gives a stylist only their own book, and a bookkeeper no clients", async () => {
    expect((await runClientReport(bridget, where, { ...regulars, staffIds: [stylist.id] }, { spend: false })).total).toBe(0);
    expect((await runClientReport(books, where, regulars, { spend: false })).total).toBe(0);
  });
});

describe("saved reports", () => {
  const save = (who: Client, staffEmail: string, name: string, shared: boolean) =>
    (async () => {
      const staffId = (await admin.from("staff").select("id").eq("email", staffEmail).single()).data!.id;
      return who.from("saved_reports").insert({ business_id: B, staff_id: staffId, name: `${TAG}${name}`, definition: regulars, shared }).select("id").single();
    })();

  it("are each person's own, shared with the salon only by those with reports", async () => {
    expect((await save(frontDesk, "frontdesk@mapleandash.test", "Desk's own", false)).error).toBeNull();
    expect((await save(frontDesk, "frontdesk@mapleandash.test", "Desk shares", true)).error?.code).toBe("42501");
    const shared = await save(manager, "manager@mapleandash.test", "Lapsed color", true);
    expect(shared.error).toBeNull();
    expect((await save(manager, "manager@mapleandash.test", "Manager's own", false)).error).toBeNull();

    const seen = async (who: Client) => (await who.from("saved_reports").select("name").like("name", `${TAG}%`).order("name")).data!.map((r) => r.name.slice(TAG.length));
    expect(await seen(bridget)).toEqual(["Lapsed color"]);
    expect(await seen(frontDesk)).toEqual(["Desk's own", "Lapsed color"]);

    // Nobody saves one as someone else, or removes another's.
    expect((await save(frontDesk, "manager@mapleandash.test", "As the manager", false)).error?.code).toBe("42501");
    expect((await bridget.from("saved_reports").delete().eq("id", shared.data!.id).select("id")).data).toEqual([]);
    expect((await manager.from("saved_reports").delete().eq("id", shared.data!.id).select("id")).data).toHaveLength(1);
  });
});
