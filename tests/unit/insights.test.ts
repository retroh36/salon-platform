import { describe, expect, it } from "vitest";
import { clientInsight, timeOfDay, type ClientVisit } from "@/lib/insights/clients";
import { describeClient, usualTime } from "@/lib/insights/describe";
import { formatDuration } from "@/lib/duration";
import { BASIS_TEXT, consistencyOf, ESTIMATE_WEIGHT, kendallTau, mannKendallZ, MIN_ESTIMATED_VISITS, MIN_VISITS, stylistDurations, trendOf, type DurationSample } from "@/lib/insights/durations";
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
  const sample = (staffId: string, serviceId: string, actual: number, daysAgo: number, booked = 120, basis: DurationSample["basis"] = "tapped"): DurationSample => ({
    staffId,
    serviceId,
    bookedMinutes: booked,
    actualMinutes: actual,
    basis,
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

  it("learns from check-in to checkout when there are no taps, needing ten visits and never calling a trend", () => {
    const estimate = (m: number, i: number) => sample("hannah", "blowout", m, 100 - i * 8, 45, "check_in_out");
    const nine = [55, 56, 54, 57, 55, 58, 56, 55, 57].map(estimate);
    expect(stylistDurations(nine, menu)[0]).toMatchObject({ basis: "check_in_out", visits: 9, trusted: false, suggestedMinutes: null });
    // Ten visits, and rising steadily: trusted, but no trend from estimates.
    const ten = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62].map(estimate);
    const [d] = stylistDurations(ten, menu);
    expect(d).toMatchObject({ basis: "check_in_out", visits: 13, trusted: true, trend: "steady", medianMinutes: 56 });
    // 56 against a 45-minute menu is 11 over: enough for tapped times, not for an estimate (15).
    expect(d.suggestedMinutes).toBeNull();
    expect(stylistDurations(ten.map((x) => ({ ...x, actualMinutes: x.actualMinutes + 5 })), menu)[0].suggestedMinutes).toBe(65);
    expect(BASIS_TEXT[d.basis]).toBe("based on check-in to checkout times");
  });

  it("never mixes tapped times with estimates: tapped wins once trusted, else the trusted estimate, else whichever has more", () => {
    const tapped = (m: number, i: number) => sample("nola", "cut", m, 50 - i, 60, "tapped");
    const estimated = (m: number, i: number) => sample("nola", "cut", m, 90 - i, 60, "check_in_out");
    const twelveEstimates = Array.from({ length: 12 }, (_, i) => estimated(75, i));
    // Five taps at 50: the tapped figure, untouched by the estimates.
    const [withTaps] = stylistDurations([...[50, 52, 51, 49, 48].map(tapped), ...twelveEstimates], menu);
    expect(withTaps).toMatchObject({ basis: "tapped", visits: 5, medianMinutes: 50, trusted: true });
    // Three taps (not trusted) and a trusted estimate: the estimate.
    expect(stylistDurations([...[50, 50, 51].map(tapped), ...twelveEstimates], menu)[0]).toMatchObject({ basis: "check_in_out", visits: 12, medianMinutes: 75 });
    // Neither trusted: three taps outweigh four estimates (worth two).
    expect(stylistDurations([...[50, 50, 51].map(tapped), ...twelveEstimates.slice(0, 4)], menu)[0]).toMatchObject({ basis: "tapped", visits: 3 });
    expect(stylistDurations([...[50].map(tapped), ...twelveEstimates.slice(0, 4)], menu)[0]).toMatchObject({ basis: "check_in_out", visits: 4 });
    expect([MIN_ESTIMATED_VISITS, ESTIMATE_WEIGHT]).toEqual([10, 0.5]);
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

  it("calls it a trend only when it's significant, big enough and recent", () => {
    // Ten days apart, the latest on T0.
    const series = (values: number[], staff = "shae") => values.map((m, i) => sample(staff, "cut", m, (values.length - 1 - i) * 10, 60));
    const faster = series([76, 75, 74, 73, 70, 68, 66, 64, 63, 62, 61, 60]);
    expect(trendOf(faster, T0)).toEqual({ trend: "faster", minutes: -13 });
    expect(trendOf(series([60, 61, 59, 60, 62, 61, 60, 59, 61, 60, 62, 59]), T0).trend).toBe("steady");
    expect(trendOf(series([50, 51, 52, 52, 55, 58, 60, 61, 63, 64, 65, 66], "gil"), T0).trend).toBe("slower");
    // A big difference between noisy groups isn't significant.
    expect(trendOf(series([60, 75, 58, 74, 61, 76, 59, 73, 70, 62, 72, 74], "bridget"), T0).trend).toBe("steady");
    // Too few visits, or too few of them recent, to say.
    expect(trendOf(faster.slice(0, 5), T0).trend).toBe("steady");
    expect(trendOf(faster, daysAfter(60)).trend).toBe("steady");
  });

  it("tests for a trend with Mann-Kendall", () => {
    expect(mannKendallZ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBeGreaterThan(1.96);
    expect(mannKendallZ([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).toBeLessThan(-1.96);
    expect(Math.abs(mannKendallZ([5, 1, 4, 2, 3, 5, 1, 4, 2, 3]))).toBeLessThan(1.96);
    expect(mannKendallZ([4, 4, 4, 4])).toBe(0);
    expect(kendallTau([1, 2, 3])).toBe(1);
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
      basis: "tapped",
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
    expect(s.serviceOverruns[0]).toEqual({ serviceId: "color", visits: 6, overrunRate: 1, typicalOverMinutes: 20, estimatedShare: 0 });
    const thu = s.weekdays.find((w) => w.weekday === 4)!;
    expect(thu).toMatchObject({ visits: 12, overrunRate: 0.5, worstStaffId: "gil", worstStaffRate: 1, worstServiceIds: ["color"] });
    expect(thu.averageOverMinutes).toBe(9);
    expect(s.weekdays.find((w) => w.weekday === 2)!.overrunRate).toBe(0);
  });

  it("counts check-in to checkout estimates at half weight, and says how much is estimated", () => {
    // Two tapped visits on time, two estimated ones over: a third, not half.
    const list = [
      item({ weekday: 3, actualMinutes: 60 }),
      item({ weekday: 3, actualMinutes: 60 }),
      item({ weekday: 3, actualMinutes: 80, basis: "check_in_out" }),
      item({ weekday: 3, actualMinutes: 80, basis: "check_in_out" }),
    ];
    const s = salonInsight(list, open, 1);
    expect(s.overrunRate).toBeCloseTo(1 / 3);
    expect(s.estimatedShare).toBe(0.5);
    const wed = s.weekdays.find((w) => w.weekday === 3)!;
    expect(wed).toMatchObject({ visits: 4, estimatedShare: 0.5 });
    // Average over, weighted: (0 + 0 + 10 + 10) / 3.
    expect(wed.averageOverMinutes).toBe(7);
    expect(s.serviceOverruns[0]).toMatchObject({ overrunRate: 1 / 3, typicalOverMinutes: 20, estimatedShare: 0.5 });
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

describe("describing a client", () => {
  const base = clientInsight([], T0);
  const names = { staff: (id: string) => ({ nola: "Nola" })[id] ?? null, dayOf: () => "Tue, Nov 3" };
  const habits = { ...base, visits: 6, intervalDays: 42, preferredStaffId: "nola", preferredWeekday: 6, timeOfDay: "morning" as const, due: "overdue" as const, overdueDays: 4 };

  it("says how often they come, when and with whom, and if they're due", () => {
    const d = describeClient(habits, { lifetimeSpendCents: 54000, averageVisitCents: 9000, retailRate: 0.1 }, names, T0);
    expect(d.summary).toBe("Comes every ~6 weeks, usually Saturday mornings with Nola, slightly overdue, rarely buys retail.");
    expect(d.tags).toEqual([{ label: "$540 over 6 visits", tone: "neutral" }]);
    expect(d.line).toBe("Every ~6 weeks with Nola · slightly overdue");
  });

  it("leaves out spend for stylists, and flags risks", () => {
    const d = describeClient({ ...habits, due: "booked", nextBooked: daysAfter(5).toISOString(), lateRate: 0.4, noShowRate: 0.2, churnRisk: "high" }, null, names, T0);
    expect(d.summary).toBe("Comes every ~6 weeks, usually Saturday mornings with Nola, next visit booked for Tue, Nov 3.");
    expect(d.tags.map((t) => t.label)).toEqual(["Visits getting further apart", "Late 40% of visits", "No-show 20%"]);
  });

  it("handles new and one-visit clients, and lapsed ones", () => {
    expect(describeClient(base, null, names, T0).summary).toBe("New client: no visits yet.");
    expect(describeClient(base, null, names, T0).line).toBe("New client");
    expect(describeClient({ ...base, visits: 1, due: "not_due" }, null, names, T0).line).toBe("One visit so far");
    expect(describeClient({ ...base, visits: 3, intervalDays: 30, due: "lapsed", lastVisit: daysAfter(-70).toISOString() }, null, names, T0).line).toBe("Every ~4 weeks · hasn't been in for 10 weeks");
    expect(describeClient({ ...base, visits: 1, due: "not_due" }, null, names, T0).summary).toBe("One visit so far.");
    expect(describeClient({ ...base, visits: 3, intervalDays: 30, due: "lapsed", lastVisit: daysAfter(-70).toISOString() }, null, names, T0).summary).toBe("Comes every ~4 weeks, hasn't been in for 10 weeks.");
  });

  it("words learned times", () => {
    expect(formatDuration(161)).toBe("2 hr 41 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(usualTime("Bridget", { medianMinutes: 181, visits: 9 })).toBe("Bridget usually takes 3 hr 1 min for this (9 visits)");
  });
});
