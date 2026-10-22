import { describe, expect, it } from "vitest";
import { clientInsight, timeOfDay, type ClientVisit } from "@/lib/insights/clients";
import { consistencyOf, kendallTau, MIN_VISITS, stylistDurations, trendOf, type DurationSample } from "@/lib/insights/durations";
import { salonInsight, type SalonItem } from "@/lib/insights/salon";
import { ceilTo, median, mode, quantile, withoutOutliers } from "@/lib/insights/stats";

const DAY = 86_400_000;
const T0 = new Date("2026-06-01T15:00:00Z");
const daysAfter = (n: number, base = T0) => new Date(base.getTime() + n * DAY);

describe("stats", () => {
  it("medians and quantiles", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(quantile([10, 20, 30, 40], 0.75)).toBe(32.5);
  });

  it("sets aside outliers only when there's enough to judge", () => {
    expect(withoutOutliers([60, 62, 200])).toEqual({ kept: [60, 62, 200], dropped: [] });
    expect(withoutOutliers([60, 61, 62, 63, 64, 65, 140])).toEqual({ kept: [60, 61, 62, 63, 64, 65], dropped: [140] });
    expect(withoutOutliers([60, 61, 62, 63, 64]).dropped).toEqual([]);
  });

  it("finds the most common value, if common enough", () => {
    expect(mode(["a", "b", "a"])).toEqual({ value: "a", share: 2 / 3 });
    expect(mode(["a", "b", "c"], 0.5)).toBeNull();
    expect(mode([])).toBeNull();
    expect(ceilTo(161, 5)).toBe(165);
    expect(ceilTo(160, 5)).toBe(160);
  });
});

describe("stylist durations", () => {
  const sample = (staffId: string, serviceId: string, actual: number, daysAgo: number, booked = 120): DurationSample => ({
    staffId,
    serviceId,
    bookedMinutes: booked,
    actualMinutes: actual,
    at: daysAfter(-daysAgo),
  });
  const menu = new Map([["balayage", 155], ["cut", 60]]);

  it("finds the typical time, its spread and how many visits it's from, ignoring an outlier", () => {
    const visits = [158, 160, 162, 165, 170, 163, 161, 240].map((m, i) => sample("bridget", "balayage", m, 80 - i * 10, 155));
    const [d] = stylistDurations(visits, menu);
    expect(d).toMatchObject({ staffId: "bridget", serviceId: "balayage", visits: 7, outliers: 1, trusted: true, medianMinutes: 162, menuMinutes: 155, consistency: "steady" });
    // Typical 162 is within 10 minutes of the menu's 155: no suggestion.
    expect(d.suggestedMinutes).toBeNull();
  });

  it("suggests a length (rounded up to 5 minutes) once trusted and far enough from the menu", () => {
    const visits = [180, 182, 185, 178, 190, 184].map((m, i) => sample("bridget", "balayage", m, 60 - i * 7, 155));
    const [d] = stylistDurations(visits, menu);
    expect(d.medianMinutes).toBe(183);
    expect(d.suggestedMinutes).toBe(185);
    expect(d.overrunRate).toBe(1);
  });

  it("doesn't trust fewer than five visits", () => {
    const visits = [190, 200, 195, 205].map((m, i) => sample("gil", "balayage", m, 30 - i, 155));
    const [d] = stylistDurations(visits, menu);
    expect(d.visits).toBe(4);
    expect(d.trusted).toBe(false);
    expect(d.suggestedMinutes).toBeNull();
    expect(MIN_VISITS).toBe(5);
  });

  it("keeps each stylist and service apart, and skips untimed visits", () => {
    const list = [
      ...[60, 62, 61, 63, 60].map((m, i) => sample("shae", "cut", m, i, 60)),
      ...[45, 47, 48, 46, 44].map((m, i) => sample("nola", "cut", m, i, 60)),
      sample("nola", "cut", 0, 9, 60),
    ];
    const result = stylistDurations(list, menu);
    expect(result.map((d) => `${d.staffId}:${d.medianMinutes}:${d.visits}`)).toEqual(["nola:46:5", "shae:61:5"]);
    expect(result[0].suggestedMinutes).toBe(50);
  });

  it("judges consistency from the middle half's spread", () => {
    expect(consistencyOf(58, 62, 60)).toBe("steady");
    expect(consistencyOf(55, 65, 60)).toBe("varies");
    expect(consistencyOf(45, 75, 60)).toBe("unpredictable");
  });

  it("notices a stylist getting faster or slower", () => {
    const faster = [76, 75, 74, 73, 70, 68, 66, 64, 63, 62, 61, 60].map((m, i) => sample("shae", "cut", m, 120 - i * 10, 60));
    expect(trendOf(faster)).toEqual({ trend: "faster", minutes: -13 });
    const steady = [60, 61, 59, 60, 62, 61, 60, 59, 61, 60, 62, 59].map((m, i) => sample("shae", "cut", m, 120 - i * 10, 60));
    expect(trendOf(steady).trend).toBe("steady");
    const slower = [50, 51, 52, 52, 55, 58, 60, 61, 63, 64, 65, 66].map((m, i) => sample("gil", "cut", m, 120 - i * 10, 60));
    expect(trendOf(slower).trend).toBe("slower");
    // A big difference between noisy groups isn't a trend.
    const noisy = [60, 75, 58, 74, 61, 76, 59, 73, 70, 62, 72, 74].map((m, i) => sample("bridget", "cut", m, 120 - i * 10, 60));
    expect(trendOf(noisy).trend).toBe("steady");
    expect(kendallTau([1, 2, 3])).toBe(1);
    expect(kendallTau([3, 2, 1])).toBe(-1);
    // Too few visits to say.
    expect(trendOf(faster.slice(0, 5)).trend).toBe("steady");
  });
});

