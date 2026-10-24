import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { ChevronRightIcon, PlusIcon } from "@/components/ui/icons";
import { Badge, Card, listClass, PageHeader, rowLinkClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { searchClients } from "@/lib/client-search";
import { canEditClients, SEARCH_LIMIT } from "@/lib/clients";
import { fullName, isFrontOfHouse } from "@/lib/staff";
import { loadDueBack, type DashboardMe } from "@/lib/dashboard-load";
import { ClientSearch } from "./client-search";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage({ searchParams }: PageProps<"/clients">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Clients searchParams={searchParams} />
    </Suspense>
  );
}

async function Clients({ searchParams }: Pick<PageProps<"/clients">, "searchParams">) {
  const [{ q, due }, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (due === "1") return <DueBack me={me} />;

  const query = typeof q === "string" ? q.slice(0, 100) : "";
  const { search, clients, total } = await searchClients(supabase, me.business_id, query, SEARCH_LIMIT);

  return (
    <AppShell section="clients" me={me}>
      <PageHeader
        title="Clients"
        description="Search by name or phone to find a client's details, allergies and color history."
        actions={
          canEditClients(me.role) && (
            <Link href="/clients/new" className={buttonClass("primary", "md")}>
              <PlusIcon className="size-4" />
              Add client
            </Link>
          )
        }
      />

      <ClientSearch initialQuery={query} />

      <p className="mt-4 mb-3 text-sm text-ink-muted" aria-live="polite">
        {search.kind === "all"
          ? `${total} clients${total > clients.length ? ` · showing the first ${clients.length}` : ""}`
          : total === 0
            ? `No clients match “${query}”`
            : `${total} ${total === 1 ? "match" : "matches"}${total > clients.length ? ` · showing ${clients.length}` : ""}`}
      </p>

      {clients.length > 0 && (
        <Card flush>
          <ul className={listClass} aria-label="Clients">
            {clients.map((client) => (
              <li key={client.id} className="animate-fade-in">
                <Link href={`/clients/${client.id}`} className={rowLinkClass}>
                  <span className="flex min-w-0 flex-1 basis-56 items-center gap-3">
                    <Avatar name={fullName(client)} size="sm" />
                    <span className="truncate font-semibold text-ink">{fullName(client)}</span>
                    {client.allergies && <Badge tone="red">Allergy</Badge>}
                  </span>
                  <span className="w-36 text-sm text-ink-muted tabular-nums">{client.phone}</span>
                  <span className="hidden w-64 truncate text-sm text-ink-muted md:block">{client.email}</span>
                  <ChevronRightIcon className="hidden size-4 text-ink-muted sm:block" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </AppShell>
  );
}

// Regulars due back with nothing booked, from what Denise has learned (the
// Dashboard's "See all").
async function DueBack({ me }: { me: DashboardMe }) {
  const { supabase } = await getCurrentStaff();
  const { overdue, overdueTotal } = await loadDueBack(supabase, me);
  return (
    <AppShell section="clients" me={me}>
      <PageHeader
        title="Due back"
        description={`${!isFrontOfHouse(me.role) ? "Your regulars" : "Regulars"} who are due or overdue for a visit, with nothing booked. Most overdue first.`}
        actions={
          <Link href="/clients" className={buttonClass("secondary", "md")}>
            All clients
          </Link>
        }
      />
      <p className="mb-3 text-sm text-ink-muted">
        {overdueTotal} {overdueTotal === 1 ? "client" : "clients"}
        {overdueTotal > overdue.length ? ` · showing the first ${overdue.length}` : ""}
      </p>
      {overdue.length > 0 && (
        <Card flush>
          <ul className={listClass} aria-label="Due back">
            {overdue.map((c) => (
              <li key={c.clientId}>
                <Link href={`/clients/${c.clientId}`} className={rowLinkClass}>
                  <span className="flex min-w-0 flex-1 basis-56 items-center gap-3">
                    <Avatar name={c.name} size="sm" />
                    <span className="truncate font-semibold text-ink">{c.name}</span>
                    {c.risk === "high" && <Badge tone="amber">At risk</Badge>}
                  </span>
                  <span className="text-sm text-ink-muted">{c.reason}</span>
                  <ChevronRightIcon className="hidden size-4 text-ink-muted sm:block" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </AppShell>
  );
}
