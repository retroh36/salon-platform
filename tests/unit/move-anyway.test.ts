import { describe, expect, it } from "vitest";
import { anywayQuestion, dropIssues, issueText } from "@/lib/move-anyway";

// A 9:00 color with Gil: 30 minutes on, 30 processing, 15 finishing.
const color = [
  { kind: "active" as const, start: 540, end: 570 },
  { kind: "processing" as const, start: 570, end: 600 },
  { kind: "finishing" as const, start: 600, end: 615 },
];
const base = { stylist: "Gil", offersService: true, service: "Balayage", segments: color, shift: 0, others: [], blocks: [], unavailable: [] };

describe("dropIssues", () => {
  it("is empty where nothing's in the way", () => {
    expect(dropIssues(base)).toEqual([]);
    expect(anywayQuestion([])).toBeNull();
  });

  it("names a service the stylist doesn't usually do", () => {
    const issues = dropIssues({ ...base, offersService: false });
    expect(anywayQuestion(issues)).toEqual({ text: "Gil doesn't usually do Balayage. Move anyway?", action: "Move anyway" });
  });

  it("names the client in the way and asks to double-book", () => {
    const issues = dropIssues({ ...base, others: [{ client: "Lillian", segments: [{ kind: "active", start: 600, end: 630 }] }] });
    expect(issues.map(issueText)).toEqual(["Gil has Lillian then"]);
    expect(anywayQuestion(issues)?.action).toBe("Double-book anyway");
  });

  it("lets another client sit in the processing gap, on either side", () => {
    // Lillian's cut inside the color's processing time.
    expect(dropIssues({ ...base, others: [{ client: "Lillian", segments: [{ kind: "active", start: 575, end: 595 }] }] })).toEqual([]);
    // Moved so the color's active time sits in Lillian's processing gap.
    const lillian = [
      { kind: "active" as const, start: 600, end: 620 },
      { kind: "processing" as const, start: 620, end: 680 },
      { kind: "finishing" as const, start: 680, end: 700 },
    ];
    expect(dropIssues({ ...base, segments: [{ kind: "active", start: 540, end: 570 }], shift: 85, others: [{ client: "Lillian", segments: lillian }] })).toEqual([]);
  });

  it("names blocked time and time outside their hours", () => {
    const issues = dropIssues({ ...base, shift: 180, blocks: [{ kind: "lunch", start: 720, end: 780 }], unavailable: [{ start: 780, end: 840 }] });
    expect(issues.map(issueText)).toEqual(["Gil has lunch then", "Outside Gil's hours"]);
    expect(anywayQuestion(issues)?.text).toBe("Gil has lunch then. Outside Gil's hours. Move anyway?");
  });
});
