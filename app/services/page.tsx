import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { formatPrice, formatServiceTime, groupByCategory } from "@/lib/services";

export const metadata: Metadata = { title: "Services · Salon Platform" };

export default function ServicesPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Services />
    </Suspense>
  );
}

async function Services() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;

  const [{ data: services, error }, { data: staff, error: staffError }] = await Promise.all([
    supabase
      .from("services")
      .select(
        "id, name, category, active_minutes, processing_minutes, finishing_minutes, price_cents, archived_at, staff_services(staff_id, price_cents)",
      ),
    supabase.from("staff").select("id, first_name, last_name, is_active"),
  ]);
  if (error) throw error;
  if (staffError) throw staffError;

  const staffById = new Map(staff.map((s) => [s.id, s]));
  const active = services.filter((s) => !s.archived_at);
  const archived = services.filter((s) => s.archived_at).sort((a, b) => a.name.localeCompare(b.name));
  const manage = canManage(me.role);

  return (
    <AppShell section="services" businessName={me.location.business?.name} userName={me.first_name}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Services</h1>
          <p className="text-sm text-neutral-500">
            {active.length} on the menu{manage ? "" : " · view only"}
          </p>
        </div>
        {manage && (
          <Link
            href="/services/new"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Add service
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {groupByCategory(active).map(({ category, services }) => (
          <section key={category} className="rounded-xl border border-neutral-200 bg-white">
            <h2 className="border-b border-neutral-200 px-4 py-3 font-medium">
              {category} <span className="text-neutral-500">({services.length})</span>
            </h2>
            <ul className="divide-y divide-neutral-100">
              {services.map((service) => {
                const offeredBy = service.staff_services
                  .map((ss) => ({ ...ss, staff: staffById.get(ss.staff_id) }))
                  .filter((ss) => ss.staff?.is_active)
                  .sort((a, b) => a.staff!.first_name.localeCompare(b.staff!.first_name));
                const prices = [service.price_cents, ...offeredBy.map((ss) => ss.price_cents ?? service.price_cents)];
                const min = Math.min(...prices);
                const max = Math.max(...prices);

                return (
                  <li key={service.id}>
                    <Link
                      href={`/services/${service.id}`}
                      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 hover:bg-neutral-50"
                    >
                      <span className="min-w-52 flex-1 font-medium">{service.name}</span>
                      <span className="w-48 text-sm text-neutral-600">{formatServiceTime(service)}</span>
                      <span className="w-28 text-sm text-neutral-900">
                        {min === max ? formatPrice(min) : `${formatPrice(min)}–${formatPrice(max)}`}
                      </span>
                      <span className="w-full text-sm text-neutral-500 sm:w-auto sm:min-w-48">
                        {offeredBy.length === 0
                          ? "No one offers this yet"
                          : offeredBy.map((ss) => ss.staff!.first_name).join(", ")}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {archived.length > 0 && (
          <details className="rounded-xl border border-neutral-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 font-medium text-neutral-600">
              Archived ({archived.length})
            </summary>
            <ul className="divide-y divide-neutral-100 border-t border-neutral-200">
              {archived.map((service) => (
                <li key={service.id}>
                  <Link
                    href={`/services/${service.id}`}
                    className="flex flex-wrap gap-x-4 px-4 py-3 text-neutral-500 hover:bg-neutral-50"
                  >
                    <span className="min-w-52 flex-1">{service.name}</span>
                    <span className="text-sm">{service.category}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </AppShell>
  );
}
