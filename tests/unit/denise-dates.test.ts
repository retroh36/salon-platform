import { describe, expect, it } from "vitest";
import { sayDate } from "@/lib/denise/knowledge";

// Denise's facts carry the weekday, so Claude never works one out.
describe("dates in Denise's facts", () => {
  it("says the weekday, and the year only when it isn't this one", () => {
    expect(sayDate("2026-10-24", "2026-10-24")).toBe("Sat, Oct 24");
    expect(sayDate("2026-10-22", "2026-10-24")).toBe("Thu, Oct 22");
    expect(sayDate("2025-12-31", "2026-01-02")).toBe("Wed, Dec 31, 2025");
  });
});
