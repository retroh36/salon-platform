import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { canManageInventory, productName } from "@/lib/inventory";
import { ProductForm } from "../../product-form";

export const metadata: Metadata = { title: "Edit product" };

const money = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

export default function EditProductPage({ params }: PageProps<"/inventory/[id]/edit">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <EditProduct params={params} />
    </Suspense>
  );
}

async function EditProduct({ params }: Pick<PageProps<"/inventory/[id]/edit">, "params">) {
  const [{ id }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isUuid(id)) notFound();
  if (!canManageInventory(me.role)) redirect(`/inventory/${id}`);
  const [{ data: product, error }, { data: suppliers, error: supplierError }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).maybeSingle(),
    supabase.from("suppliers").select("id, name").order("name"),
  ]);
  if (error) throw error;
  if (supplierError) throw supplierError;
  if (!product) notFound();
  return (
    <AppShell section="inventory" me={me}>
      <BackLink href={`/inventory/${id}`}>{productName(product)}</BackLink>
      <PageHeader title="Edit product" />
      <ProductForm
        suppliers={suppliers}
        initial={{
          product_id: product.id,
          brand: product.brand,
          line: product.line ?? "",
          name: product.name,
          sku: product.sku ?? "",
          barcode: product.barcode ?? "",
          type: product.type,
          unit: product.unit,
          size: String(product.size),
          cost: money(product.cost_cents),
          price: money(product.price_cents),
          shelf: product.shelf ?? "",
          supplier_id: product.supplier_id ?? "",
          is_active: product.is_active,
        }}
      />
    </AppShell>
  );
}