describe("client patterns", () => {
  const visit = (daysFromT0: number, over: Partial<ClientVisit> = {}): ClientVisit => {
    const start = daysAfter(daysFromT0);
    return {
      appointmentId: `a${daysFromT0}`,
      start,
      weekday: 6,
      minute: 10 * 60,
      status: "completed",
      staffIds: ["nola"],
      serviceIds: ["cut"],
      minutesLate: 2,
      serviceCents: 6000,
      retailCents: 0,
      ...over,
    };
  };

  it("works out their usual gap, when they're next due, and their habits", () => {
    const visits = [visit(0), visit(42), visit(84, { retailCents: 3000 }), visit(126, { staffIds: ["shae"], weekday: 3, minute: 15 * 60 })];
    const c = clientInsight(visits, daysAfter(162));
    expect(c).toMatchObject({
      visits: 4,
      intervalDays: 42,
      intervalTrusted: true,
      overdueDays: 0,
      due: "due_soon",
      preferredStaffId: "nola",
      preferredWeekday: 6,
      timeOfDay: "morning",
      usualServiceIds: ["cut"],
      retailRate: 0.25,
      lifetimeSpendCents: 27000,
      averageVisitCents: 6750,
      churnRisk: "low",
    });
    expect(c.nextDue).toBe(daysAfter(168).toISOString());
  });

  it("is overdue after their usual gap, lapsed after twice it, and high churn risk when drifting", () => {
    const visits = [visit(0), visit(30), visit(60)];
    expect(clientInsight(visits, daysAfter(100))).toMatchObject({ due: "overdue", overdueDays: 10, churnRisk: "medium" });
    expect(clientInsight(visits, daysAfter(130))).toMatchObject({ due: "lapsed", churnRisk: "high" });
    // Gaps getting longer: 30, 30, then 60.
    expect(clientInsight([...visits, visit(120)], daysAfter(125)).churnRisk).toBe("high");
  });

  it("isn't due when their next visit is booked", () => {
    const c = clientInsight([visit(0), visit(30), visit(60), visit(95, { status: "confirmed" })], daysAfter(92));
    expect(c).toMatchObject({ due: "booked", churnRisk: "low", nextBooked: daysAfter(95).toISOString() });
  });

  it("counts lateness, cancellations, no-shows and retail", () => {
    const visits = [
      visit(0, { minutesLate: 15 }),
      visit(30, { minutesLate: 12, retailCents: 2800 }),
      visit(60, { minutesLate: 0 }),
      visit(70, { status: "canceled", minutesLate: null }),
      visit(90, { status: "no_show", minutesLate: null }),
    ];
    const c = clientInsight(visits, daysAfter(100));
    expect(c.lateRate).toBeCloseTo(2 / 3);
    expect(c.cancelRate).toBe(1 / 5);
    expect(c.noShowRate).toBe(1 / 4);
    expect(c.retailRate).toBeCloseTo(1 / 3);
  });

  it("handles new clients and one-visit clients", () => {
    expect(clientInsight([], T0)).toMatchObject({ visits: 0, due: "new", intervalDays: null, lastVisit: null });
    const one = clientInsight([visit(0)], daysAfter(10));
    expect(one).toMatchObject({ visits: 1, intervalDays: 42, intervalTrusted: false, due: "not_due" });
  });

  it("names the time of day", () => {
    expect([9 * 60, 13 * 60, 18 * 60].map(timeOfDay)).toEqual(["morning", "afternoon", "evening"]);
  });
});

