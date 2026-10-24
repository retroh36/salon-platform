import Link from "next/link";
import { payMoney, shortDay } from "@/components/pay-tickets";
import type { PayPeriod, Ticket } from "@/lib/payroll";
import { formatDay } from "@/lib/schedule-format";
import { formatPrice } from "@/lib/services";
import { averageTipPct, pctText, tipItems, tipTotals, topTippers, type TipItem, type TipTotal } from "@/lib/tips";

const KIND_LABELS = { sale: null, refund: "Refund", void: "Voided" } as const;

// "Ava T." for a stylist's own view; full names for owners and managers.
const shortName = (name: string) => {
  const [first, ...rest] = name.split(" ");
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
};

function Totals({ label, rows, day }: { label: string; rows: TipTotal[]; day: boolean }) {
  if (!rows.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">{label}</h4>
      <ul className="flex flex-col text-sm tabular-nums" aria-label={label}>
        {rows.map((r) => (
          <li key={r.from} className="flex justify-between gap-3 border-b border-line py-1">
            <span className="text-ink-muted">{day ? formatDay(r.from) : r.from === r.to ? formatDay(r.from) : `${formatDay(r.from)} – ${formatDay(r.to)}`}</span>
            <span>
              {payMoney(r.cents)} <span className="text-xs text-ink-muted">({r.count})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// One stylist's tips for a pay period: the average tip and top tippers,
// totals by week and day, and every tip with its client, services, share
// and how it was paid. Numbers from lib/tips.ts.
export function TipDetails({ tickets, period, timeZone, linkSales, ownView }: { tickets: Ticket[]; period: PayPeriod; timeZone: string; linkSales: boolean; ownView: boolean }) {
  const items = tipItems(tickets, timeZone);
  if (!items.length) return <p className="text-sm text-ink-muted">No tips in this period.</p>;
  const totals = tipTotals(items, period);
  const average = averageTipPct(tickets);
  const top = topTippers(items);
  const name = (c: string | null) => (c ? (ownView ? shortName(c) : c) : "Walk-in");
  return (
    <div className="flex flex-col gap-4" data-testid="tip-details">
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-ink-muted">Tips</dt>
          <dd className="text-lg font-semibold tabular-nums" data-testid="tips-total">
            {formatPrice(totals.total.cents)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Average tip</dt>
          <dd className="text-lg font-semibold tabular-nums" data-testid="tips-average">
            {pctText(average)}
          </dd>
          <p className="text-xs text-ink-muted">of service sales</p>
        </div>
        <div>
          <dt className="text-ink-muted">Tipped visits</dt>
          <dd className="text-lg font-semibold tabular-nums">{totals.total.count}</dd>
        </div>
      </dl>
      {top.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">Top tippers</h4>
          <ol className="flex flex-col text-sm tabular-nums" aria-label="Top tippers">
            {top.map((t) => (
              <li key={t.client} className="flex justify-between gap-3 border-b border-line py-1" data-testid="top-tipper">
                <span>{name(t.client)}</span>
                <span>
                  {formatPrice(t.cents)}
                  <span className="text-xs text-ink-muted">
                    {" "}
                    · {t.visits} {t.visits === 1 ? "visit" : "visits"}
                    {t.pct !== null ? ` · ${pctText(t.pct)}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Totals label="By week" rows={totals.weeks} day={false} />
        <Totals label="By day" rows={totals.days} day />
      </div>
      <TipList items={items} timeZone={timeZone} linkSales={linkSales} name={name} />
    </div>
  );
}

function TipList({ items, timeZone, linkSales, name }: { items: TipItem[]; timeZone: string; linkSales: boolean; name: (c: string | null) => string }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full text-sm tabular-nums" aria-label="Every tip">
        <thead>
          <tr className="text-left text-ink-muted">
            <th className="px-4 py-2 font-medium sm:pl-0">Date</th>
            <th className="py-2 pr-3 font-medium">Client and services</th>
            <th className="py-2 pr-3 text-right font-medium">Tip</th>
            <th className="py-2 pr-3 text-right font-medium">Tip %</th>
            <th className="py-2 pr-4 font-medium sm:pr-0">Paid with</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={`${i.saleId}:${i.kind}:${i.at}`} className="border-t border-line align-top" data-testid="tip-item" data-kind={i.kind}>
              <td className="px-4 py-2 whitespace-nowrap sm:pl-0">
                {shortDay(i.at, timeZone)}
                <span className="block text-xs text-ink-muted">
                  {linkSales ? (
                    <Link href={`/sales/${i.saleId}`} className="text-link hover:underline">
                      #{i.number}
                    </Link>
                  ) : (
                    `#${i.number}`
                  )}
                  {KIND_LABELS[i.kind] ? ` · ${KIND_LABELS[i.kind]}` : ""}
                </span>
              </td>
              <td className="py-2 pr-3">
                <span className="block text-ink">{name(i.client)}</span>
                <span className="block text-xs text-ink-muted">
                  {i.services.join(", ") || "Retail only"}
                  {i.serviceCents ? ` · ${payMoney(i.serviceCents)}` : ""}
                </span>
              </td>
              <td className="py-2 pr-3 text-right">{payMoney(i.tipCents)}</td>
              <td className="py-2 pr-3 text-right">{pctText(i.pct)}</td>
              <td className="py-2 pr-4 sm:pr-0">{i.paidWith ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
