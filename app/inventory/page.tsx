import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { Badge, EmptyState, nameLinkClass, PageHeader } from "@/components/ui/page";
import { numClass, TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
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
          className="mb-4 flex items-start gap-2.5 rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning transition-[filter] duration-(--motion-fast) hover:brightness-[0.98]"
        >
          <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-warning-dot" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{low.length} {low.length === 1 ? "product is" : "products are"} below the reorder point:</span>{" "}
            {low.slice(0, 3).map(productName).join(", ")}
            {low.length > 3 ? ` and ${low.length - 3} more` : ""}.
          </span>
          <span className="shrink-0 font-medium underline underline-offset-2">Show</span>
        </Link>
      )}

      <InventoryFilters filter={filter} brands={brands} />

      <p className="mb-3 text-sm text-ink-muted" aria-live="polite">
        {rows.length === all.length ? `${rows.length} products` : `${rows.length} of ${all.length} products${costs ? ` · ${formatPrice(shownValue)} at cost` : ""}`}
      </p>

      {rows.length === 0 ? (
        <TableCard>
          <EmptyState>No products match. Try another search or filter.</EmptyState>
        </TableCard>
      ) : (
        <TableCard>
          <table className={tableClass} aria-label="Products">
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  Product
                </th>
                <th scope="col" className={`${thClass} hidden sm:table-cell`}>
                  Type
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  On hand
                </th>
                <th scope="col" className={`${thClass} hidden text-right md:table-cell`}>
                  Reorder at
                </th>
                {costs && (
                  <th scope="col" className={`${thClass} text-right`}>
                    Value
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const stock = describeStock(p.on_hand, p);
                const lowStock = isLow(p.on_hand, p.reorder_point);
                return (
                  <tr key={p.id} className={trClass} data-low={lowStock || undefined}>
                    <td className={tdClass}>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link href={`/inventory/${p.id}`} className={nameLinkClass}>
                          {productName(p)}
                        </Link>
                        {lowStock && <Badge tone="warning">Low stock</Badge>}
                      </span>
                      {(p.sku || p.supplier?.name) && <span className="block text-13 text-ink-muted">{[p.sku, p.supplier?.name].filter(Boolean).join(" · ")}</span>}
                    </td>
                    <td className={`${tdClass} hidden whitespace-nowrap text-ink-muted sm:table-cell`}>{TYPE_LABELS[p.type]}</td>
                    <td className={`${tdClass} ${numClass}`}>
                      <span className={`block font-medium ${p.on_hand < 0 ? "text-danger" : "text-ink"}`}>{stock.main}</span>
                      {stock.containers && <span className="block text-xs text-ink-subtle">{stock.containers}</span>}
                    </td>
                    <td className={`${tdClass} ${numClass} hidden text-ink-muted md:table-cell`}>{p.reorder_point > 0 ? formatAmount(p.reorder_point, p.unit) : "—"}</td>
                    {costs && <td className={`${tdClass} ${numClass} text-ink`}>{formatPrice(stockValueCents(p.on_hand, p))}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableCard>
      )}
    </AppShell>
  );
}
