import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { Card, EmptyState, listClass, PageHeader, rowClass } from "@/components/ui/page";
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
      <Card flush>
        {suppliers.length === 0 ? (
          <EmptyState>No suppliers yet.</EmptyState>
        ) : (
          <ul className={listClass} aria-label="Suppliers">
            {suppliers.map((s) => (
              <li key={s.id} className={`${rowClass} flex flex-wrap items-baseline gap-x-4 gap-y-1`}>
                <span className="min-w-52 flex-1 font-semibold text-ink">{s.name}</span>
                <span className="text-sm text-ink-muted">{[s.email, s.phone, s.account_number && `Account ${s.account_number}`].filter(Boolean).join(" · ")}</span>
                <span className="w-40 text-sm text-ink-muted">
                  {s.lead_time_days} {s.lead_time_days === 1 ? "day" : "days"} to deliver · {s.products.length} products
                </span>
                {s.notes && <p className="w-full text-sm text-ink-muted">{s.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
