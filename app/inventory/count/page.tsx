import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, listClass, PageHeader, rowLinkClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { canManageInventory } from "@/lib/inventory";
import { loadInventory } from "@/lib/inventory-load";
import { formatDay } from "@/lib/schedule-format";
import { toLocal } from "@/lib/scheduling/time";
import { startStocktake } from "./actions";
import { CountMode, type CountProduct } from "./count-mode";

export const metadata: Metadata = { title: "Stocktake" };

export default function CountPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Count />
    </Suspense>
  );
}

async function Count() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!canManageInventory(me.role)) redirect("/inventory");

  const { data: stocktakes, error } = await supabase
    .from("stocktakes")
    .select("id, status, started_at, finished_at, starter:staff!stocktakes_started_by_business_id_fkey(first_name), stocktake_counts(count)")
    .eq("location_id", me.location.id)
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const open = stocktakes.find((s) => s.status === "in_progress");
  const day = (at: string) => formatDay(toLocal(new Date(at), me.location.timezone).date);

  if (open) {
    const [rows, { data: counts, error: countError }] = await Promise.all([
      loadInventory(supabase, me.location.id),
      supabase.from("stocktake_counts").select("product_id, counted, expected").eq("stocktake_id", open.id),
    ]);
    if (countError) throw countError;
    // Shelf by shelf, in the order they're stored.
    const products: CountProduct[] = rows
      .map((r) => ({ id: r.id, brand: r.brand, line: r.line, name: r.name, unit: r.unit, size: r.size, cost_cents: r.cost_cents, shelf: r.shelf ?? "No shelf" }))
      .sort((a, b) => a.shelf.localeCompare(b.shelf));
    return (
      <AppShell section="inventory" me={me}>
        <BackLink href="/inventory">Inventory</BackLink>
        <PageHeader
          title="Stocktake"
          description={`Started ${day(open.started_at)}${open.starter ? ` by ${open.starter.first_name}` : ""}. Count each shelf; nothing changes until you finish.`}
        />
        <CountMode stocktakeId={open.id} products={products} initial={Object.fromEntries(counts.map((c) => [c.product_id, { counted: c.counted, expected: c.expected }]))} />
      </AppShell>
    );
  }

  return (
    <AppShell section="inventory" me={me}>
      <BackLink href="/inventory">Inventory</BackLink>
      <PageHeader
        title="Stocktake"
        description="Count what's on the shelves, shelf by shelf. The app shows the difference from what the records say, and puts stock right when you finish."
        actions={
          <form action={startStocktake}>
            <button type="submit" className={buttonClass("primary", "lg")}>
              Start a stocktake
            </button>
          </form>
        }
      />
      <Card title="Past stocktakes" titleId="past-heading" flush>
        {stocktakes.length === 0 ? (
          <EmptyState>No stocktakes yet.</EmptyState>
        ) : (
          <ul className={listClass} aria-label="Past stocktakes">
            {stocktakes.map((s) => (
              <li key={s.id}>
                <Link href={`/inventory/count/${s.id}`} className={rowLinkClass}>
                  <span className="flex-1 font-medium text-ink">{day(s.started_at)}</span>
                  <Badge tone={s.status === "completed" ? "green" : "neutral"}>{s.status === "completed" ? "Finished" : "Canceled"}</Badge>
                  <span className="w-28 text-sm text-ink-muted">{s.stocktake_counts[0]?.count ?? 0} counted</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
