import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Badge, Card, PageHeader, type Tone } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { METHOD_LABELS } from "@/lib/checkout";
import { isUuid } from "@/lib/ids";
import { canRefund, canTakePayments, loadSale, receiptSalon, type ReceiptSalon, type SaleView } from "@/lib/sales";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { EmailReceipt, PrintOnOpen, RefundForm, VoidForm } from "./manage";

export const metadata: Metadata = { title: "Sale" };

const STATUS: Record<SaleView["status"], { label: string; tone: Tone }> = {
  completed: { label: "Paid", tone: "green" },
  partly_refunded: { label: "Part refunded", tone: "amber" },
  refunded: { label: "Refunded", tone: "amber" },
  voided: { label: "Voided", tone: "red" },
};

const EVENTS: Record<string, string> = { completed: "Sold", voided: "Voided", refunded: "Refunded", receipt_emailed: "Receipt emailed" };

export default function SalePage({ params, searchParams }: PageProps<"/sales/[id]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Sale params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Sale({ params, searchParams }: Pick<PageProps<"/sales/[id]">, "params" | "searchParams">) {
  const [{ id }, query, { supabase, staff: me }] = await Promise.all([params, searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!canTakePayments(me.role)) redirect("/dashboard");
  if (!isUuid(id)) notFound();
  const [sale, salon] = await Promise.all([loadSale(supabase, id), receiptSalon(me.business_id, me.location.id)]);
  if (!sale) notFound();
  const tz = me.location.timezone;
  const at = (iso: string) => {
    const l = toLocal(new Date(iso), tz);
    return `${formatDay(l.date)}, ${formatMinute(l.minute)}`;
  };

  // Printing: the receipt alone.
  if (query.print === "1") {
    return (
      <main className="mx-auto max-w-sm bg-surface p-6 text-sm text-ink">
        <Receipt sale={sale} salon={salon} when={at(sale.createdAt)} />
        <PrintOnOpen />
      </main>
    );
  }

  const paid = sale.payments.filter((p) => p.amountCents > 0).reduce((n, p) => n + p.amountCents, 0);
  const manager = canRefund(me.role);
  const products = sale.items.filter((i) => i.kind === "product").map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, returned: i.returnedQuantity }));

  return (
    <AppShell section="sales" me={me}>
      <Link href="/sales" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-navy-900">
        ← Sales
      </Link>
      <PageHeader title={`Sale #${sale.number}`} description={at(sale.createdAt)} actions={<Badge tone={STATUS[sale.status].tone}>{STATUS[sale.status].label}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div>
          <Card title="Receipt" titleId="receipt-heading">
            <Receipt sale={sale} salon={salon} when={at(sale.createdAt)} />
          </Card>
          <Card title="History" titleId="history-heading">
            <ol className="flex flex-col gap-2 text-sm" aria-label="Sale history">
              {sale.events.map((e, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="font-medium text-ink">{EVENTS[e.kind] ?? e.kind}</span>
                    {e.detail && <span className="text-ink-muted"> · {e.detail}</span>}
                    {e.staffName && <span className="text-ink-muted"> · by {e.staffName}</span>}
                  </span>
                  <span className="text-ink-muted tabular-nums">
                    {e.amountCents !== null ? `${formatPrice(e.amountCents)} · ` : ""}
                    {at(e.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div>
          {sale.status !== "voided" && (
            <Card title="Receipt" titleId="send-heading" description="Print it, or email it to the client.">
              <EmailReceipt saleId={sale.id} email={sale.receiptEmail ?? sale.client?.email ?? ""} />
            </Card>
          )}
          {manager && sale.status !== "voided" && sale.status !== "refunded" && (
            <Card title="Refund" titleId="refund-heading">
              <RefundForm saleId={sale.id} refundableCents={paid - sale.refundedCents} products={products} />
            </Card>
          )}
          {manager && sale.status === "completed" && (
            <Card title="Void" titleId="void-heading" description="Undoes the whole sale: payments reversed, products back in stock, and the visit open to check out again.">
              <VoidForm saleId={sale.id} />
            </Card>
          )}
          {!manager && <p className="text-sm text-ink-muted">Refunds and voids are for managers and owners.</p>}
        </div>
      </div>
    </AppShell>
  );
}

function Receipt({ sale, salon, when }: { sale: SaleView; salon: ReceiptSalon; when: string }) {
  const change = sale.payments.reduce((n, p) => n + (p.changeCents ?? 0), 0);
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="receipt">
      <div>
        <p className="font-serif text-lg font-semibold text-navy-900">{salon.name}</p>
        <p className="text-ink-muted">
          {salon.locationName}
          {salon.address ? ` · ${salon.address}` : ""}
        </p>
        <p className="text-ink-muted">
          Receipt #{sale.number} · {when}
          {sale.client ? ` · ${sale.client.name}` : ""}
          {sale.soldBy ? ` · served by ${sale.soldBy}` : ""}
        </p>
      </div>
      <table className="w-full tabular-nums">
        <tbody>
          {sale.items.map((i) => (
            <tr key={i.id}>
              <td className="py-1 pr-2">
                {i.quantity > 1 ? `${i.quantity} × ` : ""}
                {i.description}
                {salon.showStylists && i.staffName ? <span className="text-ink-muted"> ({i.staffName})</span> : null}
                {i.bookedPriceCents !== null && (
                  <span className="block text-xs text-ink-muted">
                    Booked at {formatPrice(i.bookedPriceCents)} · {i.priceReason}
                  </span>
                )}
                {i.returnedQuantity > 0 && <span className="block text-xs text-ink-muted">{i.returnedQuantity} returned</span>}
              </td>
              <td className="py-1 text-right">{formatPrice(i.unitPriceCents * i.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="flex flex-col gap-0.5 border-t border-line pt-2 tabular-nums">
        <Line label="Subtotal" value={formatPrice(sale.subtotalCents)} />
        {sale.discountCents > 0 && <Line label={`Discount${sale.discountReason ? ` (${sale.discountReason})` : ""}`} value={`−${formatPrice(sale.discountCents)}`} />}
        {sale.taxCents > 0 && <Line label="Tax" value={formatPrice(sale.taxCents)} />}
        {sale.tips.map((t) => (
          <Line key={t.staffName} label={`Tip for ${t.staffName}`} value={formatPrice(t.amountCents)} />
        ))}
        <Line label="Total" value={formatPrice(sale.totalCents)} strong />
      </dl>
      <dl className="flex flex-col gap-0.5 tabular-nums" aria-label="Payments">
        {sale.payments.map((p) => (
          <Line
            key={p.id}
            label={`${p.amountCents < 0 ? "Refunded" : "Paid"} · ${METHOD_LABELS[p.method]}${p.reference ? ` (${p.reference})` : ""}${p.reason ? ` · ${p.reason}` : ""}`}
            value={formatPrice(p.amountCents)}
          />
        ))}
        {change > 0 && <Line label="Change given" value={formatPrice(change)} />}
      </dl>
      {sale.status === "voided" && <p className="font-medium text-danger">Voided{sale.voidReason ? `: ${sale.voidReason}` : ""}</p>}
      {salon.footer && <p className="text-ink-muted">{salon.footer}</p>}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "text-base font-semibold text-navy-900" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
