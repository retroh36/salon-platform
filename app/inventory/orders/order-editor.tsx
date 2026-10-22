"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { Alert, Card } from "@/components/ui/page";
import { formatPrice } from "@/lib/services";
import { saveOrder } from "./actions";

export type OrderProduct = { id: string; label: string; supplierId: string | null; costCents: number; container: string };
type Line = { productId: string; quantity: string; cost: string };

const money = (cents: number) => (cents / 100).toFixed(2);

// Write or change a draft order: a supplier and lines of products, how many
// containers, and the cost of each.
export function OrderEditor({
  orderId,
  suppliers,
  products,
  initial,
}: {
  orderId: string | null;
  suppliers: { id: string; name: string }[];
  products: OrderProduct[];
  initial: { supplierId: string; notes: string; lines: { productId: string; quantity: number; unitCostCents: number }[] };
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(initial.supplierId);
  const [notes, setNotes] = useState(initial.notes);
  const [lines, setLines] = useState<Line[]>(initial.lines.map((l) => ({ productId: l.productId, quantity: String(l.quantity), cost: money(l.unitCostCents) })));
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, start] = useTransition();
  const byId = new Map(products.map((p) => [p.id, p]));
  const choices = products.filter((p) => p.supplierId === supplierId);
  const update = (i: number, change: Partial<Line>) => setLines(lines.map((l, n) => (n === i ? { ...l, ...change } : l)));
  const total = lines.reduce((sum, l) => sum + Math.round(Number(l.cost) * 100 || 0) * (Number(l.quantity) || 0), 0);

  return (
    <form
      aria-label={orderId ? "Edit order" : "New order"}
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        start(async () => {
          const r = await saveOrder({
            orderId,
            supplierId,
            notes,
            lines: JSON.stringify(lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCostCents: Math.round(Number(l.cost) * 100) }))),
          });
          if (!r.ok) return setMessage({ text: r.message, error: true });
          if (!orderId && r.orderId) router.push(`/inventory/orders/${r.orderId}`);
          else setMessage({ text: r.message, error: false });
        });
      }}
    >
      <Card title={orderId ? "Draft" : "New order"} titleId="order-heading">
        {message && (
          <Alert tone={message.error ? "error" : "success"} className="mb-4">
            {message.text}
          </Alert>
        )}
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Supplier
            <select
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setLines([]);
              }}
              className={selectClass}
              required
            >
              <option value="">Choose a supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            <span>
              Notes <span className="font-normal text-ink-muted">(optional)</span>
            </span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} className={fieldClass} />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2" disabled={!supplierId}>
          <legend className="mb-1.5 text-sm font-medium text-ink">Products</legend>
          {lines.map((l, i) => {
            const p = byId.get(l.productId);
            return (
              <div key={i} role="group" aria-label={`Line ${i + 1}`} className="flex animate-fade-in flex-wrap items-end gap-2">
                <label className={`${labelClass} min-w-56 flex-1`}>
                  <span className="sr-only">Product</span>
                  <select
                    value={l.productId}
                    onChange={(e) => update(i, { productId: e.target.value, cost: money(byId.get(e.target.value)?.costCents ?? 0) })}
                    className={selectClass}
                    aria-label="Product"
                  >
                    <option value="">Choose a product</option>
                    {choices.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={`${labelClass} w-28`}>
                  <span className="text-xs text-ink-muted">{p ? `${p.container}s` : "Quantity"}</span>
                  <input type="number" min={1} value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} className={fieldClass} aria-label="Quantity" />
                </label>
                <label className={`${labelClass} w-28`}>
                  <span className="text-xs text-ink-muted">Cost each ($)</span>
                  <input inputMode="decimal" value={l.cost} onChange={(e) => update(i, { cost: e.target.value })} className={fieldClass} aria-label="Cost each" />
                </label>
                <IconButton label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, n) => n !== i))}>
                  <CloseIcon className="size-4" />
                </IconButton>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => setLines([...lines, { productId: "", quantity: "1", cost: "" }])}
            className="inline-flex items-center gap-1.5 self-start rounded-md text-sm font-medium text-navy-900 hover:text-navy-700 disabled:text-ink-subtle"
          >
            <PlusIcon className="size-4" />
            Add a product
          </button>
        </fieldset>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-sm text-ink-muted">
            Total <strong className="text-base text-ink tabular-nums" data-testid="order-total">{formatPrice(total)}</strong>
          </span>
          <Button type="submit" variant="primary" disabled={pending || !supplierId}>
            {pending ? "Saving…" : orderId ? "Save draft" : "Create draft"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
