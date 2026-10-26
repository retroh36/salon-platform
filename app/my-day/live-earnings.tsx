import type { LiveEarnings } from "@/lib/earnings-load";
import { formatPrice } from "@/lib/services";
import { Alert, Badge, EmptyState, Section } from "@/components/ui/page";
import { numClass, TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";

const money = (cents: number) => formatPrice(cents);

// Today's earnings, live: each service sold today with its price, back-bar
// fee, commission and tip, an estimate for clients still in the chair, and
// running totals for today, the week and the pay period.
export function LiveEarningsCard({ live }: { live: LiveEarnings }) {
  const totals: [string, LiveEarnings["today"]][] = [
    ["Today", live.today],
    ["This week", live.week],
    ["This pay period", live.period],
  ];
  const hasFees = live.sales.some((t) => t.lines.some((l) => (l.pay?.feeCents ?? 0) !== 0)) || live.estimates.some((e) => e.feeCents !== 0);
  return (
    <Section
      title="Today’s earnings"
      titleId="live-heading"
      description={`${live.planName ? `On ${live.planName}. ` : ""}Final at checkout; refunds come off when they happen.`}
      className="mt-10"
      data-testid="live-earnings"
    >
      {live.nextTier && (
        <div className="mb-3" data-testid="next-tier">
          <Alert tone="info">{live.nextTier}</Alert>
        </div>
      )}
      <dl className="mb-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line" aria-label="Running totals">
        {totals.map(([label, t]) => (
          <div key={label} className="flex min-w-0 flex-col gap-1 bg-surface px-3 py-3 sm:px-4">
            <dt className="text-13 text-ink-muted">{label}</dt>
            <dd className="text-xl font-semibold text-ink tabular-nums sm:text-2xl" data-testid={`earned-${label.toLowerCase().replace(/ /g, "-")}`}>
              {money(t.earnedCents)}
            </dd>
            <dd className="text-xs text-ink-subtle tabular-nums">
              {money(t.commissionCents)} + {money(t.tipCents)} tips
            </dd>
          </div>
        ))}
      </dl>
      {live.sales.length + live.estimates.length > 0 ? (
        <TableCard className="mb-0!">
          <table className={`${tableClass} tabular-nums`}>
            <caption className="sr-only">Each service today</caption>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  Service
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Price
                </th>
                {hasFees && (
                  <th scope="col" className={`${thClass} text-right`}>
                    Back-bar
                  </th>
                )}
                <th scope="col" className={`${thClass} text-right`}>
                  Commission
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Tip
                </th>
              </tr>
            </thead>
            <tbody>
              {live.estimates.map((e) => (
                <tr key={e.itemId} className={`${trClass} text-ink-muted`} data-testid="estimate-row">
                  <th scope="row" className={`${tdClass} font-normal`}>
                    {e.service} · {e.client}
                    <span className="block text-xs text-ink-subtle">Estimate, in the chair</span>
                  </th>
                  <td className={`${tdClass} ${numClass}`}>{money(e.priceCents)}</td>
                  {hasFees && <td className={`${tdClass} ${numClass}`}>{e.feeCents ? `−${money(e.feeCents)}` : ""}</td>}
                  <td className={`${tdClass} ${numClass}`}>~{money(e.commissionCents)}</td>
                  <td className={`${tdClass} ${numClass}`}>—</td>
                </tr>
              ))}
              {live.sales.map((t) =>
                t.lines.map((l, i) => (
                  <tr key={`${t.saleId}-${t.kind}-${i}`} className={trClass} data-testid="sale-row">
                    <th scope="row" className={`${tdClass} font-normal text-ink`}>
                      {l.description}
                      {t.client ? ` · ${t.client.split(" ")[0]}` : ""}
                      {t.kind !== "sale" && (
                        <span className="mt-1 block">
                          <Badge tone="neutral">{t.kind === "refund" ? "Refund" : "Voided"}</Badge>
                        </span>
                      )}
                    </th>
                    <td className={`${tdClass} ${numClass}`}>{money(l.cents)}</td>
                    {hasFees && <td className={`${tdClass} ${numClass}`}>{l.pay?.feeCents ? `−${money(Math.round(l.pay.feeCents))}` : ""}</td>}
                    <td className={`${tdClass} ${numClass}`}>{money(Math.round(l.pay?.commissionCents ?? 0))}</td>
                    <td className={`${tdClass} ${numClass}`}>{i === 0 && t.tipCents ? money(t.tipCents) : ""}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </TableCard>
      ) : (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState art={false} className="py-6">Nothing checked out yet today.</EmptyState>
        </div>
      )}
      {live.estimatedCents > 0 && <p className="mt-2 text-xs text-ink-muted">About {money(live.estimatedCents)} more once the clients in your chair check out.</p>}
    </Section>
  );
}
