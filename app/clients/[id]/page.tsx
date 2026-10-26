import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge, EmptyState, nameLinkClass, Section } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { ClientInsightCard } from "@/components/client-insight";
import { describeClient } from "@/lib/insights/describe";
import { loadClientInsights } from "@/lib/insights/read";
import { loadClientPackages, withPackages } from "@/lib/packages";
import { PackagesList } from "./packages/packages-card";
import { PhotoGallery } from "@/components/visit-photos";
import { MembershipList, type MembershipHistory } from "./memberships/membership-card";
import { PolicyCard } from "./policy-card";
import { MessagesCard } from "./messages-card";
import { historyText } from "@/lib/memberships";
import { loadClientMemberships } from "@/lib/memberships-load";
import { currentProvider } from "@/lib/payments";
import { canTakePayments } from "@/lib/sales";
import { formatPrice } from "@/lib/services";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadPhotos } from "@/lib/photos-load";
import { canEditClients, formatDate, MONTHS } from "@/lib/clients";
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
  const [packages, gallery, memberships, { data: onlineAccount }] = await Promise.all([
    loadClientPackages(supabase, id),
    loadPhotos(supabase, me, { clientId: id }),
    loadClientMemberships(supabase, id),
    // Front of house can see whether they have an account on the booking site.
    supabase.from("client_accounts").select("last_sign_in_at").eq("client_id", id).maybeSingle(),
  ]);
  const membershipHistory = await loadMembershipHistory(supabase, memberships.map((m) => m.id), tz);
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

  const patchState = patchTestState(
    patchTests.map((t) => ({ testedAt: new Date(t.tested_at), result: t.result })),
    new Date(),
    { ...settings, minHours: 0 },
  );

  return (
    <AppShell section="clients" me={me}>
      <BackLink href="/clients">Clients</BackLink>
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={fullName(client)} size="lg" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-0.015em] text-ink">{fullName(client)}</h1>
          <p className="mt-1 text-sm text-ink-muted">{contact || "No contact details"}</p>
          {onlineAccount && (
            <p className="mt-0.5 text-13 text-ink-subtle" data-testid="online-account">
              Has an online account{onlineAccount.last_sign_in_at ? `, last signed in ${formatDate(toLocal(new Date(onlineAccount.last_sign_in_at), tz).date)}` : ""}
            </p>
          )}
        </div>
      </header>

      {client.allergies && (
        <div role="note" aria-label="Allergies" className="mb-6 flex animate-fade-in items-start gap-2.5 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-danger-dot" />
          <div className="min-w-0">
            <p className="font-semibold">Allergies and sensitivities</p>
            <p className="whitespace-pre-line">{client.allergies}</p>
          </div>
        </div>
      )}

      {insight && (
        <div className="mb-8">
          <ClientInsightCard insight={insight} />
        </div>
      )}

      {packages.length > 0 && (
        <Section title="Packages" titleId="packages-heading" description="Uses left are offered at checkout.">
          <PackagesList
            clientId={id}
            packages={packages}
            canCancel={me.role === "owner" || me.role === "manager"}
            expiresLabels={Object.fromEntries(packages.flatMap((p) => (p.expiresAt ? [[p.id, formatDate(toLocal(new Date(p.expiresAt), tz).date)]] : [])))}
          />
        </Section>
      )}

      {memberships.length > 0 && (
        <Section title="Membership" titleId="membership-heading" description="Member prices and included services apply at checkout automatically.">
          <MembershipList
            memberships={memberships}
            history={membershipHistory}
            today={today}
            canChange={canTakePayments(me.role)}
            canEndNow={me.role === "owner" || me.role === "manager"}
            testCards={currentProvider().testCards.map((c) => ({ ...c }))}
          />
        </Section>
      )}

      {canTakePayments(me.role) && <PolicyCard supabase={supabase} businessId={me.business_id} role={me.role} client={client} tz={tz} />}
      {canTakePayments(me.role) && <MessagesCard supabase={supabase} clientId={client.id} firstName={client.first_name} tz={tz} />}

      <Section
        titleId="patch-heading"
        title="Patch tests"
        count={patchTests.length}
        description={patchState === "ok" ? "Valid today for services that need one." : patchTestMessage(patchState, settings).replace(" before this visit", " ago")}
      >
        <PatchTestForm clientId={client.id} today={today} me={me.id} staff={team.map((s) => ({ id: s.id, name: fullName(s) }))} />
        {patchTests.length === 0 ? (
          <EmptyState art={false} className="border-t border-line">No patch tests recorded.</EmptyState>
        ) : (
          <ol className={recordsClass} aria-label="Patch test history">
            {patchTests.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
                <span className="min-w-0">
                  <span className="font-medium text-ink">{formatDate(toLocal(new Date(t.tested_at), tz).date)}</span>
                  <span className="text-ink-muted"> · {t.products} · {fullName(t.staff)}</span>
                  {t.notes && <span className="mt-0.5 block text-13 text-ink-muted">{t.notes}</span>}
                </span>
                <Badge tone={t.result === "reaction" ? "danger" : "success"}>{t.result === "reaction" ? "Reaction" : "No reaction"}</Badge>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section
        titleId="forms-heading"
        title="Signed forms"
        count={forms.length}
        actions={
          <Link href={`/clients/${client.id}/forms/new`} className={buttonClass("secondary", "sm")}>
            Fill in a form
          </Link>
        }
      >
        {forms.length === 0 ? (
          <EmptyState art={false} className="border-t border-line">No signed forms.</EmptyState>
        ) : (
          <ul className={recordsClass} aria-label="Signed forms">
            {forms.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                <Link href={`/clients/${client.id}/forms/${f.id}`} className={nameLinkClass}>
                  {f.template_name}
                </Link>
                <span className="text-13 text-ink-muted">Signed {formatDate(toLocal(new Date(f.signed_at), tz).date)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section titleId="formulas-heading" title="Color formulas" count={formulas.length}>
        <FormulaForm clientId={client.id} today={today} visits={visits} products={products} />
        {formulas.length === 0 ? (
          <EmptyState art={false} className="border-t border-line">No formulas yet.</EmptyState>
        ) : (
          <ol className={recordsClass} aria-label="Formula history">
            {formulas.map((f) => (
              <li key={f.id} className="animate-fade-in py-3">
                <p className="flex flex-wrap items-center gap-x-2 text-13 text-ink-muted">
                  <span className="font-medium text-ink">{formatDate(f.visit_date)}</span>
                  <span aria-hidden>·</span>
                  {f.author ? fullName(f.author) : "Unknown"}
                </p>
                <p className="mt-1.5 border-l-2 border-peach-accent pl-3 font-mono text-13 whitespace-pre-line text-ink">{f.formula}</p>
                {f.formula_products.length > 0 && (
                  <p className="mt-1.5 text-13 text-ink" data-testid="formula-products">
                    <span className="text-ink-muted">{f.item ? `${f.item.service.name}: ` : "Products: "}</span>
                    {[...f.formula_products]
                      .sort((a, b) => a.position - b.position)
                      .map((fp) => `${formatAmount(fp.amount, fp.product.unit)} ${productName(fp.product)}`)
                      .join(" + ")}
                  </p>
                )}
                {f.notes && <p className="mt-1.5 text-13 text-ink-muted">{f.notes}</p>}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section titleId="photos-heading" title="Before and after" count={gallery.photos.length} description="Saved to each visit. Only your salon can see them.">
        <div className="border-t border-line pt-4">
          <PhotoGallery clientId={client.id} photos={gallery.photos} consent={gallery.consent} today={today} />
        </div>
      </Section>

      <Section titleId="details-heading" title="Details">
        {editable ? (
          <ClientForm
            key={client.updated_at}
            clientId={client.id}
            initial={toFields(client)}
            stylists={await stylistOptions(supabase, client.preferred_staff_id)}
            today={today}
          />
        ) : (
          <dl className="divide-y divide-line border-y border-line">
            <Detail label="Phone" value={client.phone} />
            <Detail label="Email" value={client.email} />
            <Detail label="Preferred stylist" value={client.preferred ? fullName(client.preferred) : null} empty="No preference" />
            <Detail label="Preferences" value={client.preferences} />
            <Detail label="Birthday" value={client.birth_month && client.birth_day ? `${MONTHS[client.birth_month - 1]} ${client.birth_day}` : null} />
            <Detail label="Notes" value={client.notes} />
            <Detail label="Consent form" value={client.consent_signed_on ? `Signed ${formatDate(client.consent_signed_on)}` : null} empty="Not signed" />
            <Detail
              label="Messages"
              value={
                [client.sms_opt_in && !client.sms_stopped_at && "Offers by text OK", client.email_opt_in && "Offers by email OK"].filter(Boolean).join(" · ") ||
                null
              }
              empty="No offers"
            />
          </dl>
        )}
      </Section>
    </AppShell>
  );
}

// Records under a section's title: a thin rule above, one between each.
const recordsClass = "divide-y divide-line border-y border-line";

// A label and its value, side by side from a tablet up.
function Detail({ label, value, empty = "—" }: { label: string; value: string | null; empty?: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-13 text-ink-muted">{label}</dt>
      <dd className={`text-sm ${value ? "whitespace-pre-line text-ink" : "text-ink-subtle"}`}>{value || empty}</dd>
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

// Each membership's history in words, newest first, with what was paid
// (for those who can see charges).
async function loadMembershipHistory(supabase: SupabaseClient<Database>, ids: string[], tz: string): Promise<Record<string, MembershipHistory[]>> {
  if (!ids.length) return {};
  const [{ data: events }, { data: charges }] = await Promise.all([
    supabase.from("membership_events").select("id, membership_id, kind, detail, sale_id, created_at, service:services(name)").in("membership_id", ids).order("created_at", { ascending: false }).limit(200),
    supabase.from("membership_charges").select("sale_id, amount_cents").in("membership_id", ids).eq("status", "succeeded"),
  ]);
  const paid = new Map((charges ?? []).flatMap((c) => (c.sale_id ? [[c.sale_id, formatPrice(c.amount_cents)] as const] : [])));
  const out: Record<string, MembershipHistory[]> = {};
  for (const e of events ?? []) {
    (out[e.membership_id] ??= []).push({
      id: e.id,
      at: toLocal(new Date(e.created_at), tz).date,
      text: historyText({ kind: e.kind, detail: e.detail, service: e.service?.name }, e.sale_id ? paid.get(e.sale_id) : undefined),
    });
  }
  return out;
}
