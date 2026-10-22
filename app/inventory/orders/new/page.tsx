import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { canManageInventory } from "@/lib/inventory";
import { orderProducts } from "../load";
import { OrderEditor } from "../order-editor";

export const metadata: Metadata = { title: "New order · Salon Platform" };

export default function NewOrderPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <NewOrder />
    </Suspense>
  );
}

async function NewOrder() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!canManageInventory(me.role)) redirect("/inventory/orders");
  const [{ data: suppliers, error }, products] = await Promise.all([
    supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
    orderProducts(supabase),
  ]);
  if (error) throw error;
  return (
    <AppShell section="inventory" me={me}>
      <BackLink href="/inventory/orders">Orders</BackLink>
      <PageHeader title="New order" />
      <OrderEditor orderId={null} suppliers={suppliers} products={products} initial={{ supplierId: "", notes: "", lines: [] }} />
    </AppShell>
  );
}
