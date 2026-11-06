import { describe, expect, it } from "vitest";
import { notCharged, parseMissRange, type Incident } from "@/lib/policy-report";

const at = (o: Partial<Incident>): Incident => ({ kind: "no_show", visitCents: 10_000, feeCents: 5_000, collectedCents: 0, status: "no_card", waiveReason: null, ...o });

describe("not charged, and why", () => {
  it("counts the booked value with no fee collected, by reason", () => {
    const r = notCharged([
      at({ status: "charged", collectedCents: 5_000 }),
      at({ status: "no_card" }),
      at({ status: "failed", visitCents: 8_000 }),
      at({ kind: "late_cancel", status: "none", feeCents: 0 }),
      at({ status: null, feeCents: 0 }),
      at({ status: "pending", collectedCents: 2_000 }),
    ]);
    expect(r).toMatchObject({ incidents: 6, noShows: 5, lateCancels: 1, visitCents: 58_000, feeCents: 20_000, collectedCents: 7_000 });
    // A charged fee below the visit's price isn't a miss; a kept deposit comes off.
    expect(r.notChargedCents).toBe(10_000 + 8_000 + 10_000 + 10_000 + 8_000);
    expect(r.uncollectedFeeCents).toBe(5_000 + 5_000 + 3_000);
    expect(r.rows.map((x) => [x.reason, x.count, x.visitCents])).toEqual([
      ["no_card", 1, 10_000],
      ["failed", 1, 8_000],
      ["waiting", 1, 8_000],
      ["no_fee", 1, 10_000],
      ["not_assessed", 1, 10_000],
    ]);
  });

  it("lists staff's waive reasons, the costliest first, folding the rest", () => {
    const waived = (text: string | null, visitCents = 10_000) => at({ status: "waived", waiveReason: text, visitCents });
    const r = notCharged([waived("Family emergency"), waived("Family emergency"), waived("Weather", 30_000), waived(null), waived("  "), waived("Regular"), waived("Sick")], 3);
    const row = r.rows.find((x) => x.reason === "waived")!;
    expect(row.count).toBe(7);
    expect(row.reasons).toEqual([
      { text: "Weather", count: 1, cents: 30_000 },
      { text: "Family emergency", count: 2, cents: 20_000 },
      { text: "No reason given", count: 2, cents: 20_000 },
      { text: "Other reasons", count: 2, cents: 20_000 },
    ]);
  });

  it("is empty with nothing to report", () => {
    expect(notCharged([])).toMatchObject({ incidents: 0, notChargedCents: 0, rows: [] });
  });

  it("takes any period up to a year and up to today, this month by default", () => {
    expect(parseMissRange({}, "2026-11-05")).toEqual({ from: "2026-11-01", to: "2026-11-05" });
    expect(parseMissRange({ from: "2026-10-31", to: "2026-01-01" }, "2026-11-05")).toEqual({ from: "2026-01-01", to: "2026-10-31" });
    expect(parseMissRange({ from: "2024-01-01", to: "2026-11-01" }, "2026-11-05")).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    expect(parseMissRange({ from: "2026-12-01", to: "2027-01-01" }, "2026-11-05")).toEqual({ from: "2026-11-05", to: "2026-11-05" });
    expect(parseMissRange({ from: "nope", to: "2026-02-30x" }, "2026-11-05")).toEqual({ from: "2026-11-01", to: "2026-11-05" });
  });
});
