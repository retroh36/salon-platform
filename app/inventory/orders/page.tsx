import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { buttonClass } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { Badge, Card, EmptyState, listClass, PageHeader, rowLinkClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { canManageInventory, canReceiveOrders } from "@/lib/inventory";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES, orderNumber } from "@/lib/purchase-orders";
import { formatDay } from "@/lib/schedule-format";
import { toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Orders />
    </Suspense>
  );
}

async function Orders() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!canReceiveOrders(me.role)) redirect("/inventory");
  const { data: orders, error } = await supabase
    .from("purchase_orders")
    .select("id, number, status, created_at, sent_at, ai_action_id, supplier:suppliers(name), purchase_order_lines(quantity, unit_cost_cents)")
    .eq("location_id", me.location.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const day = (at: string) => formatDay(toLocal(new Date(at), me.location.timezone).date);

  return (
    <AppShell section="inventory" me={me}>
      <BackLink href="/inventory">Inventory</BackLink>
      <PageHeader
        title="Orders"
        description="Purchase orders to suppliers. Receive deliveries here to add them to stock."
        actions={
          canManageInventory(me.role) && (
            <Link href="/inventory/orders/new" className={buttonClass("primary", "md")}>
              <PlusIcon className="size-4" />
              New order
            </Link>
          )
        }
      />
      <Card flush>
        {orders.length === 0 ? (
          <EmptyState>No orders yet.</EmptyState>
        ) : (
          <ul className={listClass} aria-label="Orders">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/inventory/orders/${o.id}`} className={rowLinkClass}>
                  <span className="w-24 font-semibold text-ink tabular-nums">{orderNumber(o.number)}</span>
                  <span className="min-w-48 flex-1 text-ink">
                    {o.supplier.name}
                    {o.ai_action_id && <span className="ml-2 text-sm text-denise-700">Drafted by Denise</span>}
                  </span>
                  <Badge tone={ORDER_STATUS_TONES[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                  <span className="w-32 text-sm text-ink-muted">{o.sent_at ? `Sent ${day(o.sent_at)}` : `Started ${day(o.created_at)}`}</span>
                  <span className="w-24 text-right text-sm font-medium text-ink tabular-nums">
                    {formatPrice(o.purchase_order_lines.reduce((sum, l) => sum + l.quantity * l.unit_cost_cents, 0))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
