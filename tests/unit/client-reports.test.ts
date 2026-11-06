// Client reports: dates as words, reading a definition from untrusted
// JSON, the one-sentence description and the link encoding.
import { describe, expect, it } from "vitest";
import { dateRefText, decodeReport, describeReport, EMPTY_REPORT, encodeReport, minVisitsOf, readReport, reportCsvRows, reportProblem, resolveDate, type ClientReport } from "@/lib/client-reports";

const TODAY = "2026-11-06"; // a Friday
const known = { categories: ["Cut", "Color", "Treatment"], serviceIds: ["s-balayage", "s-gloss"], staffIds: ["t-bridget", "t-gil"] };
const names = { services: new Map([["s-balayage", "Balayage"], ["s-gloss", "Gloss"]]), staff: new Map([["t-bridget", "Bridget"], ["t-gil", "Gil"]]) };
const report = (r: Partial<ClientReport>): ClientReport => ({ ...EMPTY_REPORT, ...r });

describe("dates as words", () => {
  it("resolves the starts of periods, amounts ago, months and days against today", () => {
    expect(resolveDate("today", TODAY)).toBe("2026-11-06");
    expect(resolveDate("this_week", TODAY)).toBe("2026-11-02");
    expect(resolveDate("this_month", TODAY)).toBe("2026-11-01");
    expect(resolveDate("last_month", TODAY)).toBe("2026-10-01");
    expect(resolveDate("this_year", TODAY)).toBe("2026-01-01");
    expect(resolveDate("last_year", TODAY)).toBe("2025-01-01");
    expect(resolveDate("30 days ago", TODAY)).toBe("2026-10-07");
    expect(resolveDate("2 weeks ago", TODAY)).toBe("2026-10-23");
    expect(resolveDate("6 months ago", TODAY)).toBe("2026-05-06");
    expect(resolveDate("1 year ago", TODAY)).toBe("2025-11-06");
    expect(resolveDate("1 month ago", "2026-03-31")).toBe("2026-02-28");
    expect(resolveDate("2024-06", TODAY)).toBe("2024-06-01");
    expect(resolveDate("2024-06-15", TODAY)).toBe("2024-06-15");
    expect(resolveDate("next tuesday", TODAY)).toBeNull();
    expect(resolveDate("2024-13", TODAY)).toBeNull();
  });

  it("reads them back in words", () => {
    expect(dateRefText("this_year")).toBe("the start of this year");
    expect(dateRefText("6 months ago")).toBe("6 months ago");
    expect(dateRefText("1 years ago")).toBe("1 year ago");
    expect(dateRefText("2024-06")).toBe("June 2024");
    expect(dateRefText("2024-06-15")).toBe("Jun 15, 2024");
  });
});

describe("reading a report", () => {
  it("keeps only the salon's categories, services and stylists, and says what it dropped", () => {
    const { report: r, dropped } = readReport({ categories: ["color", "Nails"], serviceIds: ["s-gloss", "s-nope"], staffIds: ["t-gil"], from: "2024-06", to: "soon", minVisits: 3, sort: "visits" }, known);
    expect(r).toMatchObject({ categories: ["Color"], serviceIds: ["s-gloss"], staffIds: ["t-gil"], from: "2024-06", to: null, minVisits: 3, sort: "visits" });
    expect(dropped).toEqual(['the category "Nails"', 'a service "s-nope"', 'the date "soon"']);
  });

  it("ignores anything that isn't a count, a known sort or a positive spend", () => {
    const { report: r } = readReport({ minVisits: -1, maxVisits: 2.5, sort: "phone", minSpendCents: -5, nextVisit: "maybe" }, known);
    expect(r).toEqual(EMPTY_REPORT);
    expect(readReport(null, known).report).toEqual(EMPTY_REPORT);
  });

  it("counts at least one visit when it asks about services, stylists or dates", () => {
    expect(minVisitsOf(report({ categories: ["Color"] }))).toBe(1);
    expect(minVisitsOf(report({ categories: ["Color"], maxVisits: 0 }))).toBe(0);
    expect(minVisitsOf(report({ nextVisit: "none" }))).toBe(0);
    expect(minVisitsOf(report({ minVisits: 3 }))).toBe(3);
  });

  it("says when it can't run", () => {
    expect(reportProblem(report({ minVisits: 4, maxVisits: 2 }), TODAY)).toMatch(/fewest/);
    expect(reportProblem(report({ from: "this_year", to: "last_year" }), TODAY)).toMatch(/isn't before/);
    expect(reportProblem(report({ visitedSince: "this_month", noVisitSince: "this_year" }), TODAY)).toMatch(/No client/);
    expect(reportProblem(report({ from: "2024-06", noVisitSince: "this_year", minVisits: 3 }), TODAY)).toBeNull();
  });
});

describe("the sentence", () => {
  it("reads the same every time", () => {
    expect(describeReport(report({ categories: ["Cut", "Color"], from: "2024-06", minVisits: 3, noVisitSince: "this_year" }), names)).toBe(
      "Clients with 3 or more Cut or Color visits since June 2024, and no visit since the start of this year.",
    );
    expect(describeReport(report({ serviceIds: ["s-balayage"], staffIds: ["t-bridget"], nextVisit: "none" }), names)).toBe("Clients with a Balayage visit with Bridget, and nothing booked.");
    expect(describeReport(report({ categories: ["Color"], from: "6 months ago", maxVisits: 0, visitedSince: "2 years ago" }), names)).toBe(
      "Clients with no Color visits since 6 months ago, and a visit since 2 years ago.",
    );
    expect(describeReport(report({ minSpendCents: 100_000, nextVisit: "booked" }), names)).toBe("Clients with a visit booked, and spent at least $1,000.");
    expect(describeReport(EMPTY_REPORT, names)).toBe("Every client.");
  });
});

describe("links and the CSV", () => {
  it("round-trips through a link, leaving out what's empty", () => {
    const r = report({ categories: ["Color"], from: "2024-06", minVisits: 3, sort: "visits" });
    const text = encodeReport(r);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeReport(text)).toEqual({ categories: ["Color"], from: "2024-06", minVisits: 3, sort: "visits" });
    expect(readReport(decodeReport(text), known).report).toEqual(r);
    expect(decodeReport("%%%")).toBeNull();
  });

  it("has spend only for those who see it", () => {
    const rows = [{ id: "c1", firstName: "Ava", lastName: "Stone", phone: "(312) 555-0100", visits: 4, lastVisit: "2025-12-02", nextVisit: null, usualStylist: "Bridget Moss", spendCents: 123_456 }];
    expect(reportCsvRows(rows, true).rows[0]).toEqual(["Ava", "Stone", "(312) 555-0100", 4, "2025-12-02", null, "Bridget Moss", "1234.56"]);
    expect(reportCsvRows(rows, false).header).not.toContain("Spend");
  });
});
