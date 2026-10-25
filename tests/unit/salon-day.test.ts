// Moments shown as the salon's own day and time, never UTC's or the
// device's: an evening visit in Chicago is still that evening's date.
import { describe, expect, it } from "vitest";
import { sentAtText } from "@/lib/checkout-screen";
import { formatDayAt } from "@/lib/schedule-format";

const TZ = "America/Chicago";

describe("the salon's day", () => {
  it("names an evening visit by its own date, though it's tomorrow in UTC", () => {
    // 7:30pm Friday Oct 30 in Chicago is 00:30 Saturday in UTC.
    expect(formatDayAt("2026-10-31T00:30:00Z", TZ)).toBe("Fri, Oct 30");
    // The night the clocks go back: 11pm Saturday CDT, then Sunday's 9am CST.
    expect(formatDayAt("2026-11-01T04:00:00Z", TZ)).toBe("Sat, Oct 31");
    expect(formatDayAt("2026-11-01T15:00:00Z", TZ)).toBe("Sun, Nov 1");
  });

  it("says when a payment link went out in the salon's time", () => {
    expect(sentAtText("2026-10-31T00:30:00Z", TZ, "2026-10-30")).toBe("7:30pm");
    expect(sentAtText("2026-10-31T00:30:00Z", TZ, "2026-10-31")).toBe("Fri, Oct 30, 7:30pm");
  });
});
