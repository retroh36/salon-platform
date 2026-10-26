import { can } from "@/lib/permissions";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { ChevronRightIcon, PlusIcon } from "@/components/ui/icons";
import {
  Badge,
  EmptyState,
  nameLinkClass,
  PageHeader,
  pillClass,
  Section,
  type Tone,
} from "@/components/ui/page";
import {
  actionsClass,
  numClass,
  TableCard,
  tableClass,
  tdClass,
  theadClass,
  thClass,
  trClass,
} from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { METHOD_LABELS, type PaymentMethod } from "@/lib/checkout";
import { canTakePayments } from "@/lib/sales";
import { formatLongDay } from "@/lib/schedule-format";
import { startOfLocalDay } from "@/lib/scheduling/load";
import {
  addDays,
  formatMinute,
  isLocalDate,
  todayIn,
  toLocal,
} from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { fullName } from "@/lib/staff";

export const metadata: Metadata = { title: "Sales" };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  completed: { label: "Paid", tone: "success" },
  partly_refunded: { label: "Part refunded", tone: "warning" },
  refunded: { label: "Refunded", tone: "neutral" },
  voided: { label: "Voided", tone: "danger" },
};

export default function SalesPage({ searchParams }: PageProps<"/sales">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Sales searchParams={searchParams} />
    </Suspense>
  );
}

async function Sales({
  searchParams,
}: Pick<PageProps<"/sales">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([
    searchParams,
    getCurrentStaff(),
  ]);
  if (!me) return <NotLinked />;
  if (!canTakePayments(me.role)) redirect("/dashboard");
  const tz = me.location.timezone;
  const today = todayIn(tz);
  // The front desk sees today's sales; earlier days are reports (the
  // database draws the same line, private.sees_sale).
  const pastDays = can(me, "reports");
  const date =
    pastDays && typeof params.date === "string" && isLocalDate(params.date)
      ? params.date
      : today;

  const { data: sales, error } = await supabase
    .from("sales")
    .select(
      "id, number, status, total_cents, created_at, client:clients(first_name, last_name), payments(method, amount_cents)",
    )
    .eq("location_id", me.location.id)
    .gte("created_at", startOfLocalDay(date, tz).toISOString())
    .lt("created_at", startOfLocalDay(addDays(date, 1), tz).toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Money in by tender that day, net of the refunds and voids given that
  // day (whichever day their sale was), so it matches the drawer and the
  // day's close-out on Reports.
  const { data: paid, error: paidError } = await supabase
    .from("payments")
    .select("method, amount_cents")
    .eq("location_id", me.location.id)
    .gte("created_at", startOfLocalDay(date, tz).toISOString())
    .lt("created_at", startOfLocalDay(addDays(date, 1), tz).toISOString());
  if (paidError) throw paidError;
  const byTender = new Map<PaymentMethod, number>();
  for (const p of paid)
    byTender.set(p.method, (byTender.get(p.method) ?? 0) + p.amount_cents);
  const net = [...byTender.values()].reduce((n, c) => n + c, 0);

  return (
    <AppShell section="sales" me={me}>
      <PageHeader
        title="Sales"
        description={formatLongDay(date)}
        actions={
          // A plain link: /checkout/new is a route handler that opens the checkout.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a
            href="/checkout/new?from=/sales"
            className={buttonClass("primary", "md")}
          >
            <PlusIcon className="size-4" />
            New sale
          </a>
        }
      />
      {pastDays && (
        <nav aria-label="Day" className="mb-4 flex flex-wrap gap-2">
          <Link
            href={`/sales?date=${addDays(date, -1)}`}
            className={pillClass(false)}
          >
            ← Previous day
          </Link>
          {date !== today && (
            <Link href="/sales" className={pillClass(false)}>
              Today
            </Link>
          )}
          {date < today && (
            <Link
              href={`/sales?date=${addDays(date, 1)}`}
              className={pillClass(false)}
            >
              Next day →
            </Link>
          )}
        </nav>
      )}

      <section aria-labelledby="taken-heading" className="mb-8">
        <div className="mb-3">
          <h2 id="taken-heading" className="text-base font-semibold text-ink">
            Taken
          </h2>
          <p className="mt-0.5 text-13 text-ink-muted">
            By how it was paid, after the refunds and voids given {date === today ? "today" : "that day"}.
          </p>
        </div>
        <dl
          className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-6"
          data-testid="sales-by-tender"
        >
          {(
            ["cash", "card", "gift_card", "package", "membership"] as const
          ).map((m) => (
            <div key={m} className="bg-surface px-4 py-3">
              <dt className="text-13 text-ink-muted">{METHOD_LABELS[m]}</dt>
              <dd className="mt-1 text-2xl font-semibold tracking-[-0.015em] text-ink tabular-nums">
                {formatPrice(byTender.get(m) ?? 0)}
              </dd>
            </div>
          ))}
          <div className="bg-surface px-4 py-3">
            <dt className="text-13 font-medium text-ink">All</dt>
            <dd className="mt-1 text-2xl font-semibold tracking-[-0.015em] text-ink tabular-nums">
              {formatPrice(net)}
            </dd>
          </div>
        </dl>
      </section>

      <Section
        title="Sales"
        titleId="sales-heading"
        count={sales.length}
      >
        {sales.length === 0 ? (
          <TableCard>
            <EmptyState>
              No sales {date === today ? "yet today" : "that day"}.
            </EmptyState>
          </TableCard>
        ) : (
          <TableCard>
            <table className={tableClass} aria-label="Sales">
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>Sale</th>
                  <th scope="col" className={thClass}>Time</th>
                  <th scope="col" className={thClass}>Client</th>
                  <th scope="col" className={thClass}>Paid by</th>
                  <th scope="col" className={thClass}>Status</th>
                  <th scope="col" className={`${thClass} text-right`}>Total</th>
                  <th scope="col" className={`${thClass} w-px`}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className={`${trClass} relative`}>
                    <td className={`${tdClass} font-medium text-ink tabular-nums whitespace-nowrap`}>
                      <Link
                        href={`/sales/${s.id}`}
                        className={`${nameLinkClass} after:absolute after:inset-0`}
                      >
                        #{s.number}
                      </Link>
                    </td>
                    <td className={`${tdClass} text-ink-muted tabular-nums whitespace-nowrap`}>
                      {formatMinute(toLocal(new Date(s.created_at), tz).minute)}
                    </td>
                    <td className={`${tdClass} text-ink`}>
                      {s.client ? fullName(s.client) : "Walk-in sale"}
                    </td>
                    <td className={`${tdClass} text-ink-muted`}>
                      {[
                        ...new Set(
                          s.payments
                            .filter((p) => p.amount_cents > 0)
                            .map((p) => METHOD_LABELS[p.method]),
                        ),
                      ].join(" + ")}
                    </td>
                    <td className={tdClass}>
                      <Badge tone={STATUS[s.status].tone}>
                        {STATUS[s.status].label}
                      </Badge>
                    </td>
                    <td className={`${tdClass} ${numClass} font-medium text-ink`}>
                      {formatPrice(s.total_cents)}
                    </td>
                    <td className={`${tdClass} ${actionsClass}`}>
                      <ChevronRightIcon className="size-4 text-ink-subtle" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>
    </AppShell>
  );
}
