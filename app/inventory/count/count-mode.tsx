"use client";

import { useState, useTransition } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { CheckCircleIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/page";
import { containerName, formatAmount, productName, stockValueCents, type ProductUnit } from "@/lib/inventory";
import { formatPrice } from "@/lib/services";
import { countedAmount, isPossibleShrinkage, splitAmount, summarize } from "@/lib/stocktake";
import { cancelStocktake, clearCount, finishStocktake, recordCount } from "./actions";

export type CountProduct = { id: string; brand: string; line: string | null; name: string; unit: ProductUnit; size: number; cost_cents: number; shelf: string };
type Saved = { counted: number; expected: number };


// Counting shelf by shelf, made for a tablet: big steppers for full
// containers, the open one in grams or ml, and the difference from what
// was expected as soon as it's saved. Review shows the gaps (big missing
// amounts flagged as possible shrinkage) before anything changes.
export function CountMode({ stocktakeId, products, initial }: { stocktakeId: string; products: CountProduct[]; initial: Record<string, Saved> }) {
  const shelves = [...new Set(products.map((p) => p.shelf))];
  const [shelf, setShelf] = useState(shelves[0]);
  const [saved, setSaved] = useState<Record<string, Saved>>(initial);
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [finishing, startFinish] = useTransition();
  const counted = (s: string) => products.filter((p) => p.shelf === s && saved[p.id]).length;
  const total = (s: string) => products.filter((p) => p.shelf === s).length;
  const doneCount = Object.keys(saved).length;

  if (reviewing) {
    const rows = products.filter((p) => saved[p.id]).map((p) => ({ product: p, ...saved[p.id] }));
    const summary = summarize(rows);
    const changed = rows.filter((r) => r.counted !== r.expected);
    return (
      <section aria-label="Review stocktake" className="flex animate-fade-in flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Counted", `${summary.counted} of ${products.length}`],
            ["Different", String(summary.changed)],
            ["Found", formatPrice(summary.gainCents)],
            ["Missing", formatPrice(summary.lossCents)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-line bg-surface p-4">
              <p className="text-sm text-ink-muted">{label}</p>
              <p className="text-2xl font-semibold text-ink">{value}</p>
            </div>
          ))}
        </div>
        {summary.flagged > 0 && (
          <p role="note" className="rounded-lg border border-status-no-show-ink/25 bg-status-no-show-bg px-4 py-3 text-sm text-status-no-show-ink">
            <strong>{summary.flagged === 1 ? "1 product is" : `${summary.flagged} products are`} well short of what the records say.</strong> That could be
            shrinkage (theft, waste, or use that wasn&apos;t recorded). Worth a recount before you finish.
          </p>
        )}
        <ul aria-label="Differences" className="divide-y divide-line rounded-lg border border-line bg-surface">
          {changed.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-muted">Everything counted matches. Nice.</li>}
          {changed.map((r) => {
            const diff = r.counted - r.expected;
            const flagged = isPossibleShrinkage(r.expected, r.counted, r.product);
            return (
              <li key={r.product.id} data-shrinkage={flagged || undefined} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <span className="min-w-52 flex-1 font-medium text-ink">
                  {productName(r.product)}
                  {flagged && (
                    <Badge tone="red" className="ml-2">
                      Possible shrinkage
                    </Badge>
                  )}
                </span>
                <span className="text-sm text-ink-muted tabular-nums">
                  {formatAmount(r.expected, r.product.unit)} expected → {formatAmount(r.counted, r.product.unit)}
                </span>
                <span className={`w-28 text-right font-semibold tabular-nums ${diff < 0 ? "text-danger" : "text-success"}`}>
                  {diff > 0 ? "+" : "−"}
                  {formatAmount(Math.abs(diff), r.product.unit)}
                </span>
                <span className="w-20 text-right text-sm text-ink-muted tabular-nums">{formatPrice(stockValueCents(Math.abs(diff), r.product))}</span>
              </li>
            );
          })}
        </ul>
        {message && (
          <p role="alert" className="text-danger">
            {message}
          </p>
        )}
        <p className="text-sm text-ink-muted">Finishing updates stock for what you counted. Anything not counted stays as it is.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="lg"
            disabled={finishing}
            onClick={() =>
              startFinish(async () => {
                const r = await finishStocktake(stocktakeId);
                setMessage(r.message);
              })
            }
          >
            {finishing ? "Updating stock…" : "Finish and update stock"}
          </Button>
          <Button size="lg" onClick={() => setReviewing(false)} disabled={finishing}>
            Keep counting
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Shelves" className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto bg-canvas/95 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8">
        {shelves.map((s) => (
          <button
            key={s}
            type="button"
            aria-current={s === shelf ? "true" : undefined}
            onClick={() => setShelf(s)}
            className={`flex h-11 shrink-0 items-center gap-2 rounded-md border px-4 text-sm font-medium transition-[background-color,color] duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
              s === shelf ? "border-navy-900 bg-navy-900 text-white" : "border-line-strong bg-surface text-ink hover:bg-sunken"
            }`}
          >
            {s}
            <span className={`text-xs tabular-nums ${s === shelf ? "text-white/80" : "text-ink-muted"}`}>
              {counted(s)}/{total(s)}
            </span>
          </button>
        ))}
      </nav>

      <section aria-label={shelf} className="grid gap-3 md:grid-cols-2">
        {products
          .filter((p) => p.shelf === shelf)
          .map((p) => (
            <CountCard
              key={p.id}
              product={p}
              stocktakeId={stocktakeId}
              saved={saved[p.id] ?? null}
              onSaved={(s) => setSaved((all) => (s ? { ...all, [p.id]: s } : Object.fromEntries(Object.entries(all).filter(([id]) => id !== p.id))))}
            />
          ))}
      </section>

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-surface/95 px-4 py-3 shadow-lift backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-ink-muted" data-testid="count-progress">
            {doneCount} of {products.length} counted
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm("Cancel this stocktake? Counts so far are thrown away and stock isn't changed.")) startFinish(async () => void (await cancelStocktake(stocktakeId)));
              }}
            >
              Cancel stocktake
            </Button>
            <Button variant="primary" size="lg" disabled={doneCount === 0} onClick={() => setReviewing(true)}>
              Review and finish
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CountCard({ product, stocktakeId, saved, onSaved }: { product: CountProduct; stocktakeId: string; saved: Saved | null; onSaved: (s: Saved | null) => void }) {
  const start = saved ? splitAmount(saved.counted, product) : null;
  const [full, setFull] = useState(start ? String(start.full) : "");
  const [open, setOpen] = useState(start && start.open ? String(start.open) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startSave] = useTransition();
  const byWeight = product.unit !== "unit";
  const amount = countedAmount(full, open, product);
  const dirty = amount !== null && amount !== saved?.counted;
  const word = containerName(product, true);
  const step = (by: number) => setFull(String(Math.max(0, (Number(full) || 0) + by)));
  const diff = saved ? saved.counted - saved.expected : 0;
  const flagged = saved ? isPossibleShrinkage(saved.expected, saved.counted, product) : false;

  return (
    <form
      aria-label={productName(product)}
      data-counted={saved ? true : undefined}
      className={`flex flex-col gap-3 rounded-lg border bg-surface p-4 transition-[border-color] duration-(--motion-fast) ${saved && !dirty ? "border-line-strong" : "border-line"}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (amount === null) return setError(byWeight ? "Enter full containers and what's in the open one." : "Enter how many.");
        setError(null);
        startSave(async () => {
          const r = await recordCount(stocktakeId, product.id, amount);
          if (r.ok) onSaved({ counted: amount, expected: r.expected });
          else setError(r.message);
        });
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{productName(product)}</p>
          <p className="text-xs text-ink-muted">{byWeight ? `${formatAmount(product.size, product.unit)} ${containerName(product)}` : "Units"}</p>
        </div>
        {saved && !dirty && <CheckCircleIcon className="size-6 text-success" />}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">{byWeight ? `Full ${word}` : "On the shelf"}</span>
          <div className="flex items-center gap-1.5">
            <IconButton label={`One fewer ${productName(product)}`} size="lg" variant="secondary" onClick={() => step(-1)}>
              <span aria-hidden className="text-xl leading-none">−</span>
            </IconButton>
            <input
              aria-label={byWeight ? `Full ${word}` : "Units"}
              inputMode="numeric"
              value={full}
              onChange={(e) => setFull(e.target.value)}
              placeholder="0"
              className={`${fieldClass} h-11 w-16! text-center text-base tabular-nums`}
            />
            <IconButton label={`One more ${productName(product)}`} size="lg" variant="secondary" onClick={() => step(1)}>
              <span aria-hidden className="text-xl leading-none">+</span>
            </IconButton>
          </div>
        </div>
        {byWeight && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Open one ({product.unit})</span>
            <input aria-label={`Open (${product.unit})`} inputMode="decimal" value={open} onChange={(e) => setOpen(e.target.value)} placeholder="0" className={`${fieldClass} h-11 w-24! text-center text-base tabular-nums`} />
          </label>
        )}
        <Button type="submit" size="lg" variant={dirty || !saved ? "primary" : "secondary"} disabled={pending || (!dirty && saved !== null)} className="ml-auto">
          {pending ? "Saving…" : saved && !dirty ? "Counted" : "Save count"}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {saved && !dirty && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted" data-testid="count-result">
          <span>
            Expected {formatAmount(saved.expected, product.unit)} · counted {formatAmount(saved.counted, product.unit)}
          </span>
          <span className={`font-semibold ${diff < 0 ? "text-danger" : diff > 0 ? "text-success" : "text-ink"}`}>
            {diff === 0 ? "Matches" : `${diff > 0 ? "+" : "−"}${formatAmount(Math.abs(diff), product.unit)}`}
          </span>
          {flagged && <Badge tone="red">Possible shrinkage</Badge>}
          <button
            type="button"
            className="ml-auto text-xs font-medium text-link underline underline-offset-2"
            onClick={() =>
              startSave(async () => {
                await clearCount(stocktakeId, product.id);
                setFull("");
                setOpen("");
                onSaved(null);
              })
            }
          >
            Clear
          </button>
        </p>
      )}
    </form>
  );
}
