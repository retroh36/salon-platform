import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { BackLink } from "@/components/ui/back-link";
import { getCurrentStaff } from "@/lib/auth";
import { canEditClients } from "@/lib/clients";
import { todayIn } from "@/lib/scheduling/time";
import type { ClientFormFields } from "../actions";
import { ClientForm } from "../client-form";
import { stylistOptions } from "../stylist-options";

export const metadata: Metadata = { title: "Add client" };

const EMPTY: ClientFormFields = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  preferred_staff_id: "",
  preferences: "",
  notes: "",
  allergies: "",
  consent_signed_on: "",
  birth_month: "",
  birth_day: "",
  sms_opt_in: false,
  email_opt_in: false,
  consent_signed: false,
  only_sees_preferred: false,
};

export default function NewClientPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <NewClient />
    </Suspense>
  );
}

async function NewClient() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!canEditClients(me.role)) redirect("/clients");

  return (
    <AppShell section="clients" me={me}>
      <BackLink href="/clients">Clients</BackLink>
      <PageHeader title="Add client" description="Name and a way to reach them are enough to start; the rest can come later." />
      <ClientForm initial={EMPTY} stylists={await stylistOptions(supabase)} today={todayIn(me.location.timezone)} />
    </AppShell>
  );
}
