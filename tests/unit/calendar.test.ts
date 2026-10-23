import { describe, expect, it } from "vitest";
import { bookedSummary, compactHours, quarterMarks, summaryVariants, ZOOM_PX_PER_MINUTE, FAMILIES, FAMILY_LABELS, gridRange, hourMarks, laneBox, layoutColumn, offHours, serviceFamily } from "@/lib/calendar";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const span = (start: number, end: number) => ({ start, end });

describe("service families", () => {
  it("groups the seeded categories", () => {
    expect(serviceFamily("Color", "Root Touch-Up")).toBe("color");
    expect(serviceFamily("Highlights", "Babylights")).toBe("color");
    expect(serviceFamily("Balayage", "Foilayage")).toBe("color");
    expect(serviceFamily("Cuts", "Skin Fade")).toBe("cut");
    expect(serviceFamily("Blowouts & Styling", "Updo")).toBe("finish");
    expect(serviceFamily("Treatments", "Keratin Smoothing")).toBe("treatment");
  });

  it("treats glosses and toners as finishing, wherever they're filed", () => {
    expect(serviceFamily("Color", "Gloss / Toner")).toBe("finish");
    expect(serviceFamily("Colour", "Toner refresh")).toBe("finish");
  });

  it("recognizes other salons' names, and falls back to other", () => {
    expect(serviceFamily("Colour services")).toBe("color");
    expect(serviceFamily("Barbering")).toBe("cut");
    expect(serviceFamily("Hair styling")).toBe("finish");
    expect(serviceFamily("Scalp care")).toBe("treatment");
    expect(serviceFamily("Nails")).toBe("other");
  });

  it("labels every family", () => {
    expect(FAMILIES.map((f) => FAMILY_LABELS[f])).toEqual(["Color", "Cuts", "Gloss & blowouts", "Treatments", "Other"]);
  });
});

describe("grid range", () => {
  it("uses the day's opening hours", () => {
    expect(gridRange([span(h(9), h(19))], [span(h(8), h(20))], [])).toEqual(span(h(9), h(19)));
  });

  it("falls back when the salon is closed", () => {
    expect(gridRange([], [span(h(8), h(20))], [])).toEqual(span(h(8), h(20)));
    expect(gridRange([], [], [])).toEqual(span(h(9), h(17)));
  });

  it("stretches to whole hours around appointments outside opening hours", () => {
    expect(gridRange([span(h(9), h(17))], [], [span(h(8, 30), h(9, 15)), span(h(16), h(17, 20))])).toEqual(span(h(8), h(18)));
  });

  it("never goes past midnight", () => {
    expect(gridRange([span(h(9), h(23, 30))], [], [])).toEqual(span(h(9), h(24)));
  });
});

describe("off hours", () => {
  it("is the range minus bookable time", () => {
    expect(offHours(span(h(9), h(19)), [span(h(9), h(13)), span(h(14), h(18))])).toEqual([span(h(13), h(14)), span(h(18), h(19))]);
    expect(offHours(span(h(9), h(19)), [])).toEqual([span(h(9), h(19))]);
  });
});

describe("hour marks", () => {
  it("labels each whole hour in the range", () => {
    expect(hourMarks(span(h(9), h(12)))).toEqual([h(9), h(10), h(11)]);
    expect(hourMarks(span(h(8, 30), h(10)))).toEqual([h(9)]);
  });
});

