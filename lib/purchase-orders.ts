// Purchase orders: statuses, numbers and the forms for writing and
// receiving them. Pure, shared by pages, actions and tests.

import type { Enums } from "@/lib/database.types";
import { isLocalDate } from "@/lib/scheduling/time";

export type OrderStatus = Enums<"purchase_order_status">;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partly_received: "Partly received",
  received: "Received",
};

export const ORDER_STATUS_TONES: Record<OrderStatus, "neutral" | "blue" | "amber" | "green"> = {
  draft: "neutral",
  sent: "blue",
  partly_received: "amber",
  received: "green",
};

export function orderNumber(n: number): string {
  return `PO-${n}`;
}

// Sent (or partly in) and past the day it was expected: today counts as on
// time.
export function isLate(status: OrderStatus, expectedOn: string | null, today: string): boolean {
  return (status === "sent" || status === "partly_received") && expectedOn !== null && expectedOn < today;
}

// The expected date from its field: empty clears it.
export function parseExpected(raw: string): { ok: true; date: string | null } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: true, date: null };
  if (!isLocalDate(value)) return { ok: false, error: "Choose a date." };
  return { ok: true, date: value };
}

export type OrderLineInput = { productId: string; quantity: number; unitCostCents: number };

// Draft lines from the form: products (once each), whole quantities, costs.
export function parseOrderLines(raw: string, known: ReadonlySet<string>): { ok: true; lines: OrderLineInput[] } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw || "[]");
  } catch {
    return { ok: false, error: "The order lines didn't come through. Try again." };
  }
  if (!Array.isArray(value) || value.length > 200) return { ok: false, error: "Up to 200 lines." };
  const lines: OrderLineInput[] = [];
  const seen = new Set<string>();
  for (const l of value) {
    const productId = String(l?.productId ?? "");
    if (!known.has(productId)) return { ok: false, error: "Choose a product for each line." };
    if (seen.has(productId)) return { ok: false, error: "Each product goes on the order once." };
    seen.add(productId);
    const quantity = Number(l?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) return { ok: false, error: "Order a whole number of each, at least 1." };
    const unitCostCents = Number(l?.unitCostCents);
    if (!Number.isInteger(unitCostCents) || unitCostCents < 0) return { ok: false, error: "Enter a cost for each line." };
    lines.push({ productId, quantity, unitCostCents });
  }
  return { ok: true, lines };
}

// What arrived: line -> containers received now, within what's still due.
export function parseReceipt(
  raw: Record<string, string>,
  due: ReadonlyMap<string, number>,
): { ok: true; lines: { lineId: string; quantity: number }[] } | { ok: false; error: string } {
  const lines: { lineId: string; quantity: number }[] = [];
  for (const [lineId, text] of Object.entries(raw)) {
    if (!due.has(lineId)) return { ok: false, error: "That line isn't on this order." };
    const quantity = text.trim() === "" ? 0 : Number(text);
    if (!Number.isInteger(quantity) || quantity < 0) return { ok: false, error: "Enter whole numbers received." };
    if (quantity > due.get(lineId)!) return { ok: false, error: "That's more than was ordered." };
    if (quantity > 0) lines.push({ lineId, quantity });
  }
  if (!lines.length) return { ok: false, error: "Enter what arrived." };
  return { ok: true, lines };
}
