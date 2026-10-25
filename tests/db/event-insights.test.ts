// What Denise watches and reports about events, against the demo events:
// the brief's risks (Rossi's balance didn't go through this week; Okafor's
// trial isn't booked and Nola, on the team, is away), her answers to "What
// weddings do we have in …?" and "What's left to collect on the Rossi
// wedding?" (first names only, money for the front of house, a stylist only
// the events they're on), and the events report.
import { beforeAll, describe, expect, it } from "vitest";
import { knowledgeFor, type Asker } from "@/lib/denise/knowledge";
import { eventReport } from "@/lib/events/report";
import { loadEventReportRows } from "@/lib/events/report-load";
import { loadEventRisks } from "@/lib/events/risks-load";
import { todayIn } from "@/lib/scheduling/time";
import { admin, DEFAULT_PERMISSIONS, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const TZ = "America/Chicago";
const today = todayIn(TZ);
const where = { businessId: B, location: { id: SEED.location, timezone: TZ } };
const asker = (role: Asker["role"], staffId: string): Asker => ({ role, permissions: DEFAULT_PERMISSIONS[role], staffId, businessId: B, location: where.location, salon: "Maple & Ash", today });
// No last names, contact details or notes in what Claude would see.
const PRIVATE = /Rossi|Okafor|Patel|Harper|Brooks|@|\(\d{3}\)|Langford|bridal suite/i;

let frontDesk: Client;
let owner: Client;
let shae: Client;
const events = new Map<string, { id: string; event_date: string; total_cents: number }>();

beforeAll(async () => {
  [frontDesk, owner, shae] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("owner@mapleandash.test"), signIn("shae@mapleandash.test")]);
  const { data } = await admin.from("events").select("id, title, event_date, total_cents").eq("business_id", B);
  for (const e of data!) events.set(e.title, e);
});

describe("the brief's event risks", () => {
  it("flags the failed balance, the trial not booked and the time off, linking to each event", async () => {
    const risks = await loadEventRisks(frontDesk, where, today);
    const rossi = events.get("Rossi wedding")!;
    const okafor = events.get("Okafor wedding")!;
    expect(risks).toContainEqual(expect.objectContaining({ eventId: rossi.id, kind: "balance_unpaid", detail: "A payment didn't go through. Try the card again, or send a card link." }));
    expect(risks).toContainEqual(expect.objectContaining({ eventId: okafor.id, kind: "trial_not_booked" }));
    expect(risks).toContainEqual(expect.objectContaining({ eventId: okafor.id, kind: "time_off", detail: "Nola has time off then. Choose someone else." }));
    // Rossi's trial is done; inquiries, proposals, lost and past events aren't checked.
    expect(risks.filter((r) => r.eventId === rossi.id).map((r) => r.kind)).toEqual(["balance_unpaid"]);
    expect(new Set(risks.map((r) => r.eventId))).toEqual(new Set([rossi.id, okafor.id]));
  });
});

describe("Ask Denise about events", () => {
  const month = (title: string) => events.get(title)!.event_date.slice(0, 7);

  it("lists a month's weddings for the front desk by first name, with what's left to collect", async () => {
    const k = knowledgeFor(frontDesk, asker("front_desk", SEED.staff.frontDesk));
    const result = (await k.events(month("Rossi wedding"))) as { events: { event: string; left_to_collect_dollars?: number; team: string[]; where: string }[]; weddings: number };
    const mia = result.events.find((e) => e.event === "Mia's wedding")!;
    expect(mia).toMatchObject({ left_to_collect_dollars: 717.6, where: "On location" });
    expect(mia.team.sort()).toEqual(["Bridget", "Hannah", "Lois", "Shae"]);
    expect(result.weddings).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(PRIVATE);
    expect(await k.events("June")).toEqual({ error: "Give the month as YYYY-MM." });
  });

  it("finds the Rossi wedding by its last name and says what's paid and what's left", async () => {
    const k = knowledgeFor(frontDesk, asker("front_desk", SEED.staff.frontDesk));
    const result = (await k.eventBalance!("the Rossi wedding")) as { matches: { event: string; total_dollars: number; paid_dollars: number; left_to_collect_dollars: number; payments: { what: string; status: string }[] }[] };
    expect(result.matches).toHaveLength(1);
    const [m] = result.matches;
    expect(m).toMatchObject({ event: "Mia's wedding", total_dollars: events.get("Rossi wedding")!.total_cents / 100, left_to_collect_dollars: 717.6 });
    expect(m.paid_dollars + m.left_to_collect_dollars).toBeCloseTo(m.total_dollars, 2);
    expect(m.payments.map((p) => p.what)).toEqual(["Deposit", "Second payment", "Balance"]);
    expect(m.payments[2].status).toBe("didn't go through");
    expect(JSON.stringify(result)).not.toMatch(PRIVATE);
    expect(await k.eventBalance!("Nobodyhere")).toEqual({ matches: [], note: "No event matches that name." });
  });

  it("gives a stylist only the events they're on, with no money", async () => {
    const k = knowledgeFor(shae, asker("stylist", SEED.staff.shae));
    expect(k.eventBalance).toBeNull();
    const rossi = (await k.events(month("Rossi wedding"))) as { events: { event: string }[] };
    expect(rossi.events.map((e) => e.event)).toContain("Mia's wedding");
    // Shae isn't on Harper's or Okafor's.
    const harper = (await k.events(month("Harper wedding"))) as { events: { event: string }[] };
    expect(harper.events.map((e) => e.event)).not.toContain("Emma's wedding");
    expect(JSON.stringify(rossi)).not.toMatch(/dollars|Grace/);
  });
});

describe("the events report", () => {
  it("adds up the demo events for owners", async () => {
    const rows = await loadEventReportRows(owner, B, TZ);
    expect(rows).toHaveLength(events.size);
    const all = eventReport(rows, "2000-01-01", "2100-01-01");
    // Harper, Brooks, Rossi and Okafor are held; Patel's deposit is waiting.
    expect(all.held).toBe(4);
    expect(all.depositsOutstanding).toBe(1);
    const { data: patel } = await admin.from("events").select("deposit_cents").eq("title", "Patel wedding").single();
    expect(all.depositsOutstandingCents).toBe(patel!.deposit_cents);
    const { data: owed } = await admin.from("event_payments").select("amount_cents, event:events!inner(title)").in("status", ["scheduled", "failed"]).eq("business_id", B);
    expect(all.stillToCollectCents).toBe(owed!.reduce((n, p) => n + p.amount_cents, 0));
    // All eight came in; the four held were booked (not the inquiries, the proposal or the lost one).
    expect([all.inquiries, all.booked]).toEqual([8, 4]);
  });

  it("gives a stylist only the events they're on", async () => {
    expect(await loadEventReportRows(shae, B, TZ)).not.toContainEqual(expect.objectContaining({ id: events.get("Harper wedding")!.id }));
  });
});
