import Link from "next/link";
import type { Ticket } from "@/lib/payroll";
import { formatPrice } from "@/lib/services";
import { Badge, nameLinkClass } from "@/components/ui/page";
import { numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";

const KIND_LABELS = { sale: null, refund: "Refund", void: "Voided" } as const;

const money = (cents: number) => (cents === 0 ? "—" : cents < 0 ? `−${formatPrice(-cents)}` : formatPrice(cents));

export const shortDay = (iso: string, timeZone: string) => new Date(iso).toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric" });

// Every ticket behind someone's pay: the sales, refunds and voids in the
// period, with what each added or took back. Links to the sale for the
// front of house and managers.
export function PayTickets({ tickets, timeZone, linkSales, label }: { tickets: Ticket[]; timeZone: string; linkSales: boolean; label: string }) {
  if (tickets.length === 0) return <p className="px-4 py-3 text-sm text-ink-muted">No tickets in this period.</p>;
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table className={`${tableClass} tabular-nums`} aria-label={label}>
        <thead className={theadClass}>
          <tr>
            <th className={thClass}>Date</th>
            <th className={thClass}>Ticket</th>
            <th className={thClass}>Client and what</th>
            <th className={`${thClass} text-right`}>Services</th>
            <th className={`${thClass} text-right`}>Retail</th>
            <th className={`${thClass} text-right`}>Tip</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={`${t.saleId}:${t.kind}:${t.at}`} className={trClass} data-testid="pay-ticket" data-kind={t.kind}>
              <td className={`${tdClass} whitespace-nowrap`}>{shortDay(t.at, timeZone)}</td>
              <td className={`${tdClass} whitespace-nowrap`}>
                {linkSales ? (
                  <Link href={`/sales/${t.saleId}`} className={nameLinkClass}>
                    #{t.number}
                  </Link>
                ) : (
                  `#${t.number}`
                )}
                {KIND_LABELS[t.kind] && (
                  <Badge tone="neutral" className="ml-1.5">
                    {KIND_LABELS[t.kind]}
                  </Badge>
                )}
              </td>
              <td className={tdClass}>
                <span className="block text-ink">{t.client ?? "Walk-in"}</span>
                <span className="block text-xs text-ink-muted">{t.lines.map((l) => (l.quantity > 1 ? `${l.description} × ${l.quantity}` : l.description)).join(", ") || "Tip"}</span>
              </td>
              <td className={`${tdClass} ${numClass}`}>{money(t.serviceCents)}</td>
              <td className={`${tdClass} ${numClass}`}>{money(t.retailCents)}</td>
              <td className={`${tdClass} ${numClass}`}>{money(t.tipCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { money as payMoney };
