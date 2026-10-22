"use client";

import { IconButton } from "@/components/ui/button";
import { fieldClass, selectClass } from "@/components/ui/field";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { MAX_LINES } from "@/lib/color-usage";
import type { PickerProduct } from "@/lib/inventory-load";

// One product and amount; the amount is text while it's being typed.
export type DraftLine = { productId: string; amount: string };

export function toUsageJson(lines: DraftLine[]): string {
  return JSON.stringify(lines.filter((l) => l.productId || l.amount).map((l) => ({ productId: l.productId, amount: Number(l.amount) })));
}

// Products and amounts used in a service: 30 g Topchic 7N + 30 ml 20 vol.
// Products are grouped by brand and line; each amount is in that product's
// unit. `name` adds a hidden field with the lines as JSON, for forms.
export function UsageLinesEditor({
  products,
  lines,
  onChange,
  name,
  label = "Products used",
}: {
  products: PickerProduct[];
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  name?: string;
  label?: string;
}) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const groups = new Map<string, PickerProduct[]>();
  for (const p of products) {
    const key = [p.brand, p.line].filter(Boolean).join(" ");
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const update = (i: number, change: Partial<DraftLine>) => onChange(lines.map((l, n) => (n === i ? { ...l, ...change } : l)));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium text-ink">{label}</legend>
      {name && <input type="hidden" name={name} value={toUsageJson(lines)} />}
      {lines.map((line, i) => {
        const unit = byId.get(line.productId)?.unit;
        return (
          <div key={i} role="group" aria-label={`Product ${i + 1}`} className="flex animate-fade-in items-center gap-2">
            <label className="sr-only" htmlFor={`${name ?? "usage"}-product-${i}`}>
              Product
            </label>
            <select id={`${name ?? "usage"}-product-${i}`} value={line.productId} onChange={(e) => update(i, { productId: e.target.value })} className={`${selectClass} min-w-0 flex-1`}>
              <option value="">Choose a product</option>
              {[...groups].map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {[p.line ?? p.brand, p.name].join(" ")} ({p.unit})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label className="sr-only" htmlFor={`${name ?? "usage"}-amount-${i}`}>
              Amount
            </label>
            <span className="relative w-28 shrink-0">
              <input
                id={`${name ?? "usage"}-amount-${i}`}
                inputMode="decimal"
                value={line.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
                placeholder="30"
                className={`${fieldClass} pr-9 text-right tabular-nums`}
              />
              <span aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-ink-muted">
                {unit === "unit" ? "×" : (unit ?? "")}
              </span>
            </span>
            <IconButton label={`Remove product ${i + 1}`} size="sm" onClick={() => onChange(lines.filter((_, n) => n !== i))}>
              <CloseIcon className="size-4" />
            </IconButton>
          </div>
        );
      })}
      {lines.length < MAX_LINES && (
        <button
          type="button"
          onClick={() => onChange([...lines, { productId: "", amount: "" }])}
          className="inline-flex items-center gap-1.5 self-start rounded-md text-sm font-medium text-navy-900 hover:text-navy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <PlusIcon className="size-4" />
          Add a product
        </button>
      )}
    </fieldset>
  );
}
