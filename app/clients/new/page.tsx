import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { getCurrentStaff } from "@/lib/auth";
import { canEditClients } from "@/lib/clients";
import { todayIn } from "@/lib/scheduling/time";
import type { ClientFormFields } from "../actions";
import { ClientForm } from "../client-form";
import { stylistOptions } from "../stylist-options";

export const metadata: Metadata = { title: "Add client · Salon Platform" };

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
  sms_opt_in: false,
  email_opt_in: false,
  consent_signed: false,
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
    <AppShell section="clients" businessName={me.location.business?.name} userName={me.first_name}>
      <Link href="/clients" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Clients
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold">Add client</h1>
      <ClientForm initial={EMPTY} stylists={await stylistOptions(supabase)} today={todayIn(me.location.timezone)} />
    </AppShell>
  );
}
