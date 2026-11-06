import { describe, expect, it } from "vitest";
import { copyForward, copyPerson, personMonth } from "@/lib/schedule-month";
import { addDays, type LocalDate } from "@/lib/scheduling/time";
import type { Cell, Shift } from "@/lib/team-schedule";

const h = (hours: number) => hours * 60;
const nine5: Shift[] = [{ start: h(9), end: h(17) }];
const split: Shift[] = [
  { start: h(9), end: h(13) },
  { start: h(14), end: h(18) },
];

const cell = (staffId: string, date: LocalDate, live: Shift[], more: Partial<Cell> = {}): Cell => ({ staffId, date, live, draft: null, timeOff: [], booked: [], ...more });

// Three weeks from Monday Nov 2, 2026, for Gil and Nola.
const MON = "2026-11-02";
const days = Array.from({ length: 21 }, (_, i) => addDays(MON, i));

describe("copying a week forward", () => {
  const cells = [
    ...days.map((d, i) => cell("gil", d, i < 7 && i % 7 < 5 ? (i === 2 ? split : nine5) : [])),
    ...days.map((d) => cell("nola", d, [])),
  ];

  it("repeats each day on the same weekday of the weeks after, only where it changes", () => {
    const edits = copyForward(cells, MON, 2, MON);
    expect(edits.filter((e) => e.staffId === "gil")).toHaveLength(10);
    expect(edits.find((e) => e.date === "2026-11-11")).toEqual({ staffId: "gil", date: "2026-11-11", shifts: split });
    // Nola's empty week copies onto empty weeks: nothing to do.
    expect(edits.some((e) => e.staffId === "nola")).toBe(false);
  });

  it("takes the draft as shown, skips past days and can be for one person", () => {
    const withDraft = cells.map((c) => (c.staffId === "nola" && c.date === MON ? { ...c, draft: nine5 } : c));
    const edits = copyForward(withDraft, MON, 2, "2026-11-12", "nola");
    expect(edits).toEqual([{ staffId: "nola", date: "2026-11-16", shifts: nine5 }]);
  });

  it("stops at the days it has", () => {
    expect(copyForward(cells, MON, 8, MON).every((e) => e.date <= days.at(-1)!)).toBe(true);
  });
});

describe("copying another person's days", () => {
  const cells = [cell("gil", MON, nine5), cell("gil", "2026-11-03", []), cell("gil", "2026-11-04", split), cell("nola", MON, []), cell("nola", "2026-11-03", nine5), cell("nola", "2026-11-04", split)];

  it("gives them the same shifts, days off included, from today on", () => {
    expect(copyPerson(cells, "gil", "nola", MON, "2026-11-04", MON)).toEqual([
      { staffId: "nola", date: MON, shifts: nine5 },
      { staffId: "nola", date: "2026-11-03", shifts: [] },
    ]);
    expect(copyPerson(cells, "gil", "nola", MON, "2026-11-04", "2026-11-03")).toEqual([{ staffId: "nola", date: "2026-11-03", shifts: [] }]);
  });
});

describe("a person's month", () => {
  it("counts hours less time off, days, time off, clients and drafts in the month only", () => {
    const cells = [
      cell("gil", "2026-10-31", nine5),
      cell("gil", MON, nine5, { booked: [{ appointmentId: "a", client: "Ann", start: h(9), end: h(10) }, { appointmentId: "a", client: "Ann", start: h(11), end: h(12) }] }),
      cell("gil", "2026-11-03", nine5, { timeOff: [{ start: h(13), end: h(17) }], booked: [{ appointmentId: "b", client: "Bo", start: h(9), end: h(10) }] }),
      cell("gil", "2026-11-04", [], { draft: split }),
    ];
    expect(personMonth(cells, "gil", "2026-11")).toEqual({ scheduled: h(8) + h(4) + h(8), days: 3, timeOffDays: 1, clients: 2, drafts: 1 });
  });
});
