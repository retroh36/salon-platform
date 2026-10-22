import { describe, expect, it } from "vitest";
import { dayWord, headlineFor, plannedUses } from "@/lib/denise/reorder";
import { containersToOrder, draftReorders, outlook, type PlannedUse, type StockInfo } from "@/lib/inventory-forecast";
import type { StockRow } from "@/lib/inventory-load";
import { parseOrderLines, parseReceipt } from "@/lib/purchase-orders";
import { fromLocal } from "@/lib/scheduling";

const TZ = "America/Chicago";
// Wednesday, Oct 21, 2026, 9am.
const NOW = fromLocal("2026-10-21", 9 * 60, TZ)!;
const on = (date: string, hour = 10) => fromLocal(date, hour * 60, TZ)!;

const stock = (o: Partial<StockInfo> & { productId: string }): StockInfo => ({
  supplierId: "north",
  onHand: 0,
  onOrder: 0,
  reorderPoint: 0,
  reorderQuantity: 1,
  size: 60,
  costCents: 950,
  ...o,
});
const use = (appointmentId: string, productId: string, amount: number, at: Date, color = true): PlannedUse => ({ appointmentId, productId, amount, at, color });

describe("the outlook for a product", () => {
  it("runs out at the first appointment that needs more than is left", () => {
    const o = outlook(
      [stock({ productId: "7n", onHand: 80 })],
      [use("a", "7n", 30, on("2026-10-22")), use("b", "7n", 30, on("2026-10-23")), use("c", "7n", 30, on("2026-10-23", 14)), use("d", "7n", 30, on("2026-10-27"))],
    ).get("7n")!;
    expect(o).toMatchObject({ needed: 120, appointments: 4, colorAppointments: 4 });
    expect(o.runsOutAt).toEqual(on("2026-10-23", 14));
  });

  it("counts stock already ordered, and appointments once each", () => {
    const o = outlook([stock({ productId: "7n", onHand: 20, onOrder: 120 })], [use("a", "7n", 30, on("2026-10-22")), use("a", "7n", 15, on("2026-10-22", 11))]).get("7n")!;
    expect(o.runsOutAt).toBeNull();
    expect(o.appointments).toBe(1);
  });

  it("notices stock below the reorder point now or by the end of the window", () => {
    const [now, later, fine] = [
      stock({ productId: "a", onHand: 50, reorderPoint: 60 }),
      stock({ productId: "b", onHand: 100, reorderPoint: 60 }),
      stock({ productId: "c", onHand: 200, reorderPoint: 60 }),
    ];
    const o = outlook([now, later, fine], [use("x", "b", 50, on("2026-10-22")), use("x", "c", 50, on("2026-10-22"))]);
    expect([o.get("a")!.lowNow, o.get("b")!.lowNow, o.get("b")!.lowLater, o.get("c")!.lowLater]).toEqual([true, false, true, false]);
  });
});

describe("draft orders", () => {
  it("orders enough containers to cover the window and the reorder point, at least the usual amount", () => {
    const s = stock({ productId: "7n", onHand: 80, reorderPoint: 120, reorderQuantity: 2 });
    const o = outlook([s], [use("a", "7n", 120, on("2026-10-22"))]).get("7n")!;
    // Short by 120 + 120 - 80 = 160 g: 3 tubes of 60.
    expect(containersToOrder(s, o)).toBe(3);
    expect(containersToOrder({ ...s, reorderQuantity: 6 }, o)).toBe(6);
    expect(containersToOrder({ ...s, onHand: 1000 }, o)).toBe(2);
  });

  it("groups lines by supplier, most urgent first, leaving out healthy stock and products without a supplier", () => {
    const products = [
      stock({ productId: "7n", onHand: 60 }),
      stock({ productId: "6n", onHand: 200 }),
      stock({ productId: "dev", onHand: 100, size: 1000, costCents: 1400 }),
      stock({ productId: "shampoo", supplierId: "prairie", onHand: 2, reorderPoint: 4, size: 1, costCents: 1500, reorderQuantity: 12 }),
      stock({ productId: "loose", supplierId: null, onHand: 0, reorderPoint: 10 }),
    ];
    const uses = [use("a", "7n", 40, on("2026-10-23")), use("b", "7n", 40, on("2026-10-24")), use("a", "6n", 40, on("2026-10-23")), use("a", "dev", 80, on("2026-10-23")), use("b", "dev", 80, on("2026-10-22"))];
    const drafts = draftReorders(products, outlook(products, uses));
    expect(drafts.map((d) => [d.supplierId, d.lines.map((l) => `${l.productId}×${l.quantity}`)])).toEqual([
      ["north", ["dev×1", "7n×1"]],
      ["prairie", ["shampoo×12"]],
    ]);
    expect(drafts[0].mostUrgent!.productId).toBe("dev");
    expect(drafts[0].totalCents).toBe(1400 + 950);
    expect(drafts[1].mostUrgent).toBeNull();
  });
});

