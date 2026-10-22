// The products a service uses: a formula's lines (30 g Topchic 7N + 30 ml
// 20 vol developer) or a service's default recipe. Amounts are in each
// product's unit (grams or ml). Pure, shared by the forms and the server.

import { formatAmount, productName, type ProductUnit } from "./inventory";

export type UsageLine = { productId: string; amount: number };

export type UsageProduct = { id: string; brand: string; line: string | null; name: string; unit: ProductUnit };

export const MAX_LINES = 20;

// Lines from a form's JSON field: known back-bar products, positive amounts.
export function parseUsageLines(
  raw: unknown,
  products: ReadonlyMap<string, UsageProduct>,
): { ok: true; lines: UsageLine[] } | { ok: false; error: string } {
  let value = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return { ok: true, lines: [] };
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Those products didn't come through. Try again." };
    }
  }
  if (!Array.isArray(value)) return { ok: false, error: "Those products didn't come through. Try again." };
  if (value.length > MAX_LINES) return { ok: false, error: `Up to ${MAX_LINES} products.` };
  const lines: UsageLine[] = [];
  for (const item of value) {
    const productId = typeof item?.productId === "string" ? item.productId : "";
    const amount = typeof item?.amount === "number" ? item.amount : Number(item?.amount);
    if (!products.has(productId)) return { ok: false, error: "Choose a product for each line." };
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000 || Math.round(amount * 100) !== amount * 100) {
      return { ok: false, error: "Enter an amount for each product, e.g. 30." };
    }
    lines.push({ productId, amount });
  }
  return { ok: true, lines };
}

// "30 g Goldwell Topchic 7N + 30 ml Goldwell Topchic 20 Vol Developer (6%)"
export function describeUsage(lines: readonly UsageLine[], products: ReadonlyMap<string, UsageProduct>): string {
  return lines
    .map((l) => {
      const p = products.get(l.productId);
      return p ? `${formatAmount(l.amount, p.unit)} ${productName(p)}` : null;
    })
    .filter(Boolean)
    .join(" + ");
}
