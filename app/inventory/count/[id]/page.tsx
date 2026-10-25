import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { Badge, Card, EmptyState, listClass, PageHeader, rowClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadCosts } from "@/lib/inventory-load";
import { isUuid } from "@/lib/ids";
import { canManageInventory, formatAmount, productName, stockValueCents } from "@/lib/inventory";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { isPossibleShrinkage, summarize } from "@/lib/stocktake";

export const metadata: Metadata = { title: "Stocktake" };

export default function StocktakePage({ params }: PageProps<"/inventory/count/[id]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Stocktake params={params} />
    </Suspense>
  );
}

async function Stocktake({ params }: Pick<PageProps<"/inventory/count/[id]">, "params">) {
  const [{ id }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!canManageInventory(me.role)) redirect("/inventory");
  if (!isUuid(id)) notFound();
  const [{ data: s, error }, costs] = await Promise.all([
    supabase
      .from("stocktakes")
      .select("*, finisher:staff!stocktakes_finished_by_business_id_fkey(first_name), stocktake_counts(expected, counted, product:products(id, brand, line, name, unit, size))")
      .eq("id", id)
      .maybeSingle(),
    loadCosts(supabase),
  ]);
  if (error) throw error;
  if (!s) notFound();
  if (s.status === "in_progress") redirect("/inventory/count");

  const counts = s.stocktake_counts.map((c) => ({ ...c, product: { ...c.product, cost_cents: costs.get(c.product.id) ?? 0 } })).sort((a, b) => Math.abs(stockValueCents(b.expected - b.counted, b.product)) - Math.abs(stockValueCents(a.expected - a.counted, a.product)));
  const summary = summarize(counts);
  const when = (at: string) => {
    const local = toLocal(new Date(at), me.location.timezone);
    return `${formatDay(local.date)}, ${formatMinute(local.minute)}`;
  };
  const changed = counts.filter((c) => c.counted !== c.expected);

  return (
    <AppShell section="inventory" me={me}>
      <BackLink href="/inventory/count">Stocktakes</BackLink>
      <PageHeader
        title={`Stocktake · ${formatDay(toLocal(new Date(s.started_at), me.location.timezone).date)}`}
        description={
          s.status === "completed"
            ? `Finished ${when(s.finished_at!)}${s.finisher ? ` by ${s.finisher.first_name}` : ""}. Stock was updated for ${summary.changed} products.`
            : "Canceled: stock wasn't changed."
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {[
          ["Counted", String(summary.counted)],
          ["Different", String(summary.changed)],
          ["Found", formatPrice(summary.gainCents)],
          ["Missing", formatPrice(summary.lossCents)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <p className="text-sm text-ink-muted">{label}</p>
            <p className="font-serif text-2xl font-semibold text-navy-900">{value}</p>
          </div>
        ))}
      </div>
      {summary.flagged > 0 && (
        <p role="note" className="mb-6 rounded-xl border border-status-no-show-ink/25 bg-status-no-show-bg px-4 py-3 text-sm text-status-no-show-ink">
          <strong>Possible shrinkage on {summary.flagged === 1 ? "1 product" : `${summary.flagged} products`}:</strong> much less was on the shelf than services, sales
          and deliveries say there should be.
        </p>
      )}
      <Card title="Differences" titleId="diff-heading" flush>
        {changed.length === 0 ? (
          <EmptyState>Everything counted matched.</EmptyState>
        ) : (
          <ul className={listClass} aria-label="Differences">
            {changed.map((c) => {
              const diff = c.counted - c.expected;
              const flagged = isPossibleShrinkage(c.expected, c.counted, c.product);
              return (
                <li key={c.product.id} data-shrinkage={flagged || undefined} className={`${rowClass} flex flex-wrap items-center gap-x-4 gap-y-1`}>
                  <span className="min-w-52 flex-1 font-medium text-ink">
                    {productName(c.product)}
                    {flagged && (
                      <Badge tone="red" className="ml-2">
                        Possible shrinkage
                      </Badge>
                    )}
                  </span>
                  <span className="text-sm text-ink-muted tabular-nums">
                    {formatAmount(c.expected, c.product.unit)} expected → {formatAmount(c.counted, c.product.unit)}
                  </span>
                  <span className={`w-28 text-right font-semibold tabular-nums ${diff < 0 ? "text-danger" : "text-status-confirmed-ink"}`}>
                    {diff > 0 ? "+" : "−"}
                    {formatAmount(Math.abs(diff), c.product.unit)}
                  </span>
                  <span className="w-20 text-right text-sm text-ink-muted tabular-nums">{formatPrice(stockValueCents(Math.abs(diff), c.product))}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
