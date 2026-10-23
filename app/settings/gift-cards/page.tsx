import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Alert, Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { centsToInput } from "@/lib/services";
import { SettingsNav } from "../settings-nav";
import { GiftCardSettingsForm } from "./gift-card-settings";

export const metadata: Metadata = { title: "Gift card settings" };

export default function GiftCardSettingsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <GiftCardSettings />
    </Suspense>
  );
}

async function GiftCardSettings() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (me.role !== "owner") redirect("/dashboard");
  const { data: b, error } = await supabase.from("businesses").select("gift_card_presets_cents, gift_card_expiry_months, promo_card_expiry_days").eq("id", me.business_id).single();
  if (error) throw error;
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Settings" description="Gift cards sold at the front desk, and promotional cards." />
      <SettingsNav current="gift-cards" />
      <Alert tone="info" className="mb-6">
        Gift card rules (how long cards must last, whether fees are allowed, and what happens to unused balances) vary by state. Check your local law before setting an
        expiry date.
      </Alert>
      <Card>
        <GiftCardSettingsForm
          initial={{
            presets: b.gift_card_presets_cents.map(centsToInput).join(", "),
            expiryMonths: b.gift_card_expiry_months ? String(b.gift_card_expiry_months) : "",
            promoDays: String(b.promo_card_expiry_days),
          }}
        />
      </Card>
    </AppShell>
  );
}
