import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, listClass, PageHeader, rowClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import {
  canManageInventory,
  canSellRetail,
  containerName,
  describeStock,
  formatAmount,
  isLow,
  productName,
  REASON_LABELS,
  stockValueCents,
  TYPE_LABELS,
  type StockReason,
} from "@/lib/inventory";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { loadCosts, PRODUCT_COLUMNS } from "@/lib/inventory-load";
import { formatPrice } from "@/lib/services";
import { isFrontOfHouse } from "@/lib/staff";
import { AdjustForm, SettingsForm } from "./stock-actions";

export const metadata: Metadata = { title: "Product" };

const REASON_TONES: Record<StockReason, "neutral" | "info" | "success"> = {
  service_use: "neutral",
  sale: "info",
  count: "neutral",
  order_received: "success",
  adjustment: "neutral",
};

export default function ProductPage({ params }: PageProps<"/inventory/[id]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Product params={params} />
    </Suspense>
  );
}

async function Product({ params }: Pick<PageProps<"/inventory/[id]">, "params">) {
  const [{ id }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isUuid(id)) notFound();

  // Cost and stock history are the front of house's (none for anyone else).
  const [{ data: found, error }, { data: movements, error: movementError }, costs] = await Promise.all([
    supabase
      .from("products")
      .select(`${PRODUCT_COLUMNS}, supplier:suppliers(id, name, lead_time_days), stock_levels(location_id, on_hand, reorder_point, reorder_quantity)`)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("stock_movements")
      .select("id, change, on_hand_after, reason, note, created_at, appointment_id, unit_cost_cents, creator:staff(first_name, last_name)")
      .eq("product_id", id)
      .eq("location_id", me.location.id)
      .order("created_at", { ascending: false })
      .limit(50),
    loadCosts(supabase),
  ]);
  if (error) throw error;
  if (movementError) throw movementError;
  if (!found) notFound();
  const product = { ...found, cost_cents: costs.get(found.id) ?? 0 };
  const frontOfHouse = isFrontOfHouse(me.role);

  const level = product.stock_levels.find((l) => l.location_id === me.location.id);
  const onHand = level?.on_hand ?? 0;
  const reorderPoint = level?.reorder_point ?? 0;
  const stock = describeStock(onHand, product);
  const low = isLow(onHand, reorderPoint);
  const manage = canManageInventory(me.role);
  const tz = me.location.timezone;
  const when = (at: string) => {
    const local = toLocal(new Date(at), tz);
    return `${formatDay(local.date)}, ${formatMinute(local.minute)}`;
  };

  return (
    <AppShell section="inventory" me={me}>
      <BackLink href="/inventory">Inventory</BackLink>
      <PageHeader
        title={productName(product)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral" dot={false}>{TYPE_LABELS[product.type]}</Badge>
            {!product.is_active && <Badge>Not in use</Badge>}
            {low && <Badge tone="warning">Low stock</Badge>}
            <span>{[product.sku, product.supplier?.name, product.shelf].filter(Boolean).join(" · ")}</span>
          </span>
        }
        actions={
          manage && (
            <Link href={`/inventory/${product.id}/edit`} className={buttonClass("secondary", "md")}>
              Edit product
            </Link>
          )
        }
      />

      <section aria-labelledby="stock-heading" className="mb-6">
        <h2 id="stock-heading" className="sr-only">
          Stock
        </h2>
        <dl className="grid divide-y divide-line rounded-lg border border-line bg-surface sm:grid-flow-col sm:auto-cols-fr sm:divide-x sm:divide-y-0">
          <div className="px-4 py-3">
            <dt className="text-13 text-ink-muted">On hand</dt>
            <dd className={`mt-1 text-2xl font-semibold tabular-nums ${onHand < 0 ? "text-danger" : "text-ink"}`} data-testid="on-hand">
              {stock.main}
            </dd>
            {stock.containers && <dd className="mt-0.5 text-xs text-ink-subtle">{stock.containers}</dd>}
          </div>
          <div className="px-4 py-3">
            <dt className="text-13 text-ink-muted">Reorder below</dt>
            <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{reorderPoint > 0 ? formatAmount(reorderPoint, product.unit) : "Not set"}</dd>
            <dd className="mt-0.5 text-xs text-ink-subtle">
              Orders {level?.reorder_quantity ?? 1} {containerName(product, (level?.reorder_quantity ?? 1) !== 1)} at a time
            </dd>
          </div>
          {frontOfHouse && (
            <div className="px-4 py-3">
              <dt className="text-13 text-ink-muted">Value at cost</dt>
              <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{formatPrice(stockValueCents(onHand, product))}</dd>
              <dd className="mt-0.5 text-xs text-ink-subtle">
                {formatPrice(product.cost_cents)} per {product.unit === "unit" ? "unit" : `${formatAmount(product.size, product.unit)} ${containerName(product)}`}
              </dd>
            </div>
          )}
          {product.price_cents !== null && (
            <div className="px-4 py-3">
              <dt className="text-13 text-ink-muted">Retail price</dt>
              <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{formatPrice(product.price_cents)}</dd>
            </div>
          )}
        </dl>
      </section>

      {product.type === "retail" && canSellRetail(me.role) && (
        <Card title="Sell" titleId="sell-heading" description="A sale at the front desk takes it out of stock.">
          <a href={`/checkout/new?product=${product.id}&from=/inventory/${product.id}`} className={buttonClass("primary", "md")}>
            Sell this product
          </a>
        </Card>
      )}

      {manage && (
        <Card title="Adjust" titleId="adjust-heading" description="For breakage, samples and corrections. Counts go through a stocktake.">
          <div className="flex flex-col gap-6">
            <AdjustForm productId={product.id} unit={product.unit} />
            <div className="border-t border-line pt-4">
              <SettingsForm productId={product.id} unit={product.unit} reorderPoint={reorderPoint} reorderQuantity={level?.reorder_quantity ?? 1} containerWord={containerName(product)} />
            </div>
          </div>
        </Card>
      )}

      {frontOfHouse && (
        <Card title="History" titleId="history-heading" flush>
          {movements.length === 0 ? (
            <EmptyState>No stock changes yet.</EmptyState>
          ) : (
            <ol className={listClass} aria-label="Stock history">
              {movements.map((m) => (
                <li key={m.id} className={`${rowClass} flex flex-wrap items-center gap-x-4 gap-y-1 text-sm`}>
                  <span className="w-28">
                    <Badge tone={REASON_TONES[m.reason]}>{REASON_LABELS[m.reason]}</Badge>
                  </span>
                  <span className={`w-20 text-right font-medium tabular-nums ${m.change < 0 ? "text-ink" : "text-success"}`}>
                    {m.change > 0 ? "+" : "−"}
                    {formatAmount(Math.abs(m.change), product.unit)}
                  </span>
                  <span className="w-24 text-ink-muted tabular-nums">→ {formatAmount(m.on_hand_after, product.unit)}</span>
                  <span className="min-w-40 flex-1 text-ink">
                    {m.note}
                    {m.unit_cost_cents !== null && <span className="text-ink-muted"> · {formatPrice(m.unit_cost_cents)} each</span>}
                  </span>
                  <span className="text-13 text-ink-subtle">
                    {when(m.created_at)}
                    {m.creator && ` · ${m.creator.first_name}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </AppShell>
  );
}
