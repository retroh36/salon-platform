import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { getCurrentStaff } from "@/lib/auth";
import { canEditClients, escapeLike, parseClientSearch, SEARCH_LIMIT } from "@/lib/clients";
import { fullName } from "@/lib/staff";
import { ClientSearch } from "./client-search";

export const metadata: Metadata = { title: "Clients · Salon Platform" };

export default function ClientsPage({ searchParams }: PageProps<"/clients">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Clients searchParams={searchParams} />
    </Suspense>
  );
}

async function Clients({ searchParams }: Pick<PageProps<"/clients">, "searchParams">) {
  const [{ q }, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;

  const query = typeof q === "string" ? q.slice(0, 100) : "";
  const search = parseClientSearch(query);

  let request = supabase
    .from("clients")
    .select("id, first_name, last_name, phone, email, allergies", { count: "exact" })
    .eq("business_id", me.business_id);
  if (search.kind === "phone") request = request.like("phone_digits", `%${search.digits}%`);
  if (search.kind === "name") {
    for (const term of search.terms) {
      const escaped = escapeLike(term);
      if (escaped) request = request.ilike("search_name", `%${escaped}%`);
    }
  }
  const { data: clients, count, error } = await request.order("search_name").order("id").limit(SEARCH_LIMIT);
  if (error) throw error;

  const total = count ?? clients.length;

  return (
    <AppShell section="clients" businessName={me.location.business?.name} userName={me.first_name}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Clients</h1>
        {canEditClients(me.role) && (
          <Link
            href="/clients/new"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Add client
          </Link>
        )}
      </div>

      <ClientSearch initialQuery={query} />

      <p className="mt-4 mb-2 text-sm text-neutral-500" aria-live="polite">
        {search.kind === "all"
          ? `${total} clients${total > clients.length ? ` · showing the first ${clients.length}` : ""}`
          : total === 0
            ? `No clients match “${query}”`
            : `${total} ${total === 1 ? "match" : "matches"}${total > clients.length ? ` · showing ${clients.length}` : ""}`}
      </p>

      {clients.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white" aria-label="Clients">
          {clients.map((client) => (
            <li key={client.id}>
              <Link
                href={`/clients/${client.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-neutral-50"
              >
                <span className="min-w-48 flex-1 font-medium">{fullName(client)}</span>
                <span className="w-36 text-sm text-neutral-600">{client.phone}</span>
                <span className="w-64 truncate text-sm text-neutral-500">{client.email}</span>
                {client.allergies && (
                  <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Allergy</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
