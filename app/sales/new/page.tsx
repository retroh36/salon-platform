import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { canTakePayments, loadCheckout } from "@/lib/sales";
import { CheckoutForm } from "../checkout-form";

export const metadata: Metadata = { title: "New sale" };

export default function NewSalePage({ searchParams }: PageProps<"/sales/new">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <NewSale searchParams={searchParams} />
    </Suspense>
  );
}

// Retail on its own (or anything else sold without a visit).
async function NewSale({ searchParams }: Pick<PageProps<"/sales/new">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!canTakePayments(me.role)) redirect("/dashboard");
  const data = (await loadCheckout(supabase, me, null))!;
  const product = typeof params.product === "string" && isUuid(params.product) ? params.product : undefined;
  return (
    <AppShell section="sales" me={me}>
      <PageHeader title="New sale" description="Products, without a visit. Visits are checked out from the calendar." />
      <div className="max-w-lg rounded-xl border border-line bg-surface p-5 shadow-card">
        <CheckoutForm data={data} initialProductId={product} />
      </div>
    </AppShell>
  );
}
