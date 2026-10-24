import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { centsToInput } from "@/lib/services";
import { SettingsNav } from "../settings-nav";
import { CheckoutSettingsForm } from "./checkout-settings";

export const metadata: Metadata = { title: "Tax and receipts" };

export default function CheckoutSettingsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <CheckoutSettings />
    </Suspense>
  );
}

const percent = (bp: number) => String(bp / 100);

async function CheckoutSettings() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (me.role !== "owner") redirect("/dashboard");
  const { data: b, error } = await supabase
    .from("businesses")
    .select("tax_rate_services_bp, tax_rate_retail_bp, discount_roles, discount_max_percent, receipt_footer, receipt_show_stylists, cash_float_cents")
    .eq("id", me.business_id)
    .single();
  if (error) throw error;
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Settings" description="Tax, discounts, receipts and the cash drawer." />
      <SettingsNav current="checkout" />
      <Card>
        <CheckoutSettingsForm
          initial={{
            taxServicesPercent: percent(b.tax_rate_services_bp),
            taxRetailPercent: percent(b.tax_rate_retail_bp),
            discountRoles: b.discount_roles,
            discountMaxPercent: String(b.discount_max_percent),
            receiptFooter: b.receipt_footer ?? "",
            receiptShowStylists: b.receipt_show_stylists,
            cashFloat: centsToInput(b.cash_float_cents),
          }}
        />
      </Card>
    </AppShell>
  );
}
