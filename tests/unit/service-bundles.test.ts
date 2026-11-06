// Service bundles: the rules a bundle keeps (the same as
// save_service_bundle), its parts laid out with their gaps, and moving one
// part moving the rest of its bundle.
import { describe, expect, it } from "vitest";
import { bundleLines, bundleMinutes, bundleProblem, moveWithBundle } from "@/lib/scheduling/bundles";

const onMenu = (id: string) => id !== "gone";
const part = (serviceId: string, gapMinutes = 0) => ({ serviceId, gapMinutes });

describe("bundleProblem", () => {
  it("needs a name, 2 to 6 services on the menu, and gaps in fives up to 4 hours", () => {
    expect(bundleProblem("Color and cut", [part("a"), part("b", 30)], onMenu)).toBeNull();
    expect(bundleProblem(" ", [part("a"), part("b")], onMenu)).toBe("name");
    expect(bundleProblem("One", [part("a")], onMenu)).toBe("parts");
    expect(bundleProblem("Seven", Array.from({ length: 7 }, () => part("a")), onMenu)).toBe("parts");
    expect(bundleProblem("Odd gap", [part("a"), part("b", 7)], onMenu)).toBe("gap");
    expect(bundleProblem("Long gap", [part("a"), part("b", 245)], onMenu)).toBe("gap");
    expect(bundleProblem("Gone", [part("a"), part("gone")], onMenu)).toBe("service");
  });
});

describe("bundleLines and bundleMinutes", () => {
  const minutes: Record<string, number> = { highlight: 90, gloss: 30, cut: 45 };
  const bundle = { id: "b1", parts: [part("highlight"), part("gloss", 20), part("cut", 15)] };

  it("starts each part when the one before ends, plus its gap", () => {
    const lines = bundleLines(bundle, 9 * 60, () => "gil", (_, s) => minutes[s]);
    expect(lines.map((l) => l.startMinute)).toEqual([540, 650, 695]);
    expect(lines.every((l) => l.bundleId === "b1" && l.staffId === "gil")).toBe(true);
  });

  it("uses each stylist's own length", () => {
    const lines = bundleLines(bundle, 540, (n) => (n === 1 ? "ari" : "gil"), (staff, s) => minutes[s] + (staff === "ari" ? 10 : 0));
    expect(lines.map((l) => [l.staffId, l.startMinute])).toEqual([["gil", 540], ["ari", 650], ["gil", 705]]);
  });

  it("counts the gaps in the length", () => {
    expect(bundleMinutes(bundle.parts, (s) => minutes[s])).toBe(90 + 20 + 30 + 15 + 45);
  });
});

describe("moveWithBundle", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2031, 6, 15, h, m));
  const items = [
    { id: "1", staffId: "gil", start: at(9), bundleId: "b1" },
    { id: "2", staffId: "ari", start: at(10, 50), bundleId: "b1" },
    { id: "3", staffId: "gil", start: at(11, 35), bundleId: "b1" },
    { id: "4", staffId: "gil", start: at(13), bundleId: null },
  ];

  it("moves the rest of the bundle by the same time, and its stylist's parts to the new stylist", () => {
    const moved = moveWithBundle(items, { itemId: "1", staffId: "lois", start: at(9, 30) });
    expect(moved.map((m) => [m.item.id, m.staffId, m.start.toISOString().slice(11, 16), m.moved])).toEqual([
      ["1", "lois", "09:30", true],
      ["2", "ari", "11:20", true],
      ["3", "lois", "12:05", true],
      ["4", "gil", "13:00", false],
    ]);
  });

  it("leaves the others alone for a service outside a bundle", () => {
    const moved = moveWithBundle(items, { itemId: "4", staffId: "gil", start: at(14) });
    expect(moved.filter((m) => m.moved).map((m) => m.item.id)).toEqual(["4"]);
  });
});
