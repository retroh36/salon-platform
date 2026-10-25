// Bridal and events, what Denise watches and reports: the risks for events
// coming up (balance a week out, trial a month out, the headcount cutoff,
// the team's time off and clashes, artists not chosen), the report, and how
// she names an event for Claude (first names only).
import { describe, expect, it } from "vitest";
import { eventLabel } from "@/lib/denise/events";
import { eventReport, type ReportEvent } from "@/lib/events/report";
import { eventRisks, type RiskEvent } from "@/lib/events/risks";

const TODAY = "2027-06-01";
const event = (over: Partial<RiskEvent> = {}): RiskEvent => ({
  id: "e1",
  name: "Rossi wedding",
  date: "2027-06-20",
  status: "booked",
  unpaidCents: 0,
  failedPayment: false,
  trialMissing: false,
  cutoff: "2027-06-13",
  openLanes: 0,
  busyTeam: [],
  ...over,
});
const kinds = (e: RiskEvent) => eventRisks([e], TODAY).map((r) => r.kind);

describe("event risks", () => {
  it("says nothing about an event that's all in order", () => {
    expect(eventRisks([event()], TODAY)).toEqual([]);
  });

  it("flags a balance still unpaid from a week out, and a failed payment whenever", () => {
    expect(kinds(event({ unpaidCents: 56280 }))).toEqual([]);
    const week = eventRisks([event({ date: "2027-06-08", cutoff: "2027-05-25", unpaidCents: 56280 })], TODAY);
    expect(week).toEqual([expect.objectContaining({ kind: "balance_unpaid", title: "Rossi wedding in 7 days", detail: "There's still a balance to collect." })]);
    expect(eventRisks([event({ unpaidCents: 42210, failedPayment: true })], TODAY)[0].detail).toBe("A payment didn't go through. Try the card again, or send a card link.");
  });

  it("flags a trial not booked from a month out, until the trial's done", () => {
    expect(kinds(event({ date: "2027-07-02", cutoff: "2027-06-25", trialMissing: true }))).toEqual([]);
    expect(kinds(event({ date: "2027-07-01", cutoff: "2027-06-24", trialMissing: true }))).toEqual(["trial_not_booked"]);
    expect(kinds(event({ trialMissing: true, status: "trial_done" }))).toEqual([]);
  });

  it("says when the headcount cutoff is closing, and just after it's passed", () => {
    expect(eventRisks([event({ cutoff: "2027-06-04" })], TODAY)[0].detail).toBe("Party changes close Fri, Jun 4. Confirm the headcount.");
    expect(eventRisks([event({ cutoff: TODAY })], TODAY)[0].detail).toBe("Party changes close today. Confirm the headcount.");
    expect(eventRisks([event({ cutoff: "2027-05-30" })], TODAY)[0].detail).toBe("The headcount cutoff has passed. Party changes now need a manager.");
    expect(kinds(event({ cutoff: "2027-05-29" }))).toEqual([]);
    expect(kinds(event({ cutoff: "2027-06-05" }))).toEqual([]);
  });

  it("checks the team: time off, other clashes and artists not chosen, each with its own key", () => {
    const risks = eventRisks(
      [
        event({
          busyTeam: [
            { staffId: "s1", name: "Shae", timeOff: true, text: "has time off" },
            { staffId: "s2", name: "Gil", timeOff: false, text: "has clients booked" },
          ],
          openLanes: 2,
        }),
      ],
      TODAY,
    );
    expect(risks.map((r) => [r.kind, r.detail])).toEqual([
      ["time_off", "Shae has time off then. Choose someone else."],
      ["team_busy", "Gil has clients booked then. Choose someone else."],
      ["unstaffed", "2 artists aren't chosen yet."],
    ]);
    expect(new Set(risks.map((r) => r.key)).size).toBe(3);
  });

  it("only looks at booked events from today to 60 days out, soonest first", () => {
    const risks = eventRisks(
      [
        event({ id: "later", name: "Later", date: "2027-07-20", cutoff: "2027-07-13", openLanes: 1 }),
        event({ id: "soon", name: "Soon", date: "2027-06-02", cutoff: "2027-05-26", openLanes: 1 }),
        event({ id: "inquiry", status: "inquiry", openLanes: 1 }),
        event({ id: "past", date: "2027-05-31", openLanes: 1 }),
        event({ id: "far", date: "2027-08-01", openLanes: 1 }),
      ],
      TODAY,
    );
    expect(risks.map((r) => r.title)).toEqual(["Soon tomorrow", "Later in 49 days"]);
  });
});

