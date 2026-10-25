import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { NEW_PROMOTION } from "@/lib/promotions";
import { formOptions } from "../form-options";
import { PromotionForm } from "../promotion-form";

export const metadata: Metadata = { title: "New promotion" };

export default function NewPromotionPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <NewPromotion />
    </Suspense>
  );
}

async function NewPromotion() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/promotions");
  return (
    <AppShell section="promotions" me={me}>
      <PageHeader title="New promotion" description="A code, an offer that applies itself at checkout, or a last-minute special for open time." />
      <PromotionForm id={null} initial={NEW_PROMOTION} options={await formOptions(supabase, me.business_id)} />
    </AppShell>
  );
}