describe("salon patterns", () => {
  let n = 0;
  const item = (over: Partial<SalonItem>): SalonItem => {
    n++;
    const start = over.start ?? daysAfter(n);
    return {
      appointmentId: `a${n}`,
      clientId: `c${n}`,
      staffId: "nola",
      serviceId: "cut",
      start,
      weekday: 2,
      minute: 10 * 60,
      bookedMinutes: 60,
      actualMinutes: 60,
      status: "completed",
      createdAt: daysAfter(-7, start),
      checkedOutAt: new Date(start.getTime() + 65 * 60_000),
      ...over,
    };
  };
  const open = { 2: [{ start: 9 * 60, end: 12 * 60 }], 4: [{ start: 9 * 60, end: 12 * 60 }] };

  it("finds busy and quiet hours, per week", () => {
    const s = salonInsight([item({ weekday: 4, minute: 9 * 60 }), item({ weekday: 4, minute: 9 * 60 }), item({ weekday: 2, minute: 11 * 60 })], open, 2);
    expect(s.busiest[0]).toEqual({ weekday: 4, hour: 9, bookedMinutesPerWeek: 60 });
    expect(s.quietest.map((h) => `${h.weekday}:${h.hour}`)).toContain("2:9");
    expect(s.hours).toHaveLength(6);
  });

  it("finds which services and weekdays run over, and who runs over on them", () => {
    const thursday = [
      ...Array.from({ length: 6 }, () => item({ weekday: 4, staffId: "gil", serviceId: "color", bookedMinutes: 85, actualMinutes: 105 })),
      ...Array.from({ length: 6 }, () => item({ weekday: 4, staffId: "shae", actualMinutes: 58 })),
    ];
    const tuesday = Array.from({ length: 6 }, () => item({ weekday: 2, actualMinutes: 61 }));
    const s = salonInsight([...thursday, ...tuesday], open, 4);
    expect(s.serviceOverruns[0]).toEqual({ serviceId: "color", visits: 6, overrunRate: 1, typicalOverMinutes: 20 });
    const thu = s.weekdays.find((w) => w.weekday === 4)!;
    expect(thu).toMatchObject({ visits: 12, overrunRate: 0.5, worstStaffId: "gil", worstStaffRate: 1, worstServiceIds: ["color"] });
    expect(thu.averageOverMinutes).toBe(9);
    expect(s.weekdays.find((w) => w.weekday === 2)!.overrunRate).toBe(0);
  });

  it("counts no-shows by day and time of day, per visit", () => {
    const s = salonInsight(
      [item({ weekday: 6, minute: 9 * 60, status: "no_show", actualMinutes: null }), item({ weekday: 6, minute: 9 * 60 }), item({ weekday: 2, minute: 15 * 60 })],
      open,
      1,
    );
    expect(s.noShowsByWeekday).toEqual([
      { key: 2, visits: 1, rate: 0 },
      { key: 6, visits: 2, rate: 0.5 },
    ]);
    expect(s.noShowsByTimeOfDay.find((t) => t.key === "morning")).toEqual({ key: "morning", visits: 2, rate: 0.5 });
    expect(s.noShowRate).toBeCloseTo(1 / 3);
  });

  it("counts a visit as rebooked when the next one was booked by the day after", () => {
    const first = item({ clientId: "emma", staffId: "nola", start: daysAfter(0) });
    const next = item({ clientId: "emma", start: daysAfter(42), createdAt: daysAfter(0.1), status: "confirmed", actualMinutes: null });
    const other = item({ clientId: "liam", staffId: "shae", start: daysAfter(1) });
    const late = item({ clientId: "liam", start: daysAfter(40), createdAt: daysAfter(20), status: "confirmed", actualMinutes: null });
    const s = salonInsight([first, next, other, late], open, 6);
    expect(s.rebooking).toEqual([
      { staffId: "nola", visits: 1, rebookedRate: 1 },
      { staffId: "shae", visits: 1, rebookedRate: 0 },
    ]);
    expect(s.rebookedRate).toBe(0.5);
  });
});
