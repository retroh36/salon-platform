import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { canEditClients } from "@/lib/clients";
import { isUuid } from "@/lib/ids";
import { todayIn } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import type { ClientFormFields } from "../../actions";
import { ClientForm } from "../../client-form";
import { stylistOptions } from "../../stylist-options";

export const metadata: Metadata = { title: "Edit client" };

// "Edit details" on the profile (front of house): contact, birthday,
// offers, allergies, stylist, preferences and the consent form. Notes are
// edited on the profile itself.
export default function EditClientPage({ params }: PageProps<"/clients/[id]/edit">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <EditClient params={params} />
    </Suspense>
  );
}

async function EditClient({ params }: Pick<PageProps<"/clients/[id]/edit">, "params">) {
  const [{ id }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isUuid(id)) notFound();
  if (!canEditClients(me.role)) redirect(`/clients/${id}`);
  const { data: client, error } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!client) notFound();

  return (
    <AppShell section="clients" me={me}>
      <BackLink href={`/clients/${id}`}>{fullName(client)}</BackLink>
      <PageHeader title="Edit details" />
      <ClientForm key={client.updated_at} clientId={client.id} initial={toFields(client)} stylists={await stylistOptions(supabase, client.preferred_staff_id)} today={todayIn(me.location.timezone)} />
    </AppShell>
  );
}

function toFields(client: {
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  preferred_staff_id: string | null;
  preferences: string | null;
  notes: string | null;
  allergies: string | null;
  consent_signed_on: string | null;
  sms_opt_in: boolean;
  email_opt_in: boolean;
  birth_month: number | null;
  birth_day: number | null;
}): ClientFormFields {
  return {
    first_name: client.first_name,
    last_name: client.last_name,
    email: client.email ?? "",
    phone: client.phone ?? "",
    preferred_staff_id: client.preferred_staff_id ?? "",
    preferences: client.preferences ?? "",
    notes: client.notes ?? "",
    allergies: client.allergies ?? "",
    consent_signed_on: client.consent_signed_on ?? "",
    sms_opt_in: client.sms_opt_in,
    email_opt_in: client.email_opt_in,
    consent_signed: client.consent_signed_on !== null,
    birth_month: client.birth_month ? String(client.birth_month) : "",
    birth_day: client.birth_day ? String(client.birth_day) : "",
  };
}
