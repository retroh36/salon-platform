import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { Badge, nameLinkClass, PageHeader } from "@/components/ui/page";
import { TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
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
        <TableCard>
          <table className={tableClass} aria-label="Clients">
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  Name
                </th>
                <th scope="col" className={thClass}>
                  Phone
                </th>
                <th scope="col" className={`${thClass} hidden md:table-cell`}>
                  Email
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id} className={`${trClass} animate-fade-in`}>
                  <td className={tdClass}>
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={fullName(client)} size="sm" />
                      <Link href={`/clients/${client.id}`} className={`${nameLinkClass} truncate`}>
                        {fullName(client)}
                      </Link>
                      {client.allergies && <Badge tone="danger">Allergy</Badge>}
                    </span>
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-ink-muted tabular-nums`}>{client.phone}</td>
                  <td className={`${tdClass} hidden max-w-72 truncate text-ink-muted md:table-cell`}>{client.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
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
        <TableCard>
          <table className={tableClass} aria-label="Due back">
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  Name
                </th>
                <th scope="col" className={thClass}>
                  Why
                </th>
              </tr>
            </thead>
            <tbody>
              {overdue.map((c) => (
                <tr key={c.clientId} className={trClass}>
                  <td className={tdClass}>
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={c.name} size="sm" />
                      <Link href={`/clients/${c.clientId}`} className={`${nameLinkClass} truncate`}>
                        {c.name}
                      </Link>
                      {c.risk === "high" && <Badge tone="warning">At risk</Badge>}
                    </span>
                  </td>
                  <td className={`${tdClass} text-ink-muted`}>{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </AppShell>
  );
}
