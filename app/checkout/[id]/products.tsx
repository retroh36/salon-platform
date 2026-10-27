"use client";

import { useMemo, useRef, useState } from "react";
import { selectClass } from "@/components/ui/field";
import { SearchIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/page";
import type { CheckoutScreenData } from "@/lib/checkout-screen";
import { formatPrice } from "@/lib/services";

type Product = CheckoutScreenData["products"][number];

// A stand-in for a product photo: the brand's initials on a soft tile
// tinted from its name.
function ProductThumb({ product, size = "md" }: { product: Product; size?: "md" | "lg" }) {
  const initials = product.brand
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const hue = [...product.brand].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-md font-semibold text-ink ${size === "lg" ? "size-14 text-base" : "size-11 text-sm"}`}
      style={{ background: `hsl(${hue} 45% 90%)` }}
    >
      {initials || "•"}
    </span>
  );
}

function stockText(p: Product) {
  return p.onHand <= 0 ? "Out of stock" : `${p.onHand} left`;
}

// Adding products: a big search (name, brand, SKU, or a scanned barcode),
// best sellers, and what the visit's stylist usually recommends; who gets
// the credit for the sale, defaulting to the client's stylist (or, for a
// sale without a visit, whoever is signed in).
export function ProductPicker({ data, onAdd }: { data: CheckoutScreenData; onAdd: (product: Product, staffId: string | null) => void }) {
  const [query, setQuery] = useState("");
  const [credit, setCredit] = useState<string>(data.defaultStaffId ?? "");
  const input = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const q = query.trim().toLowerCase();
  const results = q
    ? data.products
        .filter((p) => p.barcode === query.trim() || p.sku?.toLowerCase() === q || `${p.name} ${p.brand} ${p.sku ?? ""}`.toLowerCase().includes(q))
        .slice(0, 8)
    : [];
  const add = (p: Product) => {
    onAdd(p, credit || null);
    setQuery("");
    input.current?.focus();
  };
  const best = data.bestSellers.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
  const recommended = data.recommended ? data.recommended.productIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])) : [];
  const recommender = data.staff.find((s) => s.id === data.recommended?.staffId)?.firstName;
  const others = best.filter((p) => !recommended.includes(p));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-muted" />
          <label htmlFor="product-search" className="sr-only">
            Add a product: name, brand, SKU or scan
          </label>
          <input
            id="product-search"
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // A scan or an exact SKU adds at once; otherwise the only match.
                const exact = data.products.find((p) => p.barcode === query.trim() || p.sku?.toLowerCase() === q);
                if (exact) add(exact);
                else if (results.length === 1) add(results[0]);
              }
            }}
            placeholder="Add a product: name, brand, SKU or scan"
            autoComplete="off"
            className="h-12 w-full rounded-md border border-line-strong bg-surface pr-4 pl-12 text-base placeholder:text-ink-subtle focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/25 focus:outline-none"
          />
          {results.length > 0 && (
            <ul aria-label="Matching products" className="absolute inset-x-0 top-full z-40 mt-1 max-h-96 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lift">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => add(p)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none"
                  >
                    <ProductThumb product={p} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                      <span className="block text-13 text-ink-muted">{p.onHand <= 0 ? <Badge tone="warning">{stockText(p)}</Badge> : stockText(p)}</span>
                    </span>
                    <span className="text-sm font-semibold text-ink tabular-nums">{formatPrice(p.priceCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q && results.length === 0 && <p className="absolute inset-x-0 top-full z-40 mt-1 rounded-lg border border-line bg-surface px-4 py-3 text-ink-muted shadow-lift">No product matches “{query}”.</p>}
        </div>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap text-ink-muted">
          Credit to
          <select aria-label="Credit product sales to" value={credit} onChange={(e) => setCredit(e.target.value)} className={`${selectClass} h-12 w-40`}>
            <option value="">No one</option>
            {data.creditStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/* Quick add, in one row (so the ticket keeps the room): what the
          stylist usually recommends, then the best sellers. */}
      {(others.length > 0 || recommended.length > 0) && (
        <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-1">
          {recommended.length > 0 && <QuickTiles label={`${recommender} recommends`} products={recommended} onAdd={add} testId="recommended" />}
          {others.length > 0 && <QuickTiles label="Best sellers" products={others} onAdd={add} testId="best-sellers" />}
        </div>
      )}
    </div>
  );
}

function QuickTiles({ label, products, onAdd, testId }: { label: string; products: Product[]; onAdd: (p: Product) => void; testId: string }) {
  return (
    <section aria-label={label} data-testid={testId} className="shrink-0">
      <h2 className="mb-1.5 text-13 font-medium whitespace-nowrap text-ink-muted">{label}</h2>
      <ul className="flex gap-2">
        {products.map((p) => (
          <li key={p.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onAdd(p)}
              aria-label={`Add ${p.name}, ${formatPrice(p.priceCents)}`}
              className="flex w-44 items-center gap-2.5 rounded-lg border border-line bg-surface p-2 text-left transition-[transform,border-color,box-shadow] duration-(--motion-fast) hover:border-line-strong active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-focus"
            >
              <ProductThumb product={p} />
              <span className="min-w-0">
                <span className="line-clamp-2 text-sm leading-tight font-medium text-ink">{p.name}</span>
                <span className="block text-xs text-ink-muted tabular-nums">
                  {formatPrice(p.priceCents)} · {p.onHand <= 0 ? <span className="font-medium text-warning">{stockText(p)}</span> : stockText(p)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
