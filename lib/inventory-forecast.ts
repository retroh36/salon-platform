// When stock will run out, from the products upcoming appointments will use,
// and the orders that would prevent it. Pure: the data comes from
// lib/denise/reorder.ts.
//
// Each upcoming service is expected to use what its client's formula says
// (or the service's recipe). Walking the appointments in time order from
// what's on hand (plus anything already ordered), a product runs out at the
// first appointment that needs more than is left. A supplier gets a draft
// order when any of its products will run out in the window, drop below
// its reorder point, or is below it already. Each line orders enough
// containers to cover the window and get back above the reorder point, and
// at least the product's usual reorder quantity.

export type PlannedUse = {
  appointmentId: string;
  at: Date;
  productId: string;
  amount: number;
  // A color service (for "4 color appointments need it").
  color: boolean;
};

export type StockInfo = {
  productId: string;
  supplierId: string | null;
  onHand: number;
  // Already ordered and not yet received, in the product's unit.
  onOrder: number;
  reorderPoint: number;
  reorderQuantity: number;
  size: number;
  costCents: number;
};

export type Outlook = {
  productId: string;
  // Used by appointments in the window.
  needed: number;
  // The first appointment that can't be covered.
  runsOutAt: Date | null;
  // Appointments in the window that use it.
  appointments: number;
  colorAppointments: number;
  // Below the reorder point now, or by the end of the window.
  lowNow: boolean;
  lowLater: boolean;
};

export function outlook(stock: readonly StockInfo[], uses: readonly PlannedUse[]): Map<string, Outlook> {
  const byProduct = new Map<string, PlannedUse[]>();
  for (const u of uses) byProduct.set(u.productId, [...(byProduct.get(u.productId) ?? []), u]);

  const result = new Map<string, Outlook>();
  for (const s of stock) {
    const planned = (byProduct.get(s.productId) ?? []).sort((a, b) => a.at.getTime() - b.at.getTime());
    let left = s.onHand + s.onOrder;
    let runsOutAt: Date | null = null;
    for (const u of planned) {
      left -= u.amount;
      if (left < -0.005 && !runsOutAt) runsOutAt = u.at;
    }
    const visits = new Set(planned.map((u) => u.appointmentId));
    const colorVisits = new Set(planned.filter((u) => u.color).map((u) => u.appointmentId));
    const needed = planned.reduce((sum, u) => sum + u.amount, 0);
    result.set(s.productId, {
      productId: s.productId,
      needed: Math.round(needed * 100) / 100,
      runsOutAt,
      appointments: visits.size,
      colorAppointments: colorVisits.size,
      lowNow: s.reorderPoint > 0 && s.onHand + s.onOrder < s.reorderPoint,
      lowLater: s.reorderPoint > 0 && s.onHand + s.onOrder - needed < s.reorderPoint,
    });
  }
  return result;
}

export type ReorderLine = {
  productId: string;
  // Containers.
  quantity: number;
  unitCostCents: number;
  outlook: Outlook;
};

export type ReorderDraft = {
  supplierId: string;
  lines: ReorderLine[];
  totalCents: number;
  // The line that runs out soonest, if any does.
  mostUrgent: ReorderLine | null;
};

// How many containers cover the window and get back above the reorder
// point: at least the usual reorder quantity.
export function containersToOrder(s: StockInfo, o: Outlook): number {
  const short = o.needed + s.reorderPoint - (s.onHand + s.onOrder);
  return Math.max(s.reorderQuantity, Math.ceil(Math.max(short, 0) / s.size - 1e-9), 1);
}

export function draftReorders(stock: readonly StockInfo[], outlooks: ReadonlyMap<string, Outlook>): ReorderDraft[] {
  const bySupplier = new Map<string, ReorderLine[]>();
  for (const s of stock) {
    const o = outlooks.get(s.productId);
    if (!o || !s.supplierId || !(o.runsOutAt || o.lowNow || o.lowLater)) continue;
    const line = { productId: s.productId, quantity: containersToOrder(s, o), unitCostCents: s.costCents, outlook: o };
    bySupplier.set(s.supplierId, [...(bySupplier.get(s.supplierId) ?? []), line]);
  }
  const urgency = (l: ReorderLine) => l.outlook.runsOutAt?.getTime() ?? Infinity;
  return [...bySupplier]
    .map(([supplierId, lines]) => {
      const sorted = [...lines].sort((a, b) => urgency(a) - urgency(b) || b.outlook.appointments - a.outlook.appointments);
      return {
        supplierId,
        lines: sorted,
        totalCents: sorted.reduce((sum, l) => sum + l.quantity * l.unitCostCents, 0),
        mostUrgent: sorted[0].outlook.runsOutAt ? sorted[0] : null,
      };
    })
    .sort((a, b) => (a.mostUrgent ? urgency(a.mostUrgent) : Infinity) - (b.mostUrgent ? urgency(b.mostUrgent) : Infinity));
}
