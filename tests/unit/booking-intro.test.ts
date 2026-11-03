import { describe, expect, it } from "vitest";
import { dayHours, fromPrice, hoursRows, mapLink, stepLabel, todayLine } from "@/lib/online-booking/intro";

// Maple & Ash: closed Sunday and Monday, late on Thursday and Friday, and a
// split day to show both spans.
const HOURS = [
  { weekday: 2, start: 540, end: 1140 },
  { weekday: 3, start: 540, end: 1140 },
  { weekday: 4, start: 540, end: 1200 },
  { weekday: 5, start: 540, end: 1200 },
  { weekday: 6, start: 480, end: 720 },
  { weekday: 6, start: 780, end: 1020 },
];

describe("the booking site's intro", () => {
  it("puts days with the same hours together, from Monday", () => {
    expect(hoursRows(HOURS)).toEqual([
      { days: "Mon", hours: "Closed" },
      { days: "Tue, Wed", hours: "9am–7pm" },
      { days: "Thu, Fri", hours: "9am–8pm" },
      { days: "Sat", hours: "8am–noon, 1pm–5pm" },
      { days: "Sun", hours: "Closed" },
    ]);
    expect(hoursRows(HOURS.map((h) => ({ ...h, start: 600, end: 1080 })).filter((h) => h.weekday < 6))[1]).toEqual({ days: "Tue–Fri", hours: "10am–6pm" });
  });

  it("says today's hours", () => {
    expect(todayLine(HOURS, 4)).toBe("Open today 9am–8pm");
    expect(todayLine(HOURS, 1)).toBe("Closed today");
    expect(dayHours([], 3)).toBe("Closed");
  });

  it("links to a map search for the salon", () => {
    expect(mapLink("Maple & Ash", "123 Example Street, Springfield, IL")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Maple%20%26%20Ash%2C%20123%20Example%20Street%2C%20Springfield%2C%20IL",
    );
  });

  it("prices a service from its lowest level", () => {
    expect(fromPrice([7000, 8500, 10000])).toBe("From $70");
    expect(fromPrice([14500, 14500])).toBe("$145");
    expect(fromPrice([])).toBe("");
  });

  it("names the step", () => {
    expect(stepLabel(0)).toBe("Services · Step 1 of 5");
    expect(stepLabel(1)).toBe("Stylist · Step 2 of 5");
    expect(stepLabel(4)).toBe("Review · Step 5 of 5");
  });
});
