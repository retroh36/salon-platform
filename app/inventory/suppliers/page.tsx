import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { numClass, TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { canManageInventory } from "@/lib/inventory";
import { SupplierForm } from "./supplier-form";

export const metadata: Metadata = { title: "Suppliers" };

export default function SuppliersPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Suppliers />
    </Suspense>
  );
}

async function Suppliers() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  const { data: suppliers, error } = await supabase.from("suppliers").select("*, products(id)").order("name");
  if (error) throw error;
  return (
    <AppShell section="inventory" me={me}>
      <BackLink href="/inventory">Inventory</BackLink>
      <PageHeader title="Suppliers" description="Where products come from, and how long deliveries take." />
      {canManageInventory(me.role) && <SupplierForm />}
      {suppliers.length === 0 ? (
        <TableCard>
          <EmptyState>No suppliers yet.</EmptyState>
        </TableCard>
      ) : (
        <TableCard>
          <table className={tableClass} aria-label="Suppliers">
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  Supplier
                </th>
                <th scope="col" className={`${thClass} hidden md:table-cell`}>
                  Contact
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Delivers in
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Products
                </th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className={trClass}>
                  <td className={tdClass}>
                    <span className="font-medium text-ink">{s.name}</span>
                    {s.notes && <span className="block text-13 text-ink-muted">{s.notes}</span>}
                  </td>
                  <td className={`${tdClass} hidden text-ink-muted md:table-cell`}>{[s.email, s.phone, s.account_number && `Account ${s.account_number}`].filter(Boolean).join(" · ")}</td>
                  <td className={`${tdClass} ${numClass} text-ink-muted`}>
                    {s.lead_time_days} {s.lead_time_days === 1 ? "day" : "days"}
                  </td>
                  <td className={`${tdClass} ${numClass} text-ink-muted`}>{s.products.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </AppShell>
  );
}
