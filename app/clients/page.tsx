import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { Badge, nameLinkClass, PageHeader } from "@/components/ui/page";
import { numClass, TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { listClients } from "@/lib/client-search";
import { canEditClients, clientSortHref, parseClientOrder, SEARCH_LIMIT, type ClientOrder, type ClientSort } from "@/lib/clients";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
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
  const [{ q, due, sort, dir }, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (due === "1") return <DueBack me={me} />;

  const query = typeof q === "string" ? q.slice(0, 100) : "";
  // Spend is for the front of house (stylists' rows have none anyway).
  const spend = isFrontOfHouse(me.role);
  const order = parseClientOrder(sort, dir, spend);
  const { search, clients, total } = await listClients(supabase, me.business_id, query, order, SEARCH_LIMIT);
  const tz = me.location.timezone;
  const header = (key: ClientSort, label: string, className = "") => <SortHeader order={order} sort={key} label={label} query={query} className={className} />;

  return (
    <AppShell section="clients" me={me}>
      <PageHeader
        title="Clients"
        description="Search by name or phone to find a client's details, allergies and color history. Tap a column to sort."
        actions={
          canEditClients(me.role) && (
            <Link href="/clients/new" className={buttonClass("primary", "md")}>
              <PlusIcon className="size-4" />
              Add client
            </Link>
          )
        }
      />

      <ClientSearch initialQuery={query} sort={order.sort === "name" && order.ascending ? null : { sort: order.sort, dir: order.ascending ? "asc" : "desc" }} />

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
                {header("name", "Name")}
                <th scope="col" className={`${thClass} hidden md:table-cell`}>
                  Phone
                </th>
                {header("last_visit", "Last visit")}
                {header("next_visit", "Next visit")}
                {header("stylist", "Usual stylist", "hidden lg:table-cell")}
                {spend && header("spend", "Spend", "text-right")}
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
                  <td className={`${tdClass} hidden whitespace-nowrap text-ink-muted tabular-nums md:table-cell`}>{client.phone}</td>
                  <td className={`${tdClass} whitespace-nowrap text-ink-muted tabular-nums`}>{client.last_visit_at ? day(client.last_visit_at, tz) : "—"}</td>
                  <td className={`${tdClass} whitespace-nowrap tabular-nums ${client.next_visit_at ? "text-ink" : "text-ink-muted"}`}>
                    {client.next_visit_at ? `${day(client.next_visit_at, tz, false)} · ${formatMinute(toLocal(new Date(client.next_visit_at), tz).minute)}` : "—"}
                  </td>
                  <td className={`${tdClass} hidden max-w-48 truncate text-ink-muted lg:table-cell`}>{client.usual_staff_name ?? "—"}</td>
                  {spend && <td className={`${tdClass} ${numClass}`}>{client.spend_cents ? formatPrice(client.spend_cents) : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </AppShell>
  );
}

// "Oct 12, 2026" in the salon's time zone (the year left off for "Tue, Oct 27").
function day(iso: string, timeZone: string, withYear = true): string {
  return new Date(iso).toLocaleDateString("en-US", withYear ? { timeZone, month: "short", day: "numeric", year: "numeric" } : { timeZone, weekday: "short", month: "short", day: "numeric" });
}

// A column header that sorts the list: a link to the other direction once
// it's the sort, with an arrow showing which way.
function SortHeader({ order, sort, label, query, className }: { order: ClientOrder; sort: ClientSort; label: string; query: string; className: string }) {
  const active = order.sort === sort;
  const right = className.includes("text-right");
  return (
    <th scope="col" className={`${thClass} ${className}`} aria-sort={active ? (order.ascending ? "ascending" : "descending") : undefined}>
      <Link
        href={clientSortHref(order, sort, query)}
        scroll={false}
        className={`inline-flex items-center gap-1 rounded-sm hover:text-ink focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:outline-none ${active ? "text-ink" : ""}`}
      >
        {/* The arrow on the label's inner side, so a right-aligned
            heading still lines up with its figures. */}
        {!right && label}
        <span aria-hidden className={active ? "" : "opacity-0"}>
          {active && !order.ascending ? "↓" : "↑"}
        </span>
        {right && label}
      </Link>
    </th>
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
