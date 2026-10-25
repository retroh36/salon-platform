import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { Badge, Card, EmptyState, listClass, PageHeader, rowLinkClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { canManageInventory, canReceiveOrders, describeStock, filterInventory, formatAmount, isLow, productName, readFilter, stockValueCents, TYPE_LABELS } from "@/lib/inventory";
import { loadInventory } from "@/lib/inventory-load";
import { formatPrice } from "@/lib/services";
import { isFrontOfHouse } from "@/lib/staff";
import { DeniseReorders } from "./denise-reorders";
import { InventoryFilters } from "./inventory-filters";

export const metadata: Metadata = { title: "Inventory" };

export default function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Inventory searchParams={searchParams} />
    </Suspense>
  );
}

async function Inventory({ searchParams }: Pick<PageProps<"/inventory">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;

  const filter = readFilter(params);
  const all = await loadInventory(supabase, me.location.id);
  const rows = filterInventory(all, filter);
  const brands = [...new Set(all.map((p) => p.brand))].sort();
  const low = all.filter((p) => isLow(p.on_hand, p.reorder_point));
  const totalValue = all.reduce((sum, p) => sum + stockValueCents(p.on_hand, p), 0);
  const shownValue = rows.reduce((sum, p) => sum + stockValueCents(p.on_hand, p), 0);
  const manage = canManageInventory(me.role);
  // What stock cost is the front of house's; stylists see what's on hand.
  const costs = isFrontOfHouse(me.role);

  return (
    <AppShell section="inventory" me={me}>
      <PageHeader
        title="Inventory"
        description={
          <>
            {all.length} products
            {costs && (
              <>
                {" · "}
                <span data-testid="stock-value">{formatPrice(totalValue)}</span> in stock at cost
              </>
            )}
          </>
        }
        actions={
          <>
            {canReceiveOrders(me.role) && (
              <Link href="/inventory/orders" className={buttonClass("secondary", "md")}>
                Orders
              </Link>
            )}
            <Link href="/inventory/suppliers" className={buttonClass("secondary", "md")}>
              Suppliers
            </Link>
            {manage && (
              <Link href="/inventory/count" className={buttonClass("secondary", "md")}>
                Stocktake
              </Link>
            )}
            {manage && (
              <Link href="/inventory/new" className={buttonClass("primary", "md")}>
                <PlusIcon className="size-4" />
                Add product
              </Link>
            )}
          </>
        }
      />

      {!filter.q && !filter.brand && !filter.type && !filter.low && <DeniseReorders canManage={manage} />}

      {low.length > 0 && !filter.low && (
        <Link
          href="/inventory?low=1"
          data-testid="low-stock-alert"
          className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-status-late-ink/25 bg-status-late-bg px-4 py-3 text-sm text-status-late-ink transition-[filter] duration-(--motion-fast) hover:brightness-[0.98]"
        >
          <span>
            <strong className="font-semibold">{low.length} {low.length === 1 ? "product is" : "products are"} below the reorder point:</strong>{" "}
            {low.slice(0, 3).map(productName).join(", ")}
            {low.length > 3 ? ` and ${low.length - 3} more` : ""}.
          </span>
          <span className="shrink-0 font-semibold underline underline-offset-2">Show</span>
        </Link>
      )}

      <InventoryFilters filter={filter} brands={brands} />

      <p className="mb-3 text-sm text-ink-muted" aria-live="polite">
        {rows.length === all.length ? `${rows.length} products` : `${rows.length} of ${all.length} products${costs ? ` · ${formatPrice(shownValue)} at cost` : ""}`}
      </p>

      <Card flush>
        {rows.length === 0 ? (
          <EmptyState>No products match. Try another search or filter.</EmptyState>
        ) : (
          <>
            <div aria-hidden className="hidden gap-4 border-b border-line bg-sunken/50 px-5 py-2 text-xs font-semibold tracking-wider text-ink-muted uppercase md:flex">
              <span className="flex-1">Product</span>
              <span className="w-36 text-right">On hand</span>
              <span className="w-28 text-right">Reorder at</span>
              {costs && <span className="w-24 text-right">Value</span>}
            </div>
            <ul className={listClass} aria-label="Products">
              {rows.map((p) => {
                const stock = describeStock(p.on_hand, p);
                const lowStock = isLow(p.on_hand, p.reorder_point);
                return (
                  <li key={p.id}>
                    <Link href={`/inventory/${p.id}`} className={`${rowLinkClass} md:flex-nowrap`} data-low={lowStock || undefined}>
                      <span className="min-w-0 flex-1 basis-full md:basis-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">{productName(p)}</span>
                          <Badge tone={p.type === "retail" ? "blue" : "navy"}>{TYPE_LABELS[p.type]}</Badge>
                          {lowStock && <Badge tone="amber">Low stock</Badge>}
                        </span>
                        <span className="block text-sm text-ink-muted">
                          {[p.sku, p.supplier?.name].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="tabular-nums md:w-36 md:text-right">
                        <span className={`block font-medium ${p.on_hand < 0 ? "text-danger" : "text-ink"}`}>{stock.main}</span>
                        {stock.containers && <span className="block text-xs text-ink-muted">{stock.containers}</span>}
                      </span>
                      <span className="text-sm text-ink-muted tabular-nums md:w-28 md:text-right">
                        <span className="md:hidden">Reorder at </span>
                        {p.reorder_point > 0 ? formatAmount(p.reorder_point, p.unit) : "—"}
                      </span>
                      {costs && <span className="ml-auto text-sm font-medium text-ink tabular-nums md:ml-0 md:w-24 md:text-right">{formatPrice(stockValueCents(p.on_hand, p))}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </AppShell>
  );
}
