import { describe, expect, it } from "vitest";
import { mergeOrder, moveItem, nameVariants, offColumns, offLabel, offReason, viewColumns, viewKey, viewProblems, type CalendarView } from "@/lib/calendar-views";
import { sortForCalendar } from "@/lib/staff";

const col = (staffId: string, working = true, family = "cut") => ({ staffId, working, family });
const inFamily = (c: { family: string }, f: string) => c.family === f;

describe("which stylists the calendar shows", () => {
  const columns = [col("a"), col("b", true, "color"), col("c", false), col("d", true, "color")];
  const views: CalendarView[] = [{ id: "v1", name: "Color", staffIds: ["d", "gone", "b"], shared: true, editable: false }];

  it("shows everyone, a department, or a saved view in its own order (skipping anyone gone)", () => {
    expect(viewColumns(columns, "all", views, inFamily).map((c) => c.staffId)).toEqual(["a", "b", "c", "d"]);
    expect(viewColumns(columns, "color", views, inFamily).map((c) => c.staffId)).toEqual(["b", "d"]);
    expect(viewColumns(columns, viewKey("v1"), views, inFamily).map((c) => c.staffId)).toEqual(["d", "b"]);
    // A view that's been deleted: everyone.
    expect(viewColumns(columns, viewKey("v2"), views, inFamily)).toHaveLength(4);
  });

  it("hides who's off, unless they have a booking", () => {
    expect(offColumns(columns, new Set()).map((c) => c.staffId)).toEqual(["c"]);
    expect(offColumns(columns, new Set(["c"]))).toEqual([]);
  });

  it("says how many are off, and why", () => {
    expect(offLabel(10, true)).toBe("10 off today");
    expect(offLabel(1, false)).toBe("1 off");
    expect(offReason({ timeOff: "Vacation · Lisbon", salonOpen: true, hasHours: true })).toBe("Vacation · Lisbon");
    expect(offReason({ timeOff: "Sick", salonOpen: false, hasHours: false })).toBe("Sick");
    expect(offReason({ timeOff: null, salonOpen: false, hasHours: true })).toBe("Salon closed");
    expect(offReason({ timeOff: null, salonOpen: true, hasHours: false })).toBe("Day off");
    expect(offReason({ timeOff: null, salonOpen: true, hasHours: true })).toBe("Not working");
  });
});

describe("ordering", () => {
  it("moves one item", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b"], 1, 9)).toEqual(["a", "b"]);
  });

  it("reorders the people shown in their places, leaving the rest", () => {
    // Shown: b and d (a department); c is hidden (off).
    expect(mergeOrder(["a", "b", "c", "d", "e"], ["b", "d"], ["d", "b"])).toEqual(["a", "d", "c", "b", "e"]);
  });

  it("puts the salon's order first, then anyone not placed in the usual order", () => {
    const s = (first: string, calendar_position: number | null) => ({ first_name: first, last_name: "", role: "stylist" as const, is_active: true, calendar_position });
    expect(sortForCalendar([s("Zed", null), s("Amy", 2), s("Bo", 1), s("Al", null)]).map((x) => x.first_name)).toEqual(["Bo", "Amy", "Al", "Zed"]);
  });
});

describe("saved views", () => {
  it("need a name of their own and someone in them", () => {
    expect(viewProblems("  ", ["a"], [])).toEqual({ name: "Give the view a name." });
    expect(viewProblems("color", ["a"], ["Color"])).toEqual({ name: "There's already a view called color." });
    expect(viewProblems("x".repeat(41), ["a"], []).name).toMatch(/40 characters/);
    expect(viewProblems("Hair team", [], [])).toEqual({ staff: "Choose at least one stylist." });
    expect(viewProblems("Hair team", ["a"], ["Color"])).toEqual({});
  });
});

describe("names in narrow columns", () => {
  it("shorten, and only go to initials when Fit all squeezes them", () => {
    expect(nameVariants("Bridget Callahan", "Bridget", false)).toEqual(["Bridget Callahan", "Bridget C.", "Bridget"]);
    expect(nameVariants("Bridget Callahan", "Bridget", true).at(-1)).toBe("BC");
    expect(nameVariants("Cher", "Cher", true)).toEqual(["Cher", "C"]);
  });
});