describe("column layout", () => {
  const lanes = (blocks: { start: number; end: number }[]) => layoutColumn(blocks).map((b) => [b.start, b.lane, b.lanes]);

  it("keeps separate blocks full width", () => {
    expect(lanes([span(h(10), h(11)), span(h(11), h(12))])).toEqual([
      [h(10), 0, 1],
      [h(11), 0, 1],
    ]);
  });

  it("gives a client booked into a processing gap its own lane", () => {
    // Color 10:00-11:45 with a cut in its processing gap at 10:45.
    expect(lanes([span(h(10, 45), h(11, 15)), span(h(10), h(11, 45))])).toEqual([
      [h(10), 0, 2],
      [h(10, 45), 1, 2],
    ]);
  });

  it("reuses a lane once it's free, within the same group", () => {
    expect(lanes([span(h(10), h(13)), span(h(10, 30), h(11)), span(h(11, 30), h(12))])).toEqual([
      [h(10), 0, 2],
      [h(10, 30), 1, 2],
      [h(11, 30), 1, 2],
    ]);
  });

  it("adds lanes for three-way overlaps, longest first", () => {
    expect(lanes([span(h(10), h(11)), span(h(10), h(12)), span(h(10, 30), h(11))])).toEqual([
      [h(10), 0, 3],
      [h(10), 1, 3],
      [h(10, 30), 2, 3],
    ]);
  });

  it("only widens the group that overlaps", () => {
    expect(lanes([span(h(9), h(10)), span(h(9, 30), h(9, 45)), span(h(14), h(15))])).toEqual([
      [h(9), 0, 2],
      [h(9, 30), 1, 2],
      [h(14), 0, 1],
    ]);
  });

  it("chains overlaps into one group", () => {
    // A overlaps B, B overlaps C, A and C don't: still one group of two lanes.
    expect(lanes([span(h(9), h(10)), span(h(9, 30), h(10, 30)), span(h(10), h(11))])).toEqual([
      [h(9), 0, 2],
      [h(9, 30), 1, 2],
      [h(10), 0, 2],
    ]);
  });

  it("keeps the blocks' own fields", () => {
    expect(layoutColumn([{ ...span(h(10), h(11)), id: "a" }])[0]).toEqual({ start: h(10), end: h(11), id: "a", lane: 0, lanes: 1 });
  });
});

describe("lane boxes", () => {
  it("keeps the main lane wide and puts others in a narrow strip on the right", () => {
    expect(laneBox(0, 1)).toEqual({ left: 0, width: 100 });
    expect(laneBox(0, 2)).toEqual({ left: 0, width: 60 });
    expect(laneBox(1, 2)).toEqual({ left: 60, width: 40 });
    const three = [0, 1, 2].map((l) => laneBox(l, 3));
    expect(three.map((b) => Math.round(b.left))).toEqual([0, 40, 70]);
    expect(Math.round(three.reduce((sum, b) => sum + b.width, 0))).toBe(100);
  });
});

describe("bookedSummary", () => {
  it("counts visits once and adds up their time", () => {
    expect(bookedSummary([])).toBe("No bookings");
    expect(bookedSummary([{ appointmentId: "a", minutes: 45 }])).toBe("1 visit · 45m booked");
    expect(
      bookedSummary([
        { appointmentId: "a", minutes: 105 },
        { appointmentId: "a", minutes: 45 },
        { appointmentId: "b", minutes: 60 },
      ]),
    ).toBe("2 visits · 3h 30m booked");
    expect(bookedSummary([{ appointmentId: "a", minutes: 120 }])).toBe("1 visit · 2h booked");
  });

  it("labels every quarter hour, marking the hours", () => {
    expect(quarterMarks(span(h(9), h(10, 30)))).toEqual([
      { minute: h(9), hour: true },
      { minute: h(9, 15), hour: false },
      { minute: h(9, 30), hour: false },
      { minute: h(9, 45), hour: false },
      { minute: h(10), hour: true },
      { minute: h(10, 15), hour: false },
    ]);
  });

  it("draws a quarter hour 30, 40 and 60px tall by zoom", () => {
    expect([ZOOM_PX_PER_MINUTE.compact, ZOOM_PX_PER_MINUTE.comfortable, ZOOM_PX_PER_MINUTE.detailed].map((p) => Math.round(p * 15))).toEqual([30, 40, 60]);
  });

  it("puts working hours on one short line", () => {
    expect(compactHours([span(h(9), h(13)), span(h(14), h(18))])).toBe("9–1, 2–6");
    expect(compactHours([span(h(10), h(19))])).toBe("10–7");
    expect(compactHours([span(h(9), h(13)), span(h(13, 30), h(17, 30))])).toBe("9–1, 1:30–5:30");
    expect(compactHours([span(h(11), h(24))])).toBe("11–12");
  });

  it("shortens to fit a narrow header", () => {
    expect(summaryVariants("7 visits · 6h 10m booked")).toEqual(["7 visits · 6h 10m booked", "7 visits · 6h 10m", "7 · 6h 10m"]);
    expect(summaryVariants("1 visit · 45m booked")).toEqual(["1 visit · 45m booked", "1 visit · 45m", "1 · 45m"]);
    expect(summaryVariants("No bookings")).toEqual(["No bookings"]);
  });
});
