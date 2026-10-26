import { can } from "@/lib/permissions";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Badge, Card, PageHeader, type Tone } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { METHOD_LABELS } from "@/lib/checkout";
import { isUuid } from "@/lib/ids";
import { canTakePayments, loadSale, receiptGroups, receiptSalon, type ReceiptSalon, type SaleView } from "@/lib/sales";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { EmailReceipt, PrintOnOpen, RefundForm, RetryCardRefund, VoidForm } from "./manage";

export const metadata: Metadata = { title: "Sale" };

const STATUS: Record<SaleView["status"], { label: string; tone: Tone }> = {
  completed: { label: "Paid", tone: "success" },
  partly_refunded: { label: "Part refunded", tone: "warning" },
  refunded: { label: "Refunded", tone: "neutral" },
  voided: { label: "Voided", tone: "danger" },
};

const EVENTS: Record<string, string> = {
  completed: "Sold",
  voided: "Voided",
  refunded: "Refunded",
  receipt_emailed: "Receipt emailed",
  card_refunded: "Card refunded online",
  card_refund_failed: "Card refund didn't go through",
};

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
  const manager = can(me, "void_refund");
  // A void's card refund through the payment provider still to make.
  const cardRefundDue = -sale.payments.filter((p) => p.providerRefund === "due" || p.providerRefund === "failed").reduce((n, p) => n + p.amountCents, 0);
  // Gift cards it was paid with (money can go back onto them).
  const { data: used } = await supabase.from("payments").select("gift_card:gift_cards(code, kind)").eq("sale_id", sale.id).not("gift_card_id", "is", null);
  const giftCards = [...new Map((used ?? []).flatMap((p) => (p.gift_card ? [[p.gift_card.code, { code: p.gift_card.code, label: `${p.gift_card.kind === "promotional" ? "promotional card" : "gift card"} …${p.gift_card.code.slice(-4)}` }] as const] : []))).values()];
  const products = sale.items.filter((i) => i.kind === "product").map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, returned: i.returnedQuantity, totalCents: i.totalCents }));
  // Gift cards, packages and memberships it sold, and what returning each
  // gives back now (refundable_lines; null once cancelled).
  const { data: sold } = manager ? await supabase.rpc("refundable_lines", { p_sale_id: sale.id }) : { data: [] };
  const returnable = (sold ?? []).map((l) => ({ id: l.sale_item_id, kind: l.kind as "gift_card" | "package" | "membership", description: l.description, valueCents: l.value_cents }));

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
            <ol className="flex flex-col divide-y divide-line text-sm" aria-label="Sale history">
              {sale.events.map((e, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 py-2 first:pt-0 last:pb-0">
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
          {manager && cardRefundDue > 0 && (
            <Card title="Card refund" titleId="card-refund-heading">
              <RetryCardRefund saleId={sale.id} amountCents={cardRefundDue} />
            </Card>
          )}
          {manager && sale.status !== "voided" && sale.status !== "refunded" && (
            <Card title="Refund" titleId="refund-heading">
              <RefundForm saleId={sale.id} refundableCents={paid - sale.refundedCents} products={products} returnable={returnable} giftCards={giftCards} />
            </Card>
          )}
          {manager && sale.status === "completed" && (
            <Card title="Void" titleId="void-heading" description="Undoes the whole sale: payments reversed, products back in stock, and the visit open to check out again.">
              <VoidForm saleId={sale.id} online={sale.payments.filter((p) => p.amountCents > 0 && p.online).map((p) => ({ label: p.reference && /…\d{4}$/.test(p.reference) ? p.reference : "the client's card", amountCents: p.amountCents }))} />
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
        <p className="text-base font-semibold text-ink">{salon.name}</p>
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
      {receiptGroups(sale).map((g) => (
        <section key={g.staffName ?? "other"} aria-label={salon.showStylists && g.staffName ? `${g.staffName}'s lines` : "Lines"}>
          {salon.showStylists && (
            <p className="flex justify-between border-b border-line pb-0.5 text-xs font-medium text-ink-muted">
              <span>{g.staffName ?? "Other"}</span>
              <span className="tabular-nums">{formatPrice(g.subtotalCents)}</span>
            </p>
          )}
          <table className="w-full tabular-nums">
            <tbody>
              {g.items.map((i) => (
                <tr key={i.id}>
                  <td className="py-1 pr-2">
                    {i.quantity > 1 ? `${i.quantity} × ` : ""}
                    {i.description}
                    {i.bookedPriceCents !== null && (
                      <span className="block text-xs text-ink-muted">
                        Booked at {formatPrice(i.bookedPriceCents)} · {i.priceReason}
                      </span>
                    )}
                    {i.lineDiscountCents > 0 && (
                      <span className="block text-xs text-ink-muted">
                        −{formatPrice(i.lineDiscountCents)} discount{i.lineDiscountReason ? ` · ${i.lineDiscountReason}` : ""}
                      </span>
                    )}
                    {i.returnedQuantity > 0 && <span className="block text-xs text-ink-muted">{i.returnedQuantity} returned</span>}
                  </td>
                  <td className="py-1 text-right align-top whitespace-nowrap">{formatPrice(i.unitPriceCents * i.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
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
      {sale.status === "voided" && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone="danger">Voided</Badge>
          {sale.voidReason && (
            <span className="text-ink-muted">
              <span className="sr-only">: </span>
              {sale.voidReason}
            </span>
          )}
        </p>
      )}
      {salon.footer && <p className="text-ink-muted">{salon.footer}</p>}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "pt-1 text-base font-semibold text-ink" : ""}`}>
      <dt>{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}
