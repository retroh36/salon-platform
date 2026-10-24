import { describe, expect, it } from "vitest";
import { alertDue, goalPeriod, pace, parseTarget, workingDays, type Goal, type Progress } from "@/lib/goals/pacing";
import { celebration, goalActions, goalLine, periodName } from "@/lib/goals/wording";
import { datesBetween } from "@/lib/scheduling/time";

const revenue: Goal = { id: "g1", staffId: "ana", metric: "service_revenue", period: "month", target: 900000 };
const none: Progress = { achieved: 0, bookedAhead: 0, visits: 0, rebooked: 0, revenueCents: 0, tickets: 0, upcomingVisits: 0 };
const nov = goalPeriod("month", "2026-11-12");
// Ana works Tuesday to Saturday, 9 to 5: 20 days in November 2026.
const days = datesBetween(nov.from, nov.to).map((date) => ({ date, available: [0, 1].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? [] : [{ start: 540, end: 1020 }] }));

describe("goal periods and working days", () => {
  it("finds the week (Monday to Sunday), month, quarter and year", () => {
    expect(goalPeriod("week", "2026-11-12")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(goalPeriod("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(goalPeriod("quarter", "2026-11-12")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(goalPeriod("quarter", "2026-05-01")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(goalPeriod("year", "2026-11-12")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodName("quarter", "2026-10-01")).toBe("Q4");
    expect(periodName("month", "2026-11-01")).toBe("November");
  });

  it("counts working days from the schedule, today left until their hours are over", () => {
    expect(workingDays(days, "2026-11-01", 0)).toEqual({ total: 20, elapsed: 0, left: days.filter((d) => d.available.length).map((d) => d.date) });
    expect(workingDays(days, "2026-11-12", 600)).toMatchObject({ total: 20, elapsed: 7 });
    expect(workingDays(days, "2026-11-12", 1020)).toMatchObject({ total: 20, elapsed: 8 });
    expect(workingDays(days, "2026-11-30", 0)).toMatchObject({ total: 20, elapsed: 20, left: [] });
  });
});

describe("pacing a revenue goal", () => {
  it("at the start: nothing yet is on pace, and needs the whole target spread over every working day", () => {
    const p = pace(revenue, nov, { ...none, bookedAhead: 120000 }, workingDays(days, "2026-11-01", 0));
    expect(p).toMatchObject({ status: "on_pace", percent: 0, remaining: 900000, daysLeft: 20, perDay: 45000, bookedAhead: 120000, milestone: 0 });
    expect(goalLine(p)).toBe("You're on pace — $0 of $9,000 with 20 working days left; you need $450/day and you have $1,200 already booked.");
  });

  it("in the middle: exactly what's needed per working day left, and the example sentence", () => {
    // 26 working days, 17 behind her: an even pace is $5,885 by now.
    const d = { total: 26, elapsed: 17, left: Array.from({ length: 9 }, (_, i) => `2026-11-${String(20 + i).padStart(2, "0")}`) };
    const p = pace(revenue, nov, { ...none, achieved: 620000, bookedAhead: 240000 }, d);
    expect(p).toMatchObject({ status: "on_pace", percent: 68, remaining: 280000, perDay: 31112, milestone: 50 });
    // Exactly what's needed: $2,800 over 9 days is $311.12 a day.
    expect(goalLine(p)).toBe("You're on pace — $6,200 of $9,000 with 9 working days left; you need $311.12/day and you have $2,400 already booked.");
    // About them, for the owners' team view.
    expect(goalLine(p, "Ana")).toBe("Ana's on pace — $6,200 of $9,000 with 9 working days left; needs $311.12/day and has $2,400 already booked.");
    // A tenth over an even pace is ahead; a tenth under is behind.
    expect(pace(revenue, nov, { ...none, achieved: 650000 }, d).status).toBe("ahead");
    expect(pace(revenue, nov, { ...none, achieved: 520000 }, d).status).toBe("behind");
    expect(celebration(p)).toBe("Halfway to your service revenue goal for November.");
    expect(celebration(pace(revenue, nov, { ...none, achieved: 700000 }, d))).toBe("Three quarters of the way to your service revenue goal for November.");
  });

  it("at the end: hit, or short with no days left", () => {
    const end = workingDays(days, "2026-11-30", 0);
    const hit = pace(revenue, nov, { ...none, achieved: 915000 }, end);
    expect(hit).toMatchObject({ status: "hit", percent: 101, remaining: 0, perDay: 0, milestone: 100 });
    expect(goalLine(hit)).toBe("Goal hit — $9,150 of $9,000 service revenue for November. Lovely work.");
    expect(celebration(hit)).toBe("You hit your service revenue goal for November. Well done.");
    const short = pace(revenue, nov, { ...none, achieved: 800000 }, end);
    expect(short).toMatchObject({ status: "behind", remaining: 100000, perDay: null, daysLeft: 0 });
    expect(goalLine(short)).toBe("You're a little behind — $8,000 of $9,000 and the period's over.");
    // The last working day, still to come: all that's left is needed today.
    const lastDay = pace(revenue, nov, { ...none, achieved: 850000 }, workingDays(days, "2026-11-28", 600));
    expect(lastDay).toMatchObject({ daysLeft: 1, perDay: 50000 });
  });
});

describe("pacing rates and counts", () => {
  const rebooking: Goal = { id: "g2", staffId: "ana", metric: "rebooking_rate", period: "month", target: 70 };
  const mid = workingDays(days, "2026-11-12", 600);

  it("says how many of the visits left need rebooking", () => {
    // 58% of 24 so far; 12 still booked: 70% of 36 is 25.2, so 12 more.
    const p = pace(rebooking, nov, { ...none, visits: 24, rebooked: 14, upcomingVisits: 12 }, mid);
    expect(p).toMatchObject({ current: 58, status: "behind", neededRebooks: 12, milestone: 0 });
    expect(goalLine(p)).toBe("You're a little behind — 58% rebooked against your 70% goal; rebook 12 of your 12 booked visits left to get there.");
    expect(pace(rebooking, nov, { ...none, visits: 20, rebooked: 14, upcomingVisits: 5 }, mid)).toMatchObject({ current: 70, status: "ahead", neededRebooks: null });
    expect(pace(rebooking, nov, { ...none, visits: 20, rebooked: 14 }, workingDays(days, "2026-11-30", 0))).toMatchObject({ status: "hit", milestone: 100 });
    expect(goalLine(pace(rebooking, nov, none, mid))).toBe("No checkouts yet in November; your rebooking goal is 70%.");
    // Out of reach this time: 6 of 20, 10 booked; all 10 rebooked is 53%.
    const far = pace(rebooking, nov, { ...none, visits: 20, rebooked: 6, upcomingVisits: 10 }, mid);
    expect(far).toMatchObject({ current: 30, neededRebooks: null, bestRate: 53 });
    expect(goalLine(far)).toBe("You're a little behind — 30% rebooked against your 70% goal; even with every one of your 10 booked visits left rebooked, it would reach 53% this time.");
  });

  it("says what the rest of the visits need to average", () => {
    const avg: Goal = { id: "g3", staffId: "ana", metric: "average_ticket", period: "month", target: 13000 };
    // $118 over 20 tickets; 10 booked: $130 × 30 − $2,360 = $1,540, $154 each.
    const p = pace(avg, nov, { ...none, revenueCents: 236000, tickets: 20, upcomingVisits: 10 }, mid);
    expect(p).toMatchObject({ current: 11800, status: "behind", neededAverage: 15400 });
    expect(goalLine(p)).toBe("You're a little behind — $118 average ticket against your $130 goal; your 10 booked visits left need to average $154.");
  });

  it("counts new clients, with the ones already booked", () => {
    const fresh: Goal = { id: "g4", staffId: "ana", metric: "new_clients", period: "month", target: 8 };
    // An even pace is 2.8 by now (7 of 20 working days).
    const p = pace(fresh, nov, { ...none, achieved: 3, bookedAhead: 2 }, mid);
    expect(p).toMatchObject({ status: "on_pace", remaining: 5, perDay: 1 });
    expect(goalLine(p)).toBe("You're on pace — 3 of 8 new clients with 13 working days left; you need 5 more and you have 2 new clients already booked.");
    expect(pace(fresh, nov, { ...none, achieved: 1 }, mid).status).toBe("behind");
  });
});

describe("Denise's suggestions", () => {
  const d = { total: 26, elapsed: 17, left: ["2026-11-20"] };
  const behind = pace(revenue, nov, { ...none, achieved: 400000 }, d);
  const retail = pace({ ...revenue, id: "g5", metric: "retail_revenue", target: 50000 }, nov, { ...none, achieved: 10000 }, d);
  const facts = {
    overdue: [
      { name: "Ava", reason: "" },
      { name: "Ben", reason: "" },
      { name: "Cy", reason: "" },
      { name: "Di", reason: "" },
    ],
    overdueTotal: 6,
    gaps: [{ date: "2026-11-13", start: 840, end: 960, dayLabel: "tomorrow" }],
    retailClients: [{ name: "Eve", dayLabel: "Friday" }],
    upcomingVisits: 4,
  };

  it("suggests concrete things from real data, for goals that need them", () => {
    expect(goalActions([behind, retail], facts)).toEqual([
      "You have 2 hours open tomorrow from 2pm to 4pm: worth offering to the waitlist or a regular.",
      "Ava, Ben and Cy are due back with nothing booked (6 regulars in all): a quick text could fill your book.",
      "Eve (Friday) usually buys retail: have their products ready.",
    ]);
    // Nothing to suggest once goals are hit.
    expect(goalActions([pace(revenue, nov, { ...none, achieved: 900000 }, d)], facts)).toEqual([]);
  });

  it("brings the alert up once a day, or once a week from Monday", () => {
    expect(alertDue("daily", null, "2026-11-12")).toBe(true);
    expect(alertDue("daily", "2026-11-11", "2026-11-12")).toBe(true);
    expect(alertDue("daily", "2026-11-12", "2026-11-12")).toBe(false);
    // Thursday the 12th: seen on Monday the 9th, not due till next Monday.
    expect(alertDue("weekly", "2026-11-09", "2026-11-12")).toBe(false);
    expect(alertDue("weekly", "2026-11-08", "2026-11-12")).toBe(true);
    expect(alertDue("weekly", "2026-11-09", "2026-11-16")).toBe(true);
  });

  it("reads targets from the form", () => {
    expect(parseTarget("service_revenue", "$9,000")).toBe(900000);
    expect(parseTarget("rebooking_rate", "70%")).toBe(70);
    expect(parseTarget("rebooking_rate", "120")).toBe("Enter a percentage from 1 to 100.");
    expect(parseTarget("new_clients", "0")).toBe("Enter a number from 1 up.");
  });
});
