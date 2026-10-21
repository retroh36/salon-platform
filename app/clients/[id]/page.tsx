import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { getCurrentStaff } from "@/lib/auth";
import { canEditClients, formatDate } from "@/lib/clients";
import { isUuid } from "@/lib/ids";
import { todayIn } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import type { ClientFormFields } from "../actions";
import { ClientForm } from "../client-form";
import { FormulaForm } from "../formula-form";
import { stylistOptions } from "../stylist-options";

export const metadata: Metadata = { title: "Client · Salon Platform" };

export default function ClientPage({ params }: PageProps<"/clients/[id]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <ClientProfile params={params} />
    </Suspense>
  );
}

async function ClientProfile({ params }: Pick<PageProps<"/clients/[id]">, "params">) {
  const [{ id }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isUuid(id)) notFound();

  const [{ data: client, error }, { data: formulas, error: formulaError }] = await Promise.all([
    supabase
      .from("clients")
      .select("*, preferred:staff(first_name, last_name, is_active)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("client_formulas")
      .select("id, visit_date, formula, notes, created_at, author:staff(first_name, last_name)")
      .eq("client_id", id)
      .order("visit_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  if (error) throw error;
  if (formulaError) throw formulaError;
  if (!client) notFound();

  const editable = canEditClients(me.role);
  const today = todayIn(me.location.timezone);
  const contact = [client.phone, client.email].filter(Boolean).join(" · ");

  return (
    <AppShell section="clients" businessName={me.location.business?.name} userName={me.first_name}>
      <Link href="/clients" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Clients
      </Link>
      <div className="mt-2 mb-6">
        <h1 className="text-2xl font-semibold">{fullName(client)}</h1>
        <p className="text-sm text-neutral-500">{contact || "No contact details"}</p>
      </div>

      {client.allergies && (
        <div role="note" aria-label="Allergies" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          <p className="text-sm font-semibold">Allergies and sensitivities</p>
          <p>{client.allergies}</p>
        </div>
      )}

      <section aria-labelledby="formulas-heading" className="mb-8 rounded-xl border border-neutral-200 bg-white">
        <h2 id="formulas-heading" className="border-b border-neutral-200 px-5 py-3 font-medium">
          Color formulas <span className="text-neutral-500">({formulas.length})</span>
        </h2>
        <FormulaForm clientId={client.id} today={today} />
        {formulas.length === 0 ? (
          <p className="px-5 py-4 text-sm text-neutral-500">No formulas yet.</p>
        ) : (
          <ol className="divide-y divide-neutral-100" aria-label="Formula history">
            {formulas.map((f) => (
              <li key={f.id} className="px-5 py-4">
                <p className="text-sm text-neutral-500">
                  {formatDate(f.visit_date)} · {f.author ? fullName(f.author) : "Unknown"}
                </p>
                <p className="mt-1 whitespace-pre-line">{f.formula}</p>
                {f.notes && <p className="mt-1 text-sm text-neutral-600">{f.notes}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <h2 className="mb-3 text-lg font-semibold">Details</h2>
      {editable ? (
        <ClientForm
          key={client.updated_at}
          clientId={client.id}
          initial={toFields(client)}
          stylists={await stylistOptions(supabase, client.preferred_staff_id)}
          today={today}
        />
      ) : (
        <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-neutral-200 bg-white p-5 sm:grid-cols-2">
          <Detail label="Phone" value={client.phone} />
          <Detail label="Email" value={client.email} />
          <Detail
            label="Preferred stylist"
            value={client.preferred ? fullName(client.preferred) : null}
            empty="No preference"
          />
          <Detail label="Preferences" value={client.preferences} />
          <Detail label="Notes" value={client.notes} wide />
          <Detail
            label="Consent form"
            value={client.consent_signed_on ? `Signed ${formatDate(client.consent_signed_on)}` : null}
            empty="Not signed"
          />
          <Detail
            label="Messages"
            value={
              [client.sms_opt_in && "Texts OK", client.email_opt_in && "Marketing emails OK"].filter(Boolean).join(" · ") ||
              null
            }
            empty="No marketing"
          />
        </dl>
      )}
    </AppShell>
  );
}

function Detail({ label, value, empty = "—", wide }: { label: string; value: string | null; empty?: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-sm text-neutral-500">{label}</dt>
      <dd className={value ? "whitespace-pre-line" : "text-neutral-400"}>{value || empty}</dd>
    </div>
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
  };
}
