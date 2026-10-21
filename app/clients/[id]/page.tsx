import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Card, EmptyState, listClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { canEditClients, formatDate } from "@/lib/clients";
import { isUuid } from "@/lib/ids";
import { todayIn } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import type { ClientFormFields } from "../actions";
import { BackLink } from "../back-link";
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
    <AppShell section="clients" me={me}>
      <BackLink href="/clients">Clients</BackLink>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={fullName(client)} size="lg" />
        <div className="min-w-0">
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-plum-900">{fullName(client)}</h1>
          <p className="mt-1 text-ink-muted">{contact || "No contact details"}</p>
        </div>
      </div>

      {client.allergies && (
        <div
          role="note"
          aria-label="Allergies"
          className="mb-6 flex animate-fade-in gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-danger"
        >
          <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-danger font-bold text-white">
            !
          </span>
          <div>
            <p className="text-sm font-semibold">Allergies and sensitivities</p>
            <p>{client.allergies}</p>
          </div>
        </div>
      )}

      <Card
        titleId="formulas-heading"
        title={
          <>
            Color formulas <span className="font-sans text-base font-normal text-ink-muted">({formulas.length})</span>
          </>
        }
        flush
      >
        <FormulaForm clientId={client.id} today={today} />
        {formulas.length === 0 ? (
          <EmptyState>No formulas yet.</EmptyState>
        ) : (
          <ol className={listClass} aria-label="Formula history">
            {formulas.map((f) => (
              <li key={f.id} className="animate-fade-in px-5 py-4">
                <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
                  <span className="font-semibold text-ink">{formatDate(f.visit_date)}</span>
                  <span aria-hidden>·</span>
                  {f.author ? fullName(f.author) : "Unknown"}
                </p>
                <p className="mt-2 rounded-md border-l-4 border-peach-accent bg-peach-fill/40 px-3 py-2 font-mono text-sm whitespace-pre-line text-ink">
                  {f.formula}
                </p>
                {f.notes && <p className="mt-2 text-sm text-ink-muted">{f.notes}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <h2 className="mb-3 font-serif text-2xl font-semibold text-plum-900">Details</h2>
      {editable ? (
        <ClientForm
          key={client.updated_at}
          clientId={client.id}
          initial={toFields(client)}
          stylists={await stylistOptions(supabase, client.preferred_staff_id)}
          today={today}
        />
      ) : (
        <Card>
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
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
        </Card>
      )}
    </AppShell>
  );
}

function Detail({ label, value, empty = "—", wide }: { label: string; value: string | null; empty?: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</dt>
      <dd className={`mt-1 ${value ? "whitespace-pre-line text-ink" : "text-ink-muted"}`}>{value || empty}</dd>
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
