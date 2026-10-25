import type { LiveEarnings } from "@/lib/earnings-load";
import { formatPrice } from "@/lib/services";

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
    <section aria-labelledby="live-heading" className="mx-auto mt-8 max-w-xl rounded-xl border border-line bg-surface p-4 shadow-card" data-testid="live-earnings">
      <h2 id="live-heading" className="font-serif text-xl font-semibold text-ink">
        Today&rsquo;s earnings
      </h2>
      <p className="text-sm text-ink-muted">{live.planName ? `On ${live.planName}. ` : ""}Final at checkout; refunds come off when they happen.</p>
      {live.nextTier && (
        <p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-sm font-medium text-ink" data-testid="next-tier">
          {live.nextTier}
        </p>
      )}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center" aria-label="Running totals">
        {totals.map(([label, t]) => (
          <div key={label} className="rounded-lg border border-line px-2 py-2">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="font-semibold tabular-nums" data-testid={`earned-${label.toLowerCase().replace(/ /g, "-")}`}>
              {money(t.earnedCents)}
            </dd>
            <dd className="text-xs text-ink-muted tabular-nums">
              {money(t.commissionCents)} + {money(t.tipCents)} tips
            </dd>
          </div>
        ))}
      </dl>
      {live.sales.length + live.estimates.length > 0 ? (
        <div className="-mx-4 mt-4 overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">Each service today</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-muted">
                <th scope="col" className="py-1.5 pl-4 font-medium">
                  Service
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Price
                </th>
                {hasFees && (
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Back-bar
                  </th>
                )}
                <th scope="col" className="py-1.5 text-right font-medium">
                  Commission
                </th>
                <th scope="col" className="py-1.5 pr-4 text-right font-medium">
                  Tip
                </th>
              </tr>
            </thead>
            <tbody>
              {live.estimates.map((e) => (
                <tr key={e.itemId} className="border-b border-line text-ink-muted" data-testid="estimate-row">
                  <th scope="row" className="py-2 pl-4 text-left font-normal">
                    {e.service} · {e.client}
                    <span className="block text-xs">Estimate, in the chair</span>
                  </th>
                  <td className="py-2 text-right">{money(e.priceCents)}</td>
                  {hasFees && <td className="py-2 text-right">{e.feeCents ? `−${money(e.feeCents)}` : ""}</td>}
                  <td className="py-2 text-right">~{money(e.commissionCents)}</td>
                  <td className="py-2 pr-4 text-right">—</td>
                </tr>
              ))}
              {live.sales.map((t) =>
                t.lines.map((l, i) => (
                  <tr key={`${t.saleId}-${t.kind}-${i}`} className="border-b border-line" data-testid="sale-row">
                    <th scope="row" className="py-2 pl-4 text-left font-normal">
                      {l.description}
                      {t.client ? ` · ${t.client.split(" ")[0]}` : ""}
                      {t.kind !== "sale" && <span className="block text-xs text-ink-muted">{t.kind === "refund" ? "Refund" : "Voided"}</span>}
                    </th>
                    <td className="py-2 text-right">{money(l.cents)}</td>
                    {hasFees && <td className="py-2 text-right">{l.pay?.feeCents ? `−${money(Math.round(l.pay.feeCents))}` : ""}</td>}
                    <td className="py-2 text-right">{money(Math.round(l.pay?.commissionCents ?? 0))}</td>
                    <td className="py-2 pr-4 text-right">{i === 0 && t.tipCents ? money(t.tipCents) : ""}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">Nothing checked out yet today.</p>
      )}
      {live.estimatedCents > 0 && <p className="mt-2 text-xs text-ink-muted">About {money(live.estimatedCents)} more once the clients in your chair check out.</p>}
    </section>
  );
}
