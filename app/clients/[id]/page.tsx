import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Card, EmptyState, listClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { ClientInsightCard } from "@/components/client-insight";
import { describeClient } from "@/lib/insights/describe";
import { loadClientInsights } from "@/lib/insights/read";
import { loadClientPackages, withPackages } from "@/lib/packages";
import { PackagesList } from "./packages/packages-card";
import { PhotoGallery } from "@/components/visit-photos";
import { loadPhotos } from "@/lib/photos-load";
import { canEditClients, formatDate } from "@/lib/clients";
import { isUuid } from "@/lib/ids";
import { BackLink } from "@/components/ui/back-link";
import { formatAmount, productName } from "@/lib/inventory";
import { loadBackBarProducts } from "@/lib/inventory-load";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, todayIn, toLocal } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import type { ClientFormFields } from "../actions";
import { ClientForm } from "../client-form";
import { FormulaForm, type VisitOption } from "../formula-form";
import { stylistOptions } from "../stylist-options";
import { PatchTestForm } from "../patch-test-form";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/page";
import { patchSettings } from "@/lib/client-checks";
import { patchTestMessage, patchTestState } from "@/lib/scheduling/patch-tests";

export const metadata: Metadata = { title: "Client" };

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

  const tz = me.location.timezone;
  const today = todayIn(tz);
  const [{ data: client, error }, { data: formulas, error: formulaError }, { data: items, error: itemError }, products] = await Promise.all([
    supabase
      .from("clients")
      .select("*, preferred:staff!clients_preferred_staff_id_business_id_fkey(first_name, last_name, is_active)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("client_formulas")
      .select(
        "id, visit_date, formula, notes, created_at, author:staff(first_name, last_name), item:appointment_items(service:services(name)), formula_products(amount, position, product:products(brand, line, name, unit))",
      )
      .eq("client_id", id)
      .order("visit_date", { ascending: false })
      .order("created_at", { ascending: false }),
    // Services on visits from the last 60 days, for linking a formula.
    supabase
      .from("appointment_items")
      .select("id, starts_at, service:services(name), stylist:staff(first_name), appointment:appointments!inner(client_id, status)")
      .eq("appointment.client_id", id)
      .neq("appointment.status", "canceled")
      .gte("starts_at", startOfLocalDay(addDays(today, -60), tz).toISOString())
      .lt("starts_at", startOfLocalDay(addDays(today, 1), tz).toISOString())
      .order("starts_at", { ascending: false })
      .limit(20),
    loadBackBarProducts(supabase),
  ]);
  const [{ data: patchTests, error: patchError }, { data: forms, error: formsError }, { data: team, error: teamError }, settings, insights] = await Promise.all([
    supabase.from("client_patch_tests").select("id, tested_at, products, result, notes, staff(first_name, last_name)").eq("client_id", id).order("tested_at", { ascending: false }),
    supabase.from("client_forms").select("id, template_name, signed_at").eq("client_id", id).order("signed_at", { ascending: false }),
    supabase.from("staff").select("id, first_name, last_name").eq("is_active", true).order("first_name"),
    patchSettings(supabase, me.business_id),
    loadClientInsights(supabase, me.business_id, [id]),
  ]);
  const [packages, gallery] = await Promise.all([loadClientPackages(supabase, id), loadPhotos(supabase, me, { clientId: id })]);
  if (patchError) throw patchError;
  if (formsError) throw formsError;
  if (teamError) throw teamError;
  if (error) throw error;
  if (formulaError) throw formulaError;
  if (itemError) throw itemError;
  if (!client) notFound();

  const visits: VisitOption[] = items.map((i) => {
    const local = toLocal(new Date(i.starts_at), tz);
    return { itemId: i.id, date: local.date, label: `${formatDate(local.date)} · ${i.service.name} with ${i.stylist.first_name}` };
  });

  const editable = canEditClients(me.role);
  const known = insights.get(id);
  const names = new Map(team.map((t) => [t.id, t.first_name]));
  const insight = withPackages(
    known ? describeClient(known.habits, known.spend, { staff: (s) => names.get(s) ?? null, dayOf: (iso) => formatDate(toLocal(new Date(iso), tz).date) }, new Date()) : null,
    packages,
  );
  const contact = [client.phone, client.email].filter(Boolean).join(" · ");

  return (
    <AppShell section="clients" me={me}>
      <BackLink href="/clients">Clients</BackLink>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={fullName(client)} size="lg" />
        <div className="min-w-0">
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-navy-900">{fullName(client)}</h1>
          <p className="mt-1 text-ink-muted">{contact || "No contact details"}</p>
        </div>
      </div>

      {insight && (
        <div className="mb-6">
          <ClientInsightCard insight={insight} />
        </div>
      )}

      {packages.length > 0 && (
        <Card title="Packages" titleId="packages-heading" description="Uses left are offered at checkout.">
          <PackagesList
            clientId={id}
            packages={packages}
            canCancel={me.role === "owner" || me.role === "manager"}
            expiresLabels={Object.fromEntries(packages.flatMap((p) => (p.expiresAt ? [[p.id, formatDate(toLocal(new Date(p.expiresAt), tz).date)]] : [])))}
          />
        </Card>
      )}

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
        titleId="patch-heading"
        title="Patch tests"
        description={(() => {
          const state = patchTestState(
            patchTests.map((t) => ({ testedAt: new Date(t.tested_at), result: t.result })),
            new Date(),
            { ...settings, minHours: 0 },
          );
          return state === "ok" ? "Valid today for services that need one." : patchTestMessage(state, settings).replace(" before this visit", " ago");
        })()}
        flush
      >
        <PatchTestForm clientId={client.id} today={today} me={me.id} staff={team.map((s) => ({ id: s.id, name: fullName(s) }))} />
        {patchTests.length === 0 ? (
          <EmptyState>No patch tests recorded.</EmptyState>
        ) : (
          <ol className={listClass} aria-label="Patch test history">
            {patchTests.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
                <span>
                  <span className="font-semibold text-ink">{formatDate(toLocal(new Date(t.tested_at), tz).date)}</span>
                  <span className="text-ink-muted"> · {t.products} · {fullName(t.staff)}</span>
                  {t.notes && <span className="block text-sm text-ink-muted">{t.notes}</span>}
                </span>
                <Badge tone={t.result === "reaction" ? "red" : "green"}>{t.result === "reaction" ? "Reaction" : "No reaction"}</Badge>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card
        titleId="forms-heading"
        title="Signed forms"
        actions={
          <Link href={`/clients/${client.id}/forms/new`} className={buttonClass("secondary", "sm")}>
            Fill in a form
          </Link>
        }
        flush
      >
        {forms.length === 0 ? (
          <EmptyState>No signed forms.</EmptyState>
        ) : (
          <ul className={listClass} aria-label="Signed forms">
            {forms.map((f) => (
              <li key={f.id}>
                <Link href={`/clients/${client.id}/forms/${f.id}`} className="flex justify-between gap-2 px-5 py-3.5 transition-colors duration-(--motion-fast) hover:bg-sunken/60">
                  <span className="font-semibold text-ink">{f.template_name}</span>
                  <span className="text-ink-muted">Signed {formatDate(toLocal(new Date(f.signed_at), tz).date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        titleId="formulas-heading"
        title={
          <>
            Color formulas <span className="font-sans text-base font-normal text-ink-muted">({formulas.length})</span>
          </>
        }
        flush
      >
        <FormulaForm clientId={client.id} today={today} visits={visits} products={products} />
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
                {f.formula_products.length > 0 && (
                  <p className="mt-2 text-sm text-ink" data-testid="formula-products">
                    <span className="font-medium text-ink-muted">{f.item ? `${f.item.service.name}: ` : "Products: "}</span>
                    {[...f.formula_products]
                      .sort((a, b) => a.position - b.position)
                      .map((fp) => `${formatAmount(fp.amount, fp.product.unit)} ${productName(fp.product)}`)
                      .join(" + ")}
                  </p>
                )}
                {f.notes && <p className="mt-2 text-sm text-ink-muted">{f.notes}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card
        titleId="photos-heading"
        title={
          <>
            Before and after <span className="font-sans text-base font-normal text-ink-muted">({gallery.photos.length})</span>
          </>
        }
        description="Saved to each visit. Only your salon can see them."
      >
        <PhotoGallery clientId={client.id} photos={gallery.photos} consent={gallery.consent} today={today} />
      </Card>

      <h2 className="mb-3 font-serif text-2xl font-semibold text-navy-900">Details</h2>
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
