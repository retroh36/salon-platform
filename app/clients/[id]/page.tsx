import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { buttonClass } from "@/components/ui/button";
import { BoxIcon, ChartIcon, TagIcon, UserIcon } from "@/components/ui/icons";
import { Badge, nameLinkClass } from "@/components/ui/page";
import { ClientInsightCard } from "@/components/client-insight";
import { PhotoGallery } from "@/components/visit-photos";
import { getCurrentStaff } from "@/lib/auth";
import { patchSettings } from "@/lib/client-checks";
import { checkoutVisit, clientSince, clientTags, editedLine, PROFILE_TAB_COOKIE, profileTab, saleTotals, splitVisits, visitsSummary, type ProfileVisit } from "@/lib/client-profile";
import { canEditClients, formatDate, MONTHS } from "@/lib/clients";
import type { Database } from "@/lib/database.types";
import { isUuid } from "@/lib/ids";
import { describeClient } from "@/lib/insights/describe";
import { loadClientInsights } from "@/lib/insights/read";
import { formatAmount, productName } from "@/lib/inventory";
import { loadBackBarProducts } from "@/lib/inventory-load";
import { historyText } from "@/lib/memberships";
import { loadClientMemberships } from "@/lib/memberships-load";
import { allowedChannels, consentOf, noTextsFlag } from "@/lib/messaging/consent";
import { loadClientPackages, withPackages } from "@/lib/packages";
import { currentProvider } from "@/lib/payments";
import { loadPhotos } from "@/lib/photos-load";
import { canTakePayments } from "@/lib/sales";
import { formatDay } from "@/lib/schedule-format";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { patchTestMessage, patchTestState } from "@/lib/scheduling/patch-tests";
import { addDays, formatMinute, todayIn, toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { fullName, isFrontOfHouse } from "@/lib/staff";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AddRecord } from "../add-record";
import { FormulaForm, type VisitOption } from "../formula-form";
import { PatchTestForm } from "../patch-test-form";
import { ClientNotes } from "./client-notes";
import { MembershipList, type MembershipHistory } from "./memberships/membership-card";
import { MessagesCard } from "./messages-card";
import { RewardsCard } from "./rewards/rewards-card";
import { PackagesList } from "./packages/packages-card";
import { PolicyCards } from "./policy-card";
import { ProfileTabs } from "./profile-tabs";
import { QuickActions } from "./quick-actions";
import { Row, SideCard } from "./side-card";

export const metadata: Metadata = { title: "Client" };

// The client profile, the same layout for every role (RLS decides what
// each sees): allergies first, the header (contact, stylist, client since,
// tags and actions), their notes, Denise's summary, then their history in
// tabs; beside it (under it on narrow screens) a card each, in the same
// order for everyone, leaving out what a role can't see: At a glance,
// Details, Packages, Membership, Rewards, Card on file, Cancellation policy
// and Messages.
export default function ClientPage({ params }: PageProps<"/clients/[id]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <ClientProfile params={params} />
    </Suspense>
  );
}

// The past visits shown in the Visits tab.
const PAST_VISITS = 100;

