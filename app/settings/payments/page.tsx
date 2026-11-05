import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { PAYMENT_COLUMNS, paymentsStatus } from "@/lib/payments";
import { syncStripeAccount } from "@/lib/payments/connect";
import { can } from "@/lib/permissions";
import { SettingsNav } from "../settings-nav";
import { PaymentsConnection } from "./connection";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsSettingsPage({ searchParams }: { searchParams: Promise<{ stripe?: string }> }) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <PaymentsSettings searchParams={searchParams} />
    </Suspense>
  );
}

// Card payments: the salon's own Stripe account (connected here, through
// Stripe's setup), test mode until it goes live, and Go live (owners).
async function PaymentsSettings({ searchParams }: { searchParams: Promise<{ stripe?: string }> }) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const { stripe } = await searchParams;
  // Back from Stripe's setup: what Stripe says now.
  const back = stripe === "back" || stripe === "again" ? await syncStripeAccount(me.business_id) : null;
  const { data: b, error } = await supabase.from("businesses").select(PAYMENT_COLUMNS).eq("id", me.business_id).single();
  if (error) throw error;
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Payments" description="Cards on file, deposits, fees, payment links and membership renewals go through your own Stripe account. Money goes straight to the salon." />
      <SettingsNav current="payments" me={me} />
      <Card
        title="Card payments"
        titleId="payments-connection-heading"
        description="Until you go live, only test cards work and no money moves. Card numbers go straight to Stripe; Maestra never sees or stores them."
      >
        <PaymentsConnection status={paymentsStatus(b)} canChange={can(me, "billing")} back={back} />
      </Card>
    </AppShell>
  );
}
