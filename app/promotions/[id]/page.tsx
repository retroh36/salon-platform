import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PROMOTION_COLUMNS, promotionInput, type PromotionRow } from "@/lib/promotions";
import { formOptions } from "../form-options";
import { PromotionForm } from "../promotion-form";

export const metadata: Metadata = { title: "Edit promotion" };

export default function EditPromotionPage({ params }: PageProps<"/promotions/[id]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <EditPromotion params={params} />
    </Suspense>
  );
}

// Changes apply from now on; sales that used it keep what they took off.
async function EditPromotion({ params }: Pick<PageProps<"/promotions/[id]">, "params">) {
  const [{ id }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/promotions");
  const { data } = await supabase.from("promotions").select(PROMOTION_COLUMNS).eq("id", id).eq("business_id", me.business_id).is("archived_at", null).maybeSingle();
  if (!data) notFound();
  const row = data as unknown as PromotionRow;
  return (
    <AppShell section="promotions" me={me}>
      <PageHeader title={row.name} description="Changes apply from now on. Sales that already used it keep what it took off." />
      <PromotionForm id={row.id} initial={promotionInput(row)} options={await formOptions(supabase, me.business_id)} />
    </AppShell>
  );
}