describe("what upcoming services will use", () => {
  const upcoming = (id: string, serviceId: string, clientId: string | null, serviceColor = true) => ({ id, appointmentId: `appt-${id}`, at: on("2026-10-23"), serviceId, serviceColor, clientId });
  const formula = (clientId: string, itemId: string | null, serviceId: string | null, createdAt: string, productId: string, amount: number) => ({ clientId, itemId, serviceId, createdAt, lines: [{ productId, amount }] });
  const recipes = new Map([
    ["color", [{ productId: "6n", amount: 60 }]],
    ["cut", [{ productId: "shampoo", amount: 15 }]],
  ]);

  it("prefers the visit's formula, then the client's last for that service, then (for color) their last formula, then the recipe", () => {
    const formulas = [
      formula("grace", "i1", "color", "2026-10-20", "7n", 30),
      formula("grace", null, "color", "2026-09-01", "8n", 30),
      formula("ada", null, "color", "2026-09-10", "9n", 30),
      formula("mia", null, null, "2026-08-01", "5n", 40),
    ];
    const uses = plannedUses([upcoming("i1", "color", "grace"), upcoming("i2", "color", "ada"), upcoming("i3", "color", "mia"), upcoming("i4", "color", "zoe"), upcoming("i5", "cut", "mia", false), upcoming("i6", "color", null)], formulas, recipes);
    expect(uses.map((u) => `${u.appointmentId}:${u.productId}:${u.amount}`)).toEqual([
      "appt-i1:7n:30",
      "appt-i2:9n:30",
      "appt-i3:5n:40",
      "appt-i4:6n:60",
      "appt-i5:shampoo:15",
      "appt-i6:6n:60",
    ]);
  });
});

describe("Denise's words", () => {
  it("says when, as a day", () => {
    expect(dayWord(on("2026-10-21", 15), NOW, TZ)).toBe("the end of today");
    expect(dayWord(on("2026-10-22"), NOW, TZ)).toBe("tomorrow");
    expect(dayWord(on("2026-10-23"), NOW, TZ)).toBe("Friday");
    expect(dayWord(on("2026-11-03"), NOW, TZ)).toBe("Tue, Nov 3");
  });

  it("leads with what runs out first and how many appointments need it", () => {
    const row = { brand: "Goldwell", line: "Topchic", name: "7N" } as StockRow;
    const products = [stock({ productId: "7n", onHand: 60 })];
    const uses = ["a", "b", "c", "d"].map((id, i) => use(id, "7n", 30, on("2026-10-23", 10 + i)));
    const [draft] = draftReorders(products, outlook(products, uses));
    expect(headlineFor(draft, new Map([["7n", row]]), NOW, TZ)).toBe("You'll run out of Goldwell Topchic 7N before Friday — 4 color appointments need it.");
  });
});

describe("order forms", () => {
  it("reads draft lines", () => {
    const known = new Set(["a", "b"]);
    expect(parseOrderLines(JSON.stringify([{ productId: "a", quantity: 6, unitCostCents: 950 }]), known)).toEqual({ ok: true, lines: [{ productId: "a", quantity: 6, unitCostCents: 950 }] });
    expect(parseOrderLines(JSON.stringify([{ productId: "a", quantity: 1, unitCostCents: 1 }, { productId: "a", quantity: 1, unitCostCents: 1 }]), known)).toEqual({ ok: false, error: "Each product goes on the order once." });
    expect(parseOrderLines(JSON.stringify([{ productId: "a", quantity: 1.5, unitCostCents: 1 }]), known).ok).toBe(false);
    expect(parseOrderLines(JSON.stringify([{ productId: "z", quantity: 1, unitCostCents: 1 }]), known).ok).toBe(false);
  });

  it("reads a delivery within what's due", () => {
    const due = new Map([["l1", 6], ["l2", 2]]);
    expect(parseReceipt({ l1: "4", l2: "" }, due)).toEqual({ ok: true, lines: [{ lineId: "l1", quantity: 4 }] });
    expect(parseReceipt({ l1: "7" }, due)).toEqual({ ok: false, error: "That's more than was ordered." });
    expect(parseReceipt({ l1: "0", l2: "0" }, due)).toEqual({ ok: false, error: "Enter what arrived." });
    expect(parseReceipt({ nope: "1" }, due).ok).toBe(false);
  });
});
