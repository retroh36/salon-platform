import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { Badge, Card, listClass, PageHeader, rowClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { canManageInventory, canReceiveOrders, containerName, productName } from "@/lib/inventory";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES, orderNumber } from "@/lib/purchase-orders";
import { formatDay } from "@/lib/schedule-format";
import { toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { orderProducts } from "../load";
import { DraftActions, ReceiveForm } from "../order-actions";
import { OrderEditor } from "../order-editor";

export const metadata: Metadata = { title: "Order" };

export default function OrderPage({ params }: PageProps<"/inventory/orders/[id]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Order params={params} />
    </Suspense>
  );
}

async function Order({ params }: Pick<PageProps<"/inventory/orders/[id]">, "params">) {
  const [{ id }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!canReceiveOrders(me.role)) redirect("/inventory");
  if (!isUuid(id)) notFound();

  const { data: order, error } = await supabase
    .from("purchase_orders")
    .select(
      "*, supplier:suppliers(id, name, email, phone, lead_time_days), creator:staff!purchase_orders_created_by_business_id_fkey(first_name), purchase_order_lines(id, product_id, quantity, received_quantity, unit_cost_cents, reason, product:products(brand, line, name, unit, size))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!order) notFound();

  const manage = canManageInventory(me.role);
  const draft = order.status === "draft";
  const lines = [...order.purchase_order_lines].sort((a, b) => productName(a.product).localeCompare(productName(b.product), "en", { numeric: true }));
  const total = lines.reduce((sum, l) => sum + l.quantity * l.unit_cost_cents, 0);
  const day = (at: string) => formatDay(toLocal(new Date(at), me.location.timezone).date);
  const describe = (p: (typeof lines)[number]["product"]) => (p.unit === "unit" ? productName(p) : `${productName(p)} (${p.size} ${p.unit})`);
  const [{ data: suppliers }, products] = draft && manage ? await Promise.all([supabase.from("suppliers").select("id, name").order("name"), orderProducts(supabase)]) : [{ data: [] }, []];

  return (
    <AppShell section="inventory" me={me}>
      <BackLink href="/inventory/orders">Orders</BackLink>
      <PageHeader
        title={`${orderNumber(order.number)} · ${order.supplier.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={ORDER_STATUS_TONES[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
            {order.ai_action_id && <span className="text-denise-700">Drafted by Denise</span>}
            <span>
              {order.sent_at ? `Sent ${day(order.sent_at)}` : `Started ${day(order.created_at)}${order.creator ? ` by ${order.creator.first_name}` : ""}`}
              {order.received_at && ` · Received ${day(order.received_at)}`}
              {` · usually ${order.supplier.lead_time_days} days to deliver`}
            </span>
          </span>
        }
      />

      {draft && manage ? (
        <>
          <DraftActions orderId={order.id} actionId={order.ai_action_id} />
          <OrderEditor
            orderId={order.id}
            suppliers={suppliers ?? []}
            products={products}
            initial={{ supplierId: order.supplier_id, notes: order.notes ?? "", lines: lines.map((l) => ({ productId: l.product_id, quantity: l.quantity, unitCostCents: l.unit_cost_cents })) }}
          />
          {lines.some((l) => l.reason) && (
            <Card title="Why Denise suggested these" titleId="why-heading">
              <ul className="flex flex-col gap-2 text-sm">
                {lines
                  .filter((l) => l.reason)
                  .map((l) => (
                    <li key={l.id}>
                      <span className="font-medium text-ink">{productName(l.product)}:</span> <span className="text-ink-muted">{l.reason}</span>
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <>
          {(order.status === "sent" || order.status === "partly_received") && (
            <ReceiveForm
              orderId={order.id}
              lines={lines
                .filter((l) => l.received_quantity < l.quantity)
                .map((l) => ({ id: l.id, label: describe(l.product), due: l.quantity - l.received_quantity, container: containerName(l.product) }))}
            />
          )}
          <Card title="Lines" titleId="lines-heading" flush>
            <ul className={listClass} aria-label="Order lines">
              {lines.map((l) => (
                <li key={l.id} className={`${rowClass} flex flex-wrap items-center gap-x-4 gap-y-1`}>
                  <span className="min-w-52 flex-1 font-medium text-ink">{describe(l.product)}</span>
                  <span className="w-40 text-sm text-ink-muted tabular-nums">
                    {l.received_quantity} of {l.quantity} received
                  </span>
                  <span className="w-28 text-sm text-ink-muted tabular-nums">{formatPrice(l.unit_cost_cents)} each</span>
                  <span className="w-24 text-right font-medium text-ink tabular-nums">{formatPrice(l.quantity * l.unit_cost_cents)}</span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between border-t border-line px-4 py-3 font-semibold text-ink">
              <span>Total</span>
              <span className="tabular-nums">{formatPrice(total)}</span>
            </p>
          </Card>
        </>
      )}
    </AppShell>
  );
}
