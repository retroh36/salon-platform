import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { canManageInventory } from "@/lib/inventory";
import { BackLink } from "@/components/ui/back-link";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Add product" };

export default function NewProductPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <NewProduct />
    </Suspense>
  );
}

async function NewProduct() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!canManageInventory(me.role)) redirect("/inventory");
  const { data: suppliers, error } = await supabase.from("suppliers").select("id, name").eq("is_active", true).order("name");
  if (error) throw error;
  return (
    <AppShell section="inventory" me={me}>
      <BackLink href="/inventory">Inventory</BackLink>
      <PageHeader title="Add product" />
      <ProductForm
        suppliers={suppliers}
        initial={{ brand: "", line: "", name: "", sku: "", barcode: "", type: "back_bar", unit: "g", size: "", cost: "", price: "", shelf: "", supplier_id: "", is_active: true }}
      />
    </AppShell>
  );
}
