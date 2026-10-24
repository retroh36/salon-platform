import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { ChevronRightIcon, PlusIcon } from "@/components/ui/icons";
import { Badge, Card, EmptyState, listClass, PageHeader, pillClass, rowLinkClass, type Tone } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { METHOD_LABELS, type PaymentMethod } from "@/lib/checkout";
import { canTakePayments } from "@/lib/sales";
import { formatLongDay } from "@/lib/schedule-format";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, formatMinute, isLocalDate, todayIn, toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { fullName } from "@/lib/staff";

export const metadata: Metadata = { title: "Sales" };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  completed: { label: "Paid", tone: "green" },
  partly_refunded: { label: "Part refunded", tone: "amber" },
  refunded: { label: "Refunded", tone: "amber" },
  voided: { label: "Voided", tone: "red" },
};

export default function SalesPage({ searchParams }: PageProps<"/sales">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Sales searchParams={searchParams} />
    </Suspense>
  );
}

async function Sales({ searchParams }: Pick<PageProps<"/sales">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!canTakePayments(me.role)) redirect("/dashboard");
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const date = typeof params.date === "string" && isLocalDate(params.date) ? params.date : today;

  const { data: sales, error } = await supabase
    .from("sales")
    .select("id, number, status, total_cents, created_at, client:clients(first_name, last_name), payments(method, amount_cents)")
    .eq("location_id", me.location.id)
    .gte("created_at", startOfLocalDay(date, tz).toISOString())
    .lt("created_at", startOfLocalDay(addDays(date, 1), tz).toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Money in by tender, net of refunds and voids.
  const byTender = new Map<PaymentMethod, number>();
  for (const s of sales) for (const p of s.payments) byTender.set(p.method, (byTender.get(p.method) ?? 0) + p.amount_cents);
  const net = [...byTender.values()].reduce((n, c) => n + c, 0);

  return (
    <AppShell section="sales" me={me}>
      <PageHeader
        title="Sales"
        description={formatLongDay(date)}
        actions={
          // A plain link: /checkout/new is a route handler that opens the checkout.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/checkout/new?from=/sales" className={buttonClass("primary", "md")}>
            <PlusIcon className="size-4" />
            New sale
          </a>
        }
      />
      <nav aria-label="Day" className="mb-4 flex flex-wrap gap-2">
        <Link href={`/sales?date=${addDays(date, -1)}`} className={pillClass(false)}>
          ← Previous day
        </Link>
        {date !== today && (
          <Link href="/sales" className={pillClass(false)}>
            Today
          </Link>
        )}
        {date < today && (
          <Link href={`/sales?date=${addDays(date, 1)}`} className={pillClass(false)}>
            Next day →
          </Link>
        )}
      </nav>

      <Card title="Taken" titleId="taken-heading" description="By how it was paid, after refunds and voids.">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-6" data-testid="sales-by-tender">
          {(["cash", "card", "gift_card", "package", "membership"] as const).map((m) => (
            <div key={m}>
              <dt className="text-sm text-ink-muted">{METHOD_LABELS[m]}</dt>
              <dd className="font-serif text-2xl font-semibold text-navy-900 tabular-nums">{formatPrice(byTender.get(m) ?? 0)}</dd>
            </div>
          ))}
          <div>
            <dt className="text-sm text-ink-muted">All</dt>
            <dd className="font-serif text-2xl font-semibold text-navy-900 tabular-nums">{formatPrice(net)}</dd>
          </div>
        </dl>
      </Card>

      <Card flush title={`${sales.length} ${sales.length === 1 ? "sale" : "sales"}`} titleId="sales-heading">
        {sales.length === 0 ? (
          <EmptyState>No sales {date === today ? "yet today" : "that day"}.</EmptyState>
        ) : (
          <ul className={listClass} aria-label="Sales">
            {sales.map((s) => (
              <li key={s.id}>
                <Link href={`/sales/${s.id}`} className={rowLinkClass}>
                  <span className="w-16 font-semibold text-ink tabular-nums">#{s.number}</span>
                  <span className="w-20 text-sm text-ink-muted tabular-nums">{formatMinute(toLocal(new Date(s.created_at), tz).minute)}</span>
                  <span className="min-w-40 flex-1 text-ink">{s.client ? fullName(s.client) : "Walk-in sale"}</span>
                  <span className="text-sm text-ink-muted">{[...new Set(s.payments.filter((p) => p.amount_cents > 0).map((p) => METHOD_LABELS[p.method]))].join(" + ")}</span>
                  <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                  <span className="w-24 text-right font-semibold text-ink tabular-nums">{formatPrice(s.total_cents)}</span>
                  <ChevronRightIcon className="hidden size-4 text-ink-muted sm:block" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
