import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { salonLogoUrl } from "@/lib/branding";
import { SalonSettings } from "./salon-settings";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const { staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (me.role !== "owner") redirect("/dashboard");
  const business = me.location.business;

  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Settings" description="Your salon's name and logo, shown to your team and on messages to your clients." />
      <Card title="Your salon" titleId="salon-heading">
        <SalonSettings name={business?.name ?? ""} logoUrl={salonLogoUrl(business?.logo_path)} />
      </Card>
    </AppShell>
  );
}
