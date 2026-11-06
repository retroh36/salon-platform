import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { DeniseFace } from "@/components/denise";
import { BackLink } from "@/components/ui/back-link";
import { buttonClass } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { EmptyState, nameLinkClass, PageHeader, Section } from "@/components/ui/page";
import { numClass, TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { canManageInventory, containerName, formatAmount, TYPE_LABELS } from "@/lib/inventory";
import { formatDay } from "@/lib/schedule-format";
import { daysBetween, todayIn } from "@/lib/scheduling/time";
import { usagePeriod, usageSummary, type UsageRow } from "@/lib/usage-report";
import { loadUsageReport } from "@/lib/usage-report-load";

export const metadata: Metadata = { title: "Product usage" };

export default function UsagePage({ searchParams }: PageProps<"/inventory/usage">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Usage searchParams={searchParams} />
    </Suspense>
  );
}

const amount = (n: number, r: Pick<UsageRow, "unit">) => (n === 0 ? "—" : formatAmount(n, r.unit));

// What each product went through in a period (used in services and sold),
// what's on hand and on order, a suggested reorder, and how it compares
// with the same dates last year.
async function Usage({ searchParams }: Pick<PageProps<"/inventory/usage">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!canManageInventory(me.role)) redirect("/inventory");
  const today = todayIn(me.location.timezone);
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const period = usagePeriod({ from: one("from"), to: one("to") }, today);
  const { rows, compared } = await loadUsageReport(supabase, me.location, period);
  const length = daysBetween(period.from, period.to) + 1;
  const lastYear = compared.kind === "last_year";
  const when = lastYear ? `${formatDay(compared.from, true)} to ${formatDay(compared.to, true)}` : length === 1 ? "day" : `${length} days`;
  const summary = usageSummary(rows, compared, when);

  return (
    <AppShell section="inventory" me={me}>
      <BackLink href="/inventory">Inventory</BackLink>
      <PageHeader title="Product usage" description="What each product was used for in services and sold over any dates, with what's on hand and what to order." />
      <form method="get" aria-label="Dates" className="mb-6 flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          From
          <input type="date" name="from" defaultValue={period.from} max={today} className={`${fieldClass} w-40`} />
        </label>
        <label className={labelClass}>
          To
          <input type="date" name="to" defaultValue={period.to} max={today} className={`${fieldClass} w-40`} />
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          Show
        </button>
      </form>

      <div className="mb-6 flex items-start gap-3 rounded-lg border border-denise-200 bg-denise-50 p-4" data-testid="usage-denise">
        <DeniseFace size={24} />
        <p className="text-sm text-ink">
          {summary ??
            (lastYear
              ? `There's no usage on record for the same dates last year (${when}).`
              : `There's no usage on record for the ${when} before, and no history from a year ago to compare with yet.`)}
          {!lastYear && summary && " There's no history from a year ago yet, so this is against the period before."}
        </p>
      </div>

      <Section title={`${formatDay(period.from, true)} to ${formatDay(period.to, true)}`} titleId="usage-heading">
        {rows.length === 0 ? (
          <EmptyState title="Nothing used or sold">No products went out in services or sales over these dates.</EmptyState>
        ) : (
          <TableCard>
            <table className={tableClass} data-testid="usage-table">
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>Product</th>
                  <th className={thClass}>Type</th>
                  <th className={`${thClass} ${numClass}`}>Used in services</th>
                  <th className={`${thClass} ${numClass}`}>Sold</th>
                  <th className={`${thClass} ${numClass}`}>On hand</th>
                  <th className={`${thClass} ${numClass}`}>On order</th>
                  <th className={`${thClass} ${numClass}`}>{lastYear ? "Same dates last year" : "Period before"}</th>
                  <th className={`${thClass} ${numClass}`}>Change</th>
                  <th className={`${thClass} ${numClass}`}>Suggested order</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.productId} className={trClass} data-product={r.productId}>
                    <td className={tdClass}>
                      <Link href={`/inventory/${r.productId}`} className={nameLinkClass}>
                        {r.name}
                      </Link>
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-ink-muted`}>{TYPE_LABELS[r.type]}</td>
                    <td className={`${tdClass} ${numClass}`}>{amount(r.used, r)}</td>
                    <td className={`${tdClass} ${numClass}`}>{amount(r.sold, r)}</td>
                    <td className={`${tdClass} ${numClass}`}>{formatAmount(r.onHand, r.unit)}</td>
                    <td className={`${tdClass} ${numClass}`}>{amount(r.onOrder, r)}</td>
                    <td className={`${tdClass} ${numClass}`}>{amount(r.before, r)}</td>
                    <td className={`${tdClass} ${numClass}`}>{r.changePct === null ? "—" : `${r.changePct > 0 ? "+" : r.changePct < 0 ? "−" : ""}${Math.abs(r.changePct)}%`}</td>
                    <td className={`${tdClass} ${numClass} font-medium text-ink`}>
                      {r.suggested ? `${r.suggested} ${containerName(r, r.suggested !== 1)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
        <p className="mt-3 text-13 text-ink-muted">
          A suggested order covers another {length === 1 ? "day" : `${length} days`} like these and keeps the product above its reorder point, at least the usual
          amount. Draft it under Orders.
        </p>
      </Section>
    </AppShell>
  );
}
