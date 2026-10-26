import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PayTickets, payMoney } from "@/components/pay-tickets";
import { buttonClass } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Card, PageHeader, Section, nameLinkClass, textLinkClass } from "@/components/ui/page";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { TableCard, numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { formatHours, nextPeriod, previousPeriod, ratesText, requestedPeriod, type PayPeriod } from "@/lib/payroll";
import { loadPayroll, loadPaySettings } from "@/lib/payroll-load";
import { formatDay, formatLongDay } from "@/lib/schedule-format";
import { todayIn } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { averageTipPct, pctText, tipItems, topTippers } from "@/lib/tips";
import { TipDetails } from "@/components/tip-details";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Payroll" };

export default function PayrollPage({ searchParams }: PageProps<"/payroll">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Payroll searchParams={searchParams} />
    </Suspense>
  );
}

const query = (p: PayPeriod, staff?: string) => `?${new URLSearchParams({ from: p.from, to: p.to, ...(staff ? { staff } : {}) })}`;

// Owners and managers: what each person is owed for a pay period, with
// every ticket behind it, and a CSV for the payroll provider.
async function Payroll({ searchParams }: Pick<PageProps<"/payroll">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!can(me, "payroll")) redirect("/dashboard");
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const settings = await loadPaySettings(supabase, me.business_id);
  const period = requestedPeriod(params, settings.kind, settings.anchor, today);
  const lines = await loadPayroll(supabase, me.business_id, tz, period, today);
  const selected = typeof params.staff === "string" ? lines.find((l) => l.staffId === params.staff) : undefined;
  const prev = previousPeriod(settings.kind, settings.anchor, period);
  const next = nextPeriod(settings.kind, settings.anchor, period);
  const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((n, l) => n + f(l), 0);
  const running = period.to >= today;
  // People with services or tips: what they were tipped, on average and by whom.
  const tips = lines
    .filter((l) => l.serviceCents !== 0 || l.tipCents !== 0)
    .map((line) => ({ line, items: tipItems(line.tickets, tz), average: averageTipPct(line.tickets) }))
    .map((t) => ({ ...t, top: topTippers(t.items, 1)[0] ?? null }));

  return (
    <AppShell section="payroll" me={me}>
      <PageHeader
        title="Payroll"
        description={`${formatLongDay(period.from, false)} to ${formatLongDay(period.to)}${running ? " (still running)" : ""}`}
        actions={
          <>
            <a href={`/payroll/export${query(period)}`} className={buttonClass("primary", "md")} download>
              Export CSV
            </a>
            <a href={`/payroll/export${query(period)}&detail=tips`} className={buttonClass("secondary", "md")} download>
              Export tips CSV
            </a>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-4">
        <nav aria-label="Pay period" className="flex items-center gap-2">
          <Link href={`/payroll${query(prev)}`} aria-label="Previous period" title="Previous period" className={buttonClass("secondary", "md", "", { square: true })}>
            <ChevronLeftIcon />
          </Link>
          <span className="px-1 text-sm font-medium text-ink tabular-nums" data-testid="pay-period">
            {formatDay(period.from)} – {formatDay(period.to)}
          </span>
          {next.from <= today ? (
            <Link href={`/payroll${query(next)}`} aria-label="Next period" title="Next period" className={buttonClass("secondary", "md", "", { square: true })}>
              <ChevronRightIcon />
            </Link>
          ) : (
            <span aria-hidden className={buttonClass("secondary", "md", "pointer-events-none opacity-40", { square: true })}>
              <ChevronRightIcon />
            </span>
          )}
        </nav>
        <form action="/payroll" className="flex flex-wrap items-end gap-2" aria-label="Custom dates">
          <label className={labelClass}>
            From
            <input type="date" name="from" defaultValue={period.from} className={`${fieldClass} w-40!`} />
          </label>
          <label className={labelClass}>
            To
            <input type="date" name="to" defaultValue={period.to} className={`${fieldClass} w-40!`} />
          </label>
          <button type="submit" className={buttonClass("secondary", "md")}>
            Show
          </button>
        </form>
      </div>

      <Section title="Pay due" titleId="pay-heading" count={lines.length}>
        <TableCard className="mb-3">
          <table className={`${tableClass} tabular-nums`} aria-label="Pay by staff member">
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>Staff</th>
                <th className={`${thClass} text-right`}>Service sales</th>
                <th className={`${thClass} text-right`}>Commission</th>
                <th className={`${thClass} text-right`}>Retail sales</th>
                <th className={`${thClass} text-right`}>Commission</th>
                <th className={`${thClass} text-right`}>Tips</th>
                <th className={`${thClass} text-right`}>Hours</th>
                <th className={`${thClass} text-right`}>Total pay</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.staffId} className={`${trClass} ${selected?.staffId === l.staffId ? "bg-navy-100/60" : ""}`} data-testid="pay-line" data-staff-id={l.staffId}>
                  <td className={tdClass}>
                    <Link href={`/payroll${query(period, l.staffId)}`} className={nameLinkClass} aria-current={selected?.staffId === l.staffId ? "true" : undefined}>
                      {l.name}
                    </Link>
                    <span className="block text-xs text-ink-subtle">{l.role}</span>
                  </td>
                  <td className={`${tdClass} ${numClass}`}>{payMoney(l.serviceCents)}</td>
                  <td className={`${tdClass} ${numClass}`}>
                    {payMoney(l.serviceCommissionCents)}
                    {l.rates.service.length > 0 && <span className="block text-xs text-ink-subtle">{ratesText(l.rates.service, (v) => `${v}%`)}</span>}
                    {l.rates.plans.length > 0 && <span className="block text-xs text-ink-subtle">{l.rates.plans.join(", ")}</span>}
                    {l.feeCents !== 0 && <span className="block text-xs text-ink-subtle">after {formatPrice(l.feeCents)} back-bar</span>}
                  </td>
                  <td className={`${tdClass} ${numClass}`}>{payMoney(l.retailCents)}</td>
                  <td className={`${tdClass} ${numClass}`}>
                    {payMoney(l.retailCommissionCents)}
                    {l.rates.retail.length > 0 && <span className="block text-xs text-ink-subtle">{ratesText(l.rates.retail, (v) => `${v}%`)}</span>}
                  </td>
                  <td className={`${tdClass} ${numClass}`}>{payMoney(l.tipCents)}</td>
                  <td className={`${tdClass} ${numClass}`}>
                    {l.minutes === null ? "—" : formatHours(l.minutes)}
                    {l.rates.hourly.length > 0 && <span className="block text-xs text-ink-subtle">at {ratesText(l.rates.hourly, (c) => `${formatPrice(c)}/h`)}</span>}
                  </td>
                  <td className={`${tdClass} ${numClass} font-semibold text-ink`} data-testid="pay-total">
                    {formatPrice(l.totalCents)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-line-strong bg-sunken/40 font-semibold">
                <td className={tdClass}>Everyone</td>
                <td className={`${tdClass} ${numClass}`}>{payMoney(sum((l) => l.serviceCents))}</td>
                <td className={`${tdClass} ${numClass}`}>{payMoney(sum((l) => l.serviceCommissionCents))}</td>
                <td className={`${tdClass} ${numClass}`}>{payMoney(sum((l) => l.retailCents))}</td>
                <td className={`${tdClass} ${numClass}`}>{payMoney(sum((l) => l.retailCommissionCents))}</td>
                <td className={`${tdClass} ${numClass}`}>{payMoney(sum((l) => l.tipCents))}</td>
                <td className={`${tdClass} ${numClass}`}>{formatHours(sum((l) => l.minutes ?? 0))}</td>
                <td className={`${tdClass} ${numClass}`} data-testid="pay-everyone">
                  {formatPrice(sum((l) => l.totalCents))}
                </td>
              </tr>
            </tbody>
          </table>
        </TableCard>
        <p className="max-w-3xl text-13 text-ink-muted">
          Commission is on sales after discounts, before tax, at the rate each person had when each sale was made (changing a rate on Team → Schedule only affects sales
          from then on). Refunds and voids are taken back at the same rate, in the period they happen. Hours come from their schedule, less approved time off
          {running ? ", up to today" : ""}, at the hourly rate in effect each day.
          {can(me, "payroll") && (
            <>
              {" "}
              <Link href="/settings/payroll" className={textLinkClass}>
                Change the pay period
              </Link>
            </>
          )}
        </p>
      </Section>

      <Section title="Tips" titleId="tips-heading" description="Each person's tips as a share of their service sales (untipped visits included), and who tipped them the most. Tap a name for every tip.">
        <TableCard>
          <table className={`${tableClass} tabular-nums`} aria-label="Tips by staff member">
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>Staff</th>
                <th className={`${thClass} text-right`}>Tips</th>
                <th className={`${thClass} text-right`}>Tipped visits</th>
                <th className={`${thClass} text-right`}>Average tip</th>
                <th className={thClass}>Top tipper</th>
              </tr>
            </thead>
            <tbody>
              {tips.map(({ line, items, average, top }) => (
                <tr key={line.staffId} className={trClass} data-testid="tip-line" data-staff-id={line.staffId}>
                  <td className={tdClass}>
                    <Link href={`/payroll${query(period, line.staffId)}#tips-for`} className={nameLinkClass}>
                      {line.name}
                    </Link>
                  </td>
                  <td className={`${tdClass} ${numClass}`}>{payMoney(line.tipCents)}</td>
                  <td className={`${tdClass} ${numClass}`}>{items.filter((i) => i.kind === "sale").length}</td>
                  <td className={`${tdClass} ${numClass}`} data-testid="tip-average">
                    {pctText(average)}
                  </td>
                  <td className={`${tdClass} text-ink-muted`}>
                    {top ? (
                      <>
                        <span className="text-ink">{top.client}</span> · <span className="tabular-nums">{formatPrice(top.cents)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      </Section>

      {selected && (
        <Card
          title={`${selected.name}'s tips`}
          titleId="tips-for"
          actions={
            <Link href={`/payroll${query(period)}`} className={buttonClass("quiet", "sm")}>
              Close
            </Link>
          }
        >
          <TipDetails tickets={selected.tickets} period={period} timeZone={tz} linkSales ownView={false} />
        </Card>
      )}

      {selected && (
        <Card
          title={`Tickets behind ${selected.name}'s pay`}
          titleId="tickets-heading"
          description={`${selected.tickets.length} ${selected.tickets.length === 1 ? "ticket" : "tickets"}, ${formatPrice(selected.serviceCents)} in services and ${formatPrice(selected.retailCents)} in retail`}
          actions={
            <Link href={`/payroll${query(period)}`} className={buttonClass("quiet", "sm")}>
              Close
            </Link>
          }
          flush
        >
          <PayTickets tickets={selected.tickets} timeZone={tz} linkSales label={`Tickets for ${selected.name}`} />
        </Card>
      )}
    </AppShell>
  );
}