describe("the events report", () => {
  const paid = (kind: string, amountCents: number, paidOn: string) => ({ kind, status: "paid", amountCents, paidOn });
  const due = (kind: string, amountCents: number) => ({ kind, status: "scheduled", amountCents, paidOn: null });
  const rows: ReportEvent[] = [
    { id: "a", status: "completed", date: "2027-05-10", createdOn: "2027-01-05", bookedOn: "2027-01-12", totalCents: 140700, depositCents: 42210, payments: [paid("deposit", 42210, "2027-01-12"), paid("final", 98490, "2027-05-03")] },
    { id: "b", status: "booked", date: "2027-06-20", createdOn: "2027-05-02", bookedOn: "2027-05-09", totalCents: 200000, depositCents: 60000, payments: [paid("deposit", 60000, "2027-05-09"), due("final", 140000)] },
    { id: "c", status: "proposal_sent", date: "2027-08-01", createdOn: "2027-05-20", bookedOn: null, totalCents: 90000, depositCents: 27000, payments: [] },
    { id: "d", status: "lost", date: "2027-06-05", createdOn: "2027-05-03", bookedOn: null, totalCents: 50000, depositCents: 15000, payments: [] },
    { id: "e", status: "inquiry", date: "2027-09-01", createdOn: "2027-05-25", bookedOn: null, totalCents: 0, depositCents: 0, payments: [] },
  ];

  it("adds up events held by month, the average, conversion and deposits", () => {
    const r = eventReport(rows, "2027-05-01", "2027-06-30");
    expect(r.months).toEqual([
      { month: "2027-05", events: 1, valueCents: 140700, collectedCents: 140700 },
      { month: "2027-06", events: 1, valueCents: 200000, collectedCents: 60000 },
    ]);
    expect(r.held).toBe(2);
    expect(r.averageCents).toBe(170350);
    // b, c, d and e came in during May; only b is booked.
    expect([r.inquiries, r.booked, r.bookedRate]).toEqual([4, 1, 0.25]);
    expect(r.depositsCollectedCents).toBe(60000);
    expect([r.depositsOutstanding, r.depositsOutstandingCents]).toEqual([1, 27000]);
    expect(r.stillToCollectCents).toBe(140000);
  });

  it("has no average or rate when there's nothing to go on", () => {
    const r = eventReport(rows, "2026-01-01", "2026-01-31");
    expect([r.held, r.averageCents, r.bookedRate]).toEqual([0, null, null]);
  });
});

describe("how Denise names an event for Claude", () => {
  it("uses the client's first name, never the title or a last name", () => {
    expect(eventLabel({ title: "Rossi wedding", client: { first_name: "Mia" }, event_members: [] })).toBe("Mia's wedding");
    expect(eventLabel({ title: "Harper prom", client: { first_name: "Jo" }, event_members: [{ party_role: "guest", name: "Jo Harper" }] })).toBe("Jo's event");
    expect(eventLabel({ title: "Summer party", client: { first_name: "Ava" }, event_members: [{ party_role: "bride", name: "Ava Lee" }] })).toBe("Ava's wedding");
    expect(eventLabel({ title: "Okafor wedding", client: null, event_members: [] })).toBe("An unnamed wedding");
    // A stylist can't see the client: the bride's first name instead.
    expect(eventLabel({ title: "Rossi wedding", client: null, event_members: [{ party_role: "maid_of_honor", name: "Rae Rossi" }, { party_role: "bride", name: "Mia Rossi" }] })).toBe("Mia's wedding");
  });
});
