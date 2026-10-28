import { describe, expect, it } from "vitest";
import { chairFor, doubledUp, parseStation, stationDay } from "@/lib/stations";

const form = (entries: Record<string, string>) => ({ get: (k: string) => entries[k] ?? null });
const names = new Map([["sandra", "Sandra"], ["shae", "Shae"]]);

describe("the Stations form", () => {
  it("takes a name, a kind, where it is and whose home it is", () => {
    expect(parseStation(form({ name: " Chair 8 ", kind: "chair", area: "Upstairs", home_staff_id: "shae", is_active: "on" }))).toEqual({
      ok: true,
      station: { name: "Chair 8", kind: "chair", area: "Upstairs", isActive: true, homeStaffId: "shae" },
    });
    // Only chairs and other stations are someone's home.
    expect(parseStation(form({ name: "Room 2", kind: "room", home_staff_id: "shae" }))).toMatchObject({ ok: true, station: { homeStaffId: null, isActive: false, area: null } });
    expect(parseStation(form({ name: "", kind: "sofa" }))).toEqual({ ok: false, errors: { name: "Give it a name, like Chair 4.", kind: "Choose what it is." } });
  });
});

describe("a station's day", () => {
  const working = new Map([["sandra", [{ start: 540, end: 1020 }]], ["shae", []]]);

  it("is its stylist while they work, then anyone it's lent to", () => {
    const lent = [{ id: "a1", resourceId: "chair-4", staffId: "shae", start: 1020, end: 1200 }];
    expect(stationDay({ id: "chair-4", homeStaffId: "sandra" }, working, lent, names)).toEqual([
      { staffId: "sandra", name: "Sandra", start: 540, end: 1020, lent: false },
      { staffId: "shae", name: "Shae", start: 1020, end: 1200, lent: true, assignmentId: "a1" },
    ]);
    expect(stationDay({ id: "chair-6", homeStaffId: null }, working, lent, names)).toEqual([]);
  });

  it("flags two people on it at once", () => {
    const lent = [{ id: "a1", resourceId: "chair-4", staffId: "shae", start: 900, end: 1200 }];
    const uses = stationDay({ id: "chair-4", homeStaffId: "sandra" }, working, lent, names);
    expect(doubledUp(uses).map(([a, b]) => [a.name, b.name])).toEqual([["Sandra", "Shae"]]);
  });

  it("gives each person their chair for the day", () => {
    const home = new Map([["sandra", "chair-4"], ["shae", "chair-5"]]);
    const lent = [{ resourceId: "chair-4", staffId: "shae", date: "2026-10-31" }];
    expect(chairFor("shae", "2026-10-31", home, lent)).toEqual({ resourceId: "chair-4", lent: true });
    expect(chairFor("sandra", "2026-10-31", home, lent)).toBeNull();
    expect(chairFor("sandra", "2026-11-03", home, lent)).toEqual({ resourceId: "chair-4", lent: false });
    expect(chairFor("gil", "2026-11-03", home, lent)).toBeNull();
  });
});