async function ClientProfile({ params }: Pick<PageProps<"/clients/[id]">, "params">) {
  const [{ id }, { supabase, staff: me }, jar] = await Promise.all([params, getCurrentStaff(), cookies()]);
  if (!me) return <NotLinked />;
  if (!isUuid(id)) notFound();

  const tz = me.location.timezone;
  const today = todayIn(tz);
  const now = new Date();
  const frontOfHouse = isFrontOfHouse(me.role);
  const [{ data: client, error }, { data: formulas, error: formulaError }, { data: items, error: itemError }, products, { data: visitRows, error: visitError }] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "*, preferred:staff!clients_preferred_staff_id_business_id_fkey(first_name, last_name, is_active), notes_editor:staff!clients_notes_updated_by_business_id_fkey(first_name, last_name)",
      )
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
    // Their visits, newest first, each with its services and (for the front
    // of house, who see sales) what was paid.
    supabase
      .from("appointments")
      .select(
        "id, status, starts_at, ends_at, appointment_items(starts_at, service:services(name), staff:staff(first_name)), sales:sales!sales_appointment_id_fkey(status, total_cents, tip_cents, refunded_cents)",
      )
      .eq("client_id", id)
      .order("starts_at", { ascending: false })
      .limit(PAST_VISITS + 50),
  ]);
  const [{ data: patchTests, error: patchError }, { data: forms, error: formsError }, { data: team, error: teamError }, settings, insights] = await Promise.all([
    supabase.from("client_patch_tests").select("id, tested_at, products, result, notes, staff(first_name, last_name)").eq("client_id", id).order("tested_at", { ascending: false }),
    supabase.from("client_forms").select("id, template_name, signed_at").eq("client_id", id).order("signed_at", { ascending: false }),
    supabase.from("staff").select("id, first_name, last_name").eq("is_active", true).order("first_name"),
    patchSettings(supabase, me.business_id),
    loadClientInsights(supabase, me.business_id, [id]),
  ]);
  const [packages, gallery, memberships, { data: onlineAccount }, vipCents, { data: business }] = await Promise.all([
    loadClientPackages(supabase, id),
    loadPhotos(supabase, me, { clientId: id }),
    loadClientMemberships(supabase, id),
    // Front of house can see whether they have an account on the booking site.
    supabase.from("client_accounts").select("last_sign_in_at").eq("client_id", id).maybeSingle(),
    vipSpend(supabase, me.business_id),
    supabase.from("businesses").select("free_text_roles").eq("id", me.business_id).single(),
  ]);
  const membershipHistory = await loadMembershipHistory(supabase, memberships.map((m) => m.id), tz);
  if (patchError) throw patchError;
  if (formsError) throw formsError;
  if (teamError) throw teamError;
  if (error) throw error;
  if (formulaError) throw formulaError;
  if (itemError) throw itemError;
  if (visitError) throw visitError;
  if (!client) notFound();

  const recentItems: VisitOption[] = items.map((i) => {
    const local = toLocal(new Date(i.starts_at), tz);
    return { itemId: i.id, date: local.date, label: `${formatDate(local.date)} · ${i.service.name} with ${i.stylist.first_name}` };
  });

  const editable = canEditClients(me.role);
  const known = insights.get(id);
  const spend = known?.spend ?? null;
  const names = new Map(team.map((t) => [t.id, t.first_name]));
  const insight = withPackages(
    known ? describeClient(known.habits, known.spend, { staff: (s) => names.get(s) ?? null, dayOf: (iso) => formatDate(toLocal(new Date(iso), tz).date) }, now) : null,
    packages,
  );

  const visits: ProfileVisit[] = visitRows.map((a) => {
    const sale = saleTotals(a.sales);
    return {
      id: a.id,
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      status: a.status,
      services: [...a.appointment_items].sort((x, y) => x.starts_at.localeCompare(y.starts_at)).map((i) => ({ name: i.service.name, staff: i.staff.first_name })),
      totalCents: sale?.totalCents ?? null,
      tipCents: sale?.tipCents ?? null,
    };
  });
  const isToday = (iso: string) => toLocal(new Date(iso), tz).date === today;
  const split = splitVisits(visits, now, isToday);
  const { upcoming, past } = split;
  const completed = visits.filter((v) => v.status === "completed");
  const firstVisit = completed.at(-1)?.startsAt ?? null;
  const consent = consentOf(client);
  const member = memberships.find((m) => m.status === "active");
  const tags = clientTags({ firstVisit, visits, spendCents: spend?.lifetimeSpendCents ?? null, vipCents: spend ? vipCents : null, member: member ? `${member.name} member` : null, noTexts: noTextsFlag(consent) }, now);
  const usual = known?.habits.preferredStaffId ? names.get(known.habits.preferredStaffId) : null;
  const stylistLine = client.preferred ? `${client.only_sees_preferred ? "Only sees" : "Prefers"} ${fullName(client.preferred)}` : usual ? `Usually sees ${usual}` : null;
  const dayOf = (iso: string) => formatDay(toLocal(new Date(iso), tz).date, true);
  // Today's visit still open (in the chair first), else the next one.
  const toCheckOut = checkoutVisit(split.today);

  // Message: about their next visit, for the front of house or a stylist on it.
  const nextVisit = toCheckOut ?? upcoming[0] ?? null;
  const freeText = me.role === "owner" || Boolean(business?.free_text_roles.includes(me.role));
  const message = nextVisit
    ? { appointmentId: nextVisit.id, channels: { appointment: allowedChannels(consent, "appointment"), marketing: allowedChannels(consent, "marketing") }, freeText }
    : frontOfHouse
      ? { reason: `Messages are about a visit: book ${client.first_name}'s next one first.` }
      : null;
  const from = encodeURIComponent(`/clients/${id}`);

  const patchState = patchTestState(
    patchTests.map((t) => ({ testedAt: new Date(t.tested_at), result: t.result })),
    now,
    { ...settings, minHours: 0 },
  );

  const visitsPanel = (
    <div className="flex flex-col gap-6" data-testid="client-visits">
      {visits.length === 0 ? (
        <p className={quietLine}>No visits yet.</p>
      ) : (
        <p className="-mb-2 text-13 text-ink-muted" data-testid="visits-summary">
          {visitsSummary(visits, { today: split.today.length, upcoming: upcoming.length })}
        </p>
      )}
      {split.today.length > 0 && <VisitList title="Today" visits={split.today} tz={tz} today={today} money={frontOfHouse} />}
      {upcoming.length > 0 && <VisitList title="Upcoming" visits={upcoming} tz={tz} today={today} money={frontOfHouse} />}
      {past.length > 0 && <VisitList title="Past" visits={past.slice(0, PAST_VISITS)} tz={tz} today={today} money={frontOfHouse} />}
    </div>
  );

  const formulasPanel = (
    <div className="flex flex-col gap-3">
      <AddRecord label="Add formula">
        <FormulaForm clientId={client.id} today={today} visits={recentItems} products={products} />
      </AddRecord>
      {formulas.length === 0 ? (
        <p className={quietLine}>No formulas yet.</p>
      ) : (
        <ol className={recordsClass} aria-label="Formula history">
          {formulas.map((f, i) => (
            <li key={f.id} className="animate-fade-in py-3" data-testid={i === 0 ? "latest-formula" : undefined}>
              <p className="flex flex-wrap items-center gap-x-2 text-13 text-ink-muted">
                <span className="font-medium text-ink">{formatDate(f.visit_date)}</span>
                <span aria-hidden>·</span>
                {f.author ? fullName(f.author) : "Unknown"}
                {i === 0 && <Badge dot={false}>Latest</Badge>}
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
    </div>
  );

  const patchPanel = (
    <div className="flex flex-col gap-3">
      <p className="text-13 text-ink-muted" data-testid="patch-state">
        {patchState === "ok" ? "Valid today for services that need one." : patchTestMessage(patchState, settings).replace(" before this visit", " ago")}
      </p>
      <AddRecord label="Add patch test">
        <PatchTestForm clientId={client.id} today={today} timeZone={tz} me={me.id} staff={team.map((s) => ({ id: s.id, name: fullName(s) }))} />
      </AddRecord>
      {patchTests.length === 0 ? (
        <p className={quietLine}>No patch tests yet.</p>
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
    </div>
  );

  const formsPanel = (
    <div className="flex flex-col gap-3">
      <Link href={`/clients/${client.id}/forms/new`} className={buttonClass("secondary", "sm", "self-start")}>
        Fill in a form
      </Link>
      {forms.length === 0 ? (
        <p className={quietLine}>No signed forms yet.</p>
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
    </div>
  );

  const photosPanel = (
    <div>
      <p className="mb-3 text-13 text-ink-muted">Saved to each visit. Only your salon can see them.</p>
      <PhotoGallery clientId={client.id} photos={gallery.photos} consent={gallery.consent} today={today} />
    </div>
  );

  const lastVisit = completed[0] ?? null;
  const nextText = nextVisit
    ? `${isToday(nextVisit.startsAt) ? "Today" : formatDay(toLocal(new Date(nextVisit.startsAt), tz).date, toLocal(new Date(nextVisit.startsAt), tz).date.slice(0, 4) !== today.slice(0, 4))}, ${formatMinute(toLocal(new Date(nextVisit.startsAt), tz).minute)}`
    : "Nothing booked";
  // At a glance's grid: completed visits (not the tab's every visit),
  // spend for those who see it, and the next visit.
  const stats: [string, string, string][] = [
    ["Completed visits", String(completed.length), "visits"],
    ...(spend
      ? ([
          ["Total spend", formatPrice(spend.lifetimeSpendCents), "spend"],
          ["Average ticket", spend.averageVisitCents != null ? formatPrice(spend.averageVisitCents) : "—", "average"],
        ] as [string, string, string][])
      : []),
    ["Next visit", nextText, "next"],
  ];

  return (
    <AppShell section="clients" me={me} wide>
      <BackLink href="/clients">Clients</BackLink>

      {client.allergies && (
        <div role="note" aria-label="Allergies" data-testid="allergy-alert" className="mb-5 flex animate-fade-in items-start gap-2.5 rounded-lg border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-danger-dot" />
          <div className="min-w-0">
            <p className="font-semibold">Allergies and sensitivities</p>
            <p className="whitespace-pre-line">{client.allergies}</p>
          </div>
        </div>
      )}

      <header className="mb-6 flex flex-col gap-4" data-testid="client-header">
        <div className="flex items-start gap-4">
          <Avatar name={fullName(client)} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-[-0.015em] text-ink">{fullName(client)}</h1>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm" data-testid="client-contact">
              {client.phone && (
                <a href={`tel:${client.phone}`} className={nameLinkClass}>
                  {client.phone}
                </a>
              )}
              {client.email && (
                <a href={`mailto:${client.email}`} className={`${nameLinkClass} wrap-anywhere`}>
                  {client.email}
                </a>
              )}
              {!client.phone && !client.email && <span className="text-ink-muted">No contact details</span>}
            </p>
            <p className="mt-1 text-13 text-ink-muted">
              {[stylistLine, `Client since ${formatDate(toLocal(new Date(clientSince(client.created_at, firstVisit)), tz).date)}`].filter(Boolean).join(" · ")}
            </p>
            {tags.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Tags" data-testid="client-tags">
                {tags.map((t) => (
                  <li key={t.label}>
                    <Badge tone={t.tone}>{t.label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <QuickActions
          firstName={client.first_name}
          bookHref={frontOfHouse ? `/calendar?book=${id}${client.preferred_staff_id ? `&staff=${client.preferred_staff_id}` : ""}` : null}
          checkoutHref={canTakePayments(me.role) ? (toCheckOut ? `/checkout/new?appointment=${toCheckOut.id}&from=${from}` : `/checkout/new?client=${id}&from=${from}`) : null}
          editHref={editable ? `/clients/${id}/edit` : null}
          message={message}
        />
      </header>

      <div className="@container">
        <div className="grid gap-x-8 gap-y-8 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            <ClientNotes
              clientId={client.id}
              initial={client.notes ?? ""}
              edited={editedLine(client.notes_updated_at, client.notes_editor, tz)}
              editable={editable}
            />
            {insight && (
              <div className="mb-8">
                <ClientInsightCard insight={insight} />
              </div>
            )}
            <ProfileTabs
              initial={profileTab(jar.get(PROFILE_TAB_COOKIE)?.value)}
              tabs={[
                { value: "visits", label: "Visits", count: visits.length },
                { value: "formulas", label: "Formulas", count: formulas.length },
                { value: "photos", label: "Photos", count: gallery.photos.length },
                { value: "patch", label: "Patch tests", count: patchTests.length },
                { value: "forms", label: "Forms", count: forms.length },
              ]}
              panels={{ visits: visitsPanel, formulas: formulasPanel, photos: photosPanel, patch: patchPanel, forms: formsPanel }}
            />
          </div>

          <aside aria-label="About this client" className="flex min-w-0 flex-col gap-4">
            <SideCard title="At a glance" icon={<ChartIcon />} testId="client-glance">
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line" data-testid="client-stats">
                {stats.map(([label, value, key]) => (
                  <div key={label} className="flex flex-col gap-1 bg-surface p-3" data-stat={key}>
                    <dt className="text-xs text-ink-muted">{label}</dt>
                    <dd className="text-base font-semibold text-ink tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <dl>
                <Row label="Last visit" testId="last-visit">
                  {lastVisit ? dayOf(lastVisit.startsAt) : "None yet"}
                </Row>
              </dl>
            </SideCard>

            <SideCard
              title="Details"
              icon={<UserIcon />}
              testId="client-details"
              action={
                editable ? (
                  <Link href={`/clients/${id}/edit`} className={buttonClass("quiet", "sm", "-mr-2")} aria-label={`Edit ${client.first_name}'s details`}>
                    Edit
                  </Link>
                ) : undefined
              }
            >
              <dl className="flex flex-col gap-2.5">
                <Row label="Birthday">{client.birth_month && client.birth_day ? `${MONTHS[client.birth_month - 1]} ${client.birth_day}` : <Empty />}</Row>
                <Row label="Preferences">{client.preferences ? <span className="whitespace-pre-line">{client.preferences}</span> : <Empty />}</Row>
                <Row label="Consent form">{client.consent_signed_on ? `Signed ${formatDate(client.consent_signed_on)}` : <Empty>Not signed</Empty>}</Row>
                {onlineAccount && (
                  <Row label="Online account" testId="online-account">
                    {`Yes${onlineAccount.last_sign_in_at ? `, last signed in ${formatDate(toLocal(new Date(onlineAccount.last_sign_in_at), tz).date)}` : ""}`}
                  </Row>
                )}
              </dl>
            </SideCard>

            {packages.length > 0 && (
              <SideCard title="Packages" icon={<BoxIcon />} testId="client-packages" note="Uses left are offered at checkout.">
                <PackagesList
                  clientId={id}
                  packages={packages}
                  canCancel={me.role === "owner" || me.role === "manager"}
                  expiresLabels={Object.fromEntries(packages.flatMap((p) => (p.expiresAt ? [[p.id, formatDate(toLocal(new Date(p.expiresAt), tz).date)]] : [])))}
                />
              </SideCard>
            )}

            {memberships.length > 0 && (
              <SideCard title="Membership" icon={<TagIcon />} testId="client-memberships" note="Member prices and included services apply at checkout.">
                <MembershipList
                  memberships={memberships}
                  history={membershipHistory}
                  today={today}
                  canChange={canTakePayments(me.role)}
                  canEndNow={me.role === "owner" || me.role === "manager"}
                  testCards={currentProvider().testCards.map((c) => ({ ...c }))}
                />
              </SideCard>
            )}

            {canTakePayments(me.role) && <RewardsCard supabase={supabase} me={me} clientId={client.id} firstName={client.first_name} tz={tz} />}
            {canTakePayments(me.role) && <PolicyCards supabase={supabase} businessId={me.business_id} role={me.role} client={client} tz={tz} />}
            {canTakePayments(me.role) && <MessagesCard supabase={supabase} clientId={client.id} firstName={client.first_name} tz={tz} />}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

// Records under a heading: a thin rule above, one between each.
const recordsClass = "divide-y divide-line border-y border-line";
// An empty tab: one quiet line.
const quietLine = "py-2 text-sm text-ink-muted";

// A detail with nothing in it.
function Empty({ children = "—" }: { children?: string }) {
  return <span className="text-ink-subtle">{children}</span>;
}

const STATUS_TAGS: Record<string, { label: string; tone: "info" | "success" | "warning" | "danger" | "neutral" }> = {
  checked_in: { label: "Here now", tone: "info" },
  no_show: { label: "No-show", tone: "danger" },
  canceled: { label: "Cancelled", tone: "neutral" },
};

// Visits as rows: the day and time (opening it on the calendar), each
// service with its stylist, and (front of house) the total and tip.
function VisitList({ title, visits, tz, today, money }: { title: string; visits: ProfileVisit[]; tz: string; today: string; money: boolean }) {
  return (
    <section aria-label={`${title} visits`}>
      <h3 className="mb-1 text-13 font-medium text-ink-muted">{title}</h3>
      <ol className={recordsClass}>
        {visits.map((v) => {
          const local = toLocal(new Date(v.startsAt), tz);
          const tag = STATUS_TAGS[v.status] ?? (v.status !== "completed" && local.date < today ? { label: "Not checked out", tone: "warning" as const } : null);
          return (
            <li key={v.id} className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 ${v.status === "canceled" ? "opacity-70" : ""}`} data-testid="client-visit">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/calendar?date=${local.date}&open=${v.id}`} className={nameLinkClass}>
                    {formatDay(local.date, local.date.slice(0, 4) !== today.slice(0, 4))}, {formatMinute(local.minute)}
                  </Link>
                  {tag && <Badge tone={tag.tone}>{tag.label}</Badge>}
                </p>
                <p className="mt-0.5 text-13 text-ink-muted">{v.services.map((s) => `${s.name} · ${s.staff}`).join(", ")}</p>
              </div>
              {money && v.totalCents != null && (
                <p className="text-right text-sm tabular-nums" data-testid="visit-total">
                  <span className="font-medium text-ink">{formatPrice(v.totalCents)}</span>
                  {v.tipCents ? <span className="block text-13 text-ink-muted">tip {formatPrice(v.tipCents)}</span> : null}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// The lifetime spend that puts a client in the salon's top tenth, from what
// Denise has learned (only the front of house can read spend; null else).
async function vipSpend(supabase: SupabaseClient<Database>, businessId: string): Promise<number | null> {
  const { count } = await supabase.from("insights").select("key", { count: "exact", head: true }).eq("business_id", businessId).eq("kind", "client_spend");
  if (!count) return null;
  const at = Math.floor(count / 10);
  const { data } = await supabase.from("insights").select("data").eq("business_id", businessId).eq("kind", "client_spend").order("data->lifetimeSpendCents", { ascending: false }).range(at, at);
  const cents = (data?.[0]?.data as { lifetimeSpendCents?: number } | undefined)?.lifetimeSpendCents;
  return typeof cents === "number" ? cents : null;
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
