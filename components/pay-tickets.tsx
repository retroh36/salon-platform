import Link from "next/link";
import type { Ticket } from "@/lib/payroll";
import { formatPrice } from "@/lib/services";

const KIND_LABELS = { sale: null, refund: "Refund", void: "Voided" } as const;

const money = (cents: number) => (cents === 0 ? "—" : cents < 0 ? `−${formatPrice(-cents)}` : formatPrice(cents));

export const shortDay = (iso: string, timeZone: string) => new Date(iso).toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric" });

// Every ticket behind someone's pay: the sales, refunds and voids in the
// period, with what each added or took back. Links to the sale for the
// front of house and managers.
export function PayTickets({ tickets, timeZone, linkSales, label }: { tickets: Ticket[]; timeZone: string; linkSales: boolean; label: string }) {
  if (tickets.length === 0) return <p className="px-5 py-4 text-sm text-ink-muted">No tickets in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums" aria-label={label}>
        <thead>
          <tr className="text-left text-ink-muted">
            <th className="px-5 py-2 font-medium">Date</th>
            <th className="py-2 pr-3 font-medium">Ticket</th>
            <th className="py-2 pr-3 font-medium">Client and what</th>
            <th className="py-2 pr-3 text-right font-medium">Services</th>
            <th className="py-2 pr-3 text-right font-medium">Retail</th>
            <th className="py-2 pr-5 text-right font-medium">Tip</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={`${t.saleId}:${t.kind}:${t.at}`} className="border-t border-line align-top" data-testid="pay-ticket" data-kind={t.kind}>
              <td className="px-5 py-2 whitespace-nowrap">{shortDay(t.at, timeZone)}</td>
              <td className="py-2 pr-3 whitespace-nowrap">
                {linkSales ? (
                  <Link href={`/sales/${t.saleId}`} className="text-link hover:underline">
                    #{t.number}
                  </Link>
                ) : (
                  `#${t.number}`
                )}
                {KIND_LABELS[t.kind] && <span className="ml-1.5 rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-ink-muted">{KIND_LABELS[t.kind]}</span>}
              </td>
              <td className="py-2 pr-3">
                <span className="block text-ink">{t.client ?? "Walk-in"}</span>
                <span className="block text-xs text-ink-muted">{t.lines.map((l) => (l.quantity > 1 ? `${l.description} × ${l.quantity}` : l.description)).join(", ") || "Tip"}</span>
              </td>
              <td className="py-2 pr-3 text-right">{money(t.serviceCents)}</td>
              <td className="py-2 pr-3 text-right">{money(t.retailCents)}</td>
              <td className="py-2 pr-5 text-right">{money(t.tipCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { money as payMoney };
