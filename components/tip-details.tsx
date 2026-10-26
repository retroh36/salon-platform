import Link from "next/link";
import { payMoney, shortDay } from "@/components/pay-tickets";
import type { PayPeriod, Ticket } from "@/lib/payroll";
import { formatDay } from "@/lib/schedule-format";
import { formatPrice } from "@/lib/services";
import { averageTipPct, pctText, tipItems, tipTotals, topTippers, type TipItem, type TipTotal } from "@/lib/tips";
import { firstLetter } from "@/lib/initial";
import { numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { nameLinkClass } from "@/components/ui/page";

const KIND_LABELS = { sale: null, refund: "Refund", void: "Voided" } as const;

// "Ava T." for a stylist's own view; full names for owners and managers.
const shortName = (name: string) => {
  const [first, ...rest] = name.split(" ");
  return rest.length ? `${first} ${firstLetter(rest[rest.length - 1])}.` : first;
};

function Totals({ label, rows, day }: { label: string; rows: TipTotal[]; day: boolean }) {
  if (!rows.length) return null;
  return (
    <div>
      <h4 className="border-b border-line pb-2 text-13 font-medium text-ink">{label}</h4>
      <ul className="flex flex-col text-sm tabular-nums" aria-label={label}>
        {rows.map((r) => (
          <li key={r.from} className="flex justify-between gap-3 border-b border-line py-2 last:border-b-0">
            <span className="text-ink-muted">{day ? formatDay(r.from) : r.from === r.to ? formatDay(r.from) : `${formatDay(r.from)} – ${formatDay(r.to)}`}</span>
            <span>
              {payMoney(r.cents)} <span className="text-xs text-ink-subtle">({r.count})</span>
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
    <div className="flex flex-col gap-6" data-testid="tip-details">
      <dl className="grid grid-cols-3 divide-x divide-line">
        <div className="pr-4">
          <dt className="text-13 text-ink-muted">Tips</dt>
          <dd className="text-xl font-semibold text-ink tabular-nums" data-testid="tips-total">
            {formatPrice(totals.total.cents)}
          </dd>
        </div>
        <div className="px-4">
          <dt className="text-13 text-ink-muted">Average tip</dt>
          <dd className="text-xl font-semibold text-ink tabular-nums" data-testid="tips-average">
            {pctText(average)}
          </dd>
          <dd className="text-xs text-ink-subtle">of service sales</dd>
        </div>
        <div className="pl-4">
          <dt className="text-13 text-ink-muted">Tipped visits</dt>
          <dd className="text-xl font-semibold text-ink tabular-nums">{totals.total.count}</dd>
        </div>
      </dl>
      {top.length > 0 && (
        <div>
          <h4 className="border-b border-line pb-2 text-13 font-medium text-ink">Top tippers</h4>
          <ol className="flex flex-col text-sm tabular-nums" aria-label="Top tippers">
            {top.map((t) => (
              <li key={t.client} className="flex justify-between gap-3 border-b border-line py-2 last:border-b-0" data-testid="top-tipper">
                <span>{name(t.client)}</span>
                <span>
                  {formatPrice(t.cents)}
                  <span className="text-xs text-ink-subtle">
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
      <div className="grid gap-6 sm:grid-cols-2">
        <Totals label="By week" rows={totals.weeks} day={false} />
        <Totals label="By day" rows={totals.days} day />
      </div>
      <TipList items={items} timeZone={timeZone} linkSales={linkSales} name={name} />
    </div>
  );
}

function TipList({ items, timeZone, linkSales, name }: { items: TipItem[]; timeZone: string; linkSales: boolean; name: (c: string | null) => string }) {
  return (
    <div className="-mx-4 -mb-4 overflow-x-auto overscroll-x-contain border-t border-line">
      <table className={`${tableClass} tabular-nums`} aria-label="Every tip">
        <thead className={theadClass}>
          <tr>
            <th className={thClass}>Date</th>
            <th className={thClass}>Client and services</th>
            <th className={`${thClass} text-right`}>Tip</th>
            <th className={`${thClass} text-right`}>Tip %</th>
            <th className={thClass}>Paid with</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={`${i.saleId}:${i.kind}:${i.at}`} className={trClass} data-testid="tip-item" data-kind={i.kind}>
              <td className={`${tdClass} whitespace-nowrap`}>
                {shortDay(i.at, timeZone)}
                <span className="block text-xs text-ink-muted">
                  {linkSales ? (
                    <Link href={`/sales/${i.saleId}`} className={nameLinkClass}>
                      #{i.number}
                    </Link>
                  ) : (
                    `#${i.number}`
                  )}
                  {KIND_LABELS[i.kind] ? ` · ${KIND_LABELS[i.kind]}` : ""}
                </span>
              </td>
              <td className={tdClass}>
                <span className="block text-ink">{name(i.client)}</span>
                <span className="block text-xs text-ink-muted">
                  {i.services.join(", ") || "Retail only"}
                  {i.serviceCents ? ` · ${payMoney(i.serviceCents)}` : ""}
                </span>
              </td>
              <td className={`${tdClass} ${numClass}`}>{payMoney(i.tipCents)}</td>
              <td className={`${tdClass} ${numClass}`}>{pctText(i.pct)}</td>
              <td className={`${tdClass} whitespace-nowrap`}>{i.paidWith ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
