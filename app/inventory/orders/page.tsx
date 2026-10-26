import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { buttonClass } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { Badge, EmptyState, nameLinkClass, PageHeader } from "@/components/ui/page";
import { numClass, TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
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
      {orders.length === 0 ? (
        <TableCard>
          <EmptyState>No orders yet.</EmptyState>
        </TableCard>
      ) : (
        <TableCard>
          <table className={tableClass} aria-label="Orders">
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  Order
                </th>
                <th scope="col" className={thClass}>
                  Supplier
                </th>
                <th scope="col" className={thClass}>
                  Status
                </th>
                <th scope="col" className={`${thClass} hidden sm:table-cell`}>
                  Date
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className={trClass}>
                  <td className={`${tdClass} whitespace-nowrap text-ink-muted tabular-nums`}>{orderNumber(o.number)}</td>
                  <td className={tdClass}>
                    <Link href={`/inventory/orders/${o.id}`} className={nameLinkClass}>
                      {o.supplier.name}
                    </Link>
                    {o.ai_action_id && <span className="block text-xs text-denise-700">Drafted by Denise</span>}
                  </td>
                  <td className={tdClass}>
                    <Badge tone={ORDER_STATUS_TONES[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                  </td>
                  <td className={`${tdClass} hidden whitespace-nowrap text-ink-muted sm:table-cell`}>{o.sent_at ? `Sent ${day(o.sent_at)}` : `Started ${day(o.created_at)}`}</td>
                  <td className={`${tdClass} ${numClass} font-medium text-ink`}>{formatPrice(o.purchase_order_lines.reduce((sum, l) => sum + l.quantity * l.unit_cost_cents, 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </AppShell>
  );
}
