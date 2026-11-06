import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Badge, PageHeader, Section, textLinkClass } from "@/components/ui/page";
import { TableCard, numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ISSUE_TEXT, parseReconcileRange, reconcileTotals } from "@/lib/reconcile";
import { loadReconcile } from "@/lib/reconcile-load";
import { formatDay } from "@/lib/schedule-format";
import { todayIn } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";

export const metadata: Metadata = { title: "Reconcile" };

export default function ReconcilePage({ searchParams }: PageProps<"/reports/reconcile">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Reconcile searchParams={searchParams} />
    </Suspense>
  );
}

const money = (cents: number) => (cents < 0 ? `−${formatPrice(-cents)}` : formatPrice(cents));

// For the bookkeeper: each day's sales, money by type of payment, the cash
// close-out and what should reach the bank, with an export.
async function Reconcile({ searchParams }: Pick<PageProps<"/reports/reconcile">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!can(me, "reports")) redirect("/dashboard");
  const today = todayIn(me.location.timezone);
  const range = parseReconcileRange(params, today);
  const { days } = await loadReconcile(supabase, me.business_id, me.location, range);
  const t = reconcileTotals(days);
  const q = `from=${range.from}&to=${range.to}`;
  return (
    <AppShell section="reports" me={me}>
      <PageHeader
        title="Reconcile"
        description="Sales against the money taken, day by day, to match with your bank and card statements."
        actions={
          <>
            {/* Plain links: these are file downloads from a route handler. */}
            <a href={`/reports/reconcile/export?${q}&detail=payments`} className={buttonClass("secondary")}>
              Every payment (CSV)
            </a>
            <a href={`/reports/reconcile/export?${q}`} className={buttonClass("primary")}>
              Export CSV
            </a>
          </>
        }
      />
      <form method="get" aria-label="Dates" className="mb-6 flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          From
          <input type="date" name="from" defaultValue={range.from} max={today} className={`${fieldClass} w-40`} />
        </label>
        <label className={labelClass}>
          To
          <input type="date" name="to" defaultValue={range.to} max={today} className={`${fieldClass} w-40`} />
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          Show
        </button>
        <Link href="/reports" className={`${textLinkClass} self-center text-sm`}>
          Back to Reports
        </Link>
      </form>

      <Section title={`${formatDay(range.from)} to ${formatDay(range.to)}`} titleId="reconcile-heading" description="Card payments are as recorded in Maestra. Card batches and payouts will appear here once card payments are connected.">
        <p className="mb-3 text-13 text-ink-muted" data-testid="reconcile-summary">
          Sales {formatPrice(t.salesCents)}. To the bank {formatPrice(t.toBankCents)}: cash deposited {formatPrice(t.depositedCents)}, cards at the desk {money(t.deskCardCents)}, cards online {money(t.onlineCardCents)}.{t.otherCents ? ` Paid by other ${money(t.otherCents)}, not in "To the bank": match it by its notes.` : ""}
          {" "}
          {t.issues === 0 ? "Every day checks out." : `${t.issues} day${t.issues === 1 ? "" : "s"} to look at.`}
        </p>
        <TableCard>
          <table className={tableClass} data-testid="reconcile-days">
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>Day</th>
                <th className={`${thClass} ${numClass}`}>Sales</th>
                <th className={`${thClass} ${numClass}`}>Cash</th>
                <th className={`${thClass} ${numClass}`}>Card at the desk</th>
                <th className={`${thClass} ${numClass}`}>Card online</th>
                <th className={`${thClass} ${numClass}`}>Other</th>
                <th className={`${thClass} ${numClass}`}>Credit used</th>
                <th className={`${thClass} ${numClass}`}>Refunds and voids</th>
                <th className={`${thClass} ${numClass}`}>Cash deposited</th>
                <th className={`${thClass} ${numClass}`}>To the bank</th>
                <th className={thClass}>Check</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const credit = d.tenders.gift_card.netCents + d.tenders.package.netCents + d.tenders.membership.netCents;
                const refunds = Object.values(d.tenders).reduce((n, x) => n + x.refundedCents, 0);
                return (
                  <tr key={d.day} className={trClass} data-day={d.day}>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      <Link href={`/sales?date=${d.day}`} className={textLinkClass}>
                        {formatDay(d.day)}
                      </Link>
                    </td>
                    <td className={`${tdClass} ${numClass}`}>{d.sales ? formatPrice(d.salesCents) : "—"}</td>
                    <td className={`${tdClass} ${numClass}`}>{money(d.tenders.cash.netCents)}</td>
                    <td className={`${tdClass} ${numClass}`}>{money(d.tenders.card.netCents)}</td>
                    <td className={`${tdClass} ${numClass}`}>{money(d.tenders.card_on_file.netCents)}</td>
                    <td className={`${tdClass} ${numClass}`} title={d.otherNotes.join("; ") || undefined}>
                      {d.tenders.other.netCents ? money(d.tenders.other.netCents) : "—"}
                    </td>
                    <td className={`${tdClass} ${numClass}`}>{money(credit)}</td>
                    <td className={`${tdClass} ${numClass}`}>{refunds ? `−${formatPrice(refunds)}` : "—"}</td>
                    <td className={`${tdClass} ${numClass}`}>{d.close ? formatPrice(d.close.depositCents) : "—"}</td>
                    <td className={`${tdClass} ${numClass} font-medium text-ink`}>{money(d.toBankCents)}</td>
                    <td className={tdClass}>
                      {d.issues.length === 0 ? (
                        d.sales || d.moneyInCents ? <Badge tone="success">OK</Badge> : <span className="text-ink-subtle">—</span>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          {d.issues.map((i) => (
                            <Badge key={i} tone={i === "cash_off" ? "danger" : "warning"}>
                              {i === "cash_off" && d.close ? `Cash ${formatPrice(Math.abs(d.close.countedCents - d.close.expectedCents))} ${d.close.countedCents > d.close.expectedCents ? "over" : "short"}` : ISSUE_TEXT[i]}
                            </Badge>
                          ))}
                          {d.otherNotes.map((n, k) => (
                            <span key={k} className="text-xs text-ink-muted" data-testid="other-note">
                              {n}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableCard>
      </Section>
    </AppShell>
  );
}
