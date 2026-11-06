import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { canManageInventory, productName, productTaxOf } from "@/lib/inventory";
import { loadRetailTaxBp, PRODUCT_COLUMNS } from "@/lib/inventory-load";
import { BackLink } from "@/components/ui/back-link";
import { ProductForm, type ProductFormValues } from "../product-form";

export const metadata: Metadata = { title: "Add product" };

const BLANK: ProductFormValues = {
  brand: "",
  line: "",
  name: "",
  sku: "",
  barcode: "",
  other_barcodes: "",
  type: "back_bar",
  unit: "g",
  size: "",
  cost: "",
  price: "",
  employee_price: "",
  tax: "salon",
  tax_percent: "",
  shelf: "",
  supplier_id: "",
  is_active: true,
};

export default function NewProductPage({ searchParams }: PageProps<"/inventory/new">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <NewProduct searchParams={searchParams} />
    </Suspense>
  );
}

// `?copy=<product>` starts from that product, for another size of it: the
// size, cost, price, SKU and barcode are left to fill in.
async function NewProduct({ searchParams }: Pick<PageProps<"/inventory/new">, "searchParams">) {
  const [{ copy }, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!canManageInventory(me.role)) redirect("/inventory");
  const copyId = typeof copy === "string" && isUuid(copy) ? copy : null;
  const [{ data: suppliers, error }, { data: from, error: fromError }, retailTaxBp] = await Promise.all([
    supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
    copyId ? supabase.from("products").select(PRODUCT_COLUMNS).eq("id", copyId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    loadRetailTaxBp(supabase, me.business_id),
  ]);
  if (error) throw error;
  if (fromError) throw fromError;
  const initial: ProductFormValues = from
    ? { ...BLANK, brand: from.brand, line: from.line ?? "", name: from.name, type: from.type, unit: from.unit, shelf: from.shelf ?? "", supplier_id: from.supplier_id ?? "", tax: productTaxOf(from.tax_rate_bp), tax_percent: from.tax_rate_bp ? String(from.tax_rate_bp / 100) : "" }
    : BLANK;
  return (
    <AppShell section="inventory" me={me}>
      <BackLink href={from ? `/inventory/${from.id}` : "/inventory"}>{from ? productName(from) : "Inventory"}</BackLink>
      <PageHeader
        title={from ? "Add another size" : "Add product"}
        description={
          from
            ? from.unit === "unit"
              ? `A copy of ${productName(from)}. Put the new size in the name (like “1 L”), then its cost, price and codes.`
              : `A copy of ${productName(from)}. Enter the new container size, its cost and codes.`
            : undefined
        }
      />
      {/* A new form for each product copied: the same page with other defaults
          keeps the form's own state and its select's choice otherwise. */}
      <ProductForm key={from?.id ?? "new"} suppliers={suppliers} initial={initial} retailTaxBp={retailTaxBp} />
    </AppShell>
  );
}
