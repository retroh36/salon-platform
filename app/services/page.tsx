import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { ChevronRightIcon, PlusIcon } from "@/components/ui/icons";
import { listClass, PageHeader, rowLinkClass } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { serviceFamily } from "@/lib/calendar";
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
    <AppShell section="services" me={me}>
      <PageHeader
        title="Services"
        description={
          <>
            {active.length} on the menu{manage ? "" : " · view only"}
          </>
        }
        actions={
          manage && (
            <Link href="/services/new" className={buttonClass("primary", "md")}>
              <PlusIcon className="size-4" />
              Add service
            </Link>
          )
        }
      />

      <div className="flex flex-col gap-6">
        {groupByCategory(active).map(({ category, services }) => (
          <section
            key={category}
            data-family={serviceFamily(category)}
            className="overflow-hidden rounded-xl border border-line border-l-4 border-l-(--fam-accent) bg-surface shadow-card"
          >
            <h2 className="flex items-center gap-2 border-b border-line bg-(--fam-fill)/40 px-5 py-3.5 font-serif text-lg font-semibold text-ink">
              {category} <span className="font-sans text-sm font-medium text-ink-muted">({services.length})</span>
            </h2>
            <ul className={listClass}>
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
                    <Link href={`/services/${service.id}`} className={`${rowLinkClass} items-baseline`}>
                      <span className="min-w-52 flex-1 font-semibold text-ink">{service.name}</span>
                      <span className="w-48 text-sm text-ink-muted">{formatServiceTime(service)}</span>
                      <span className="w-28 text-sm font-medium text-ink tabular-nums">
                        {min === max ? formatPrice(min) : `${formatPrice(min)}–${formatPrice(max)}`}
                      </span>
                      <span className="w-full text-sm text-ink-muted sm:w-auto sm:min-w-48">
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
          <details className="group overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 font-medium text-ink-muted transition-colors duration-(--motion-fast) hover:bg-sunken [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon className="size-4 transition-transform duration-(--motion-fast) group-open:rotate-90" />
              <span>Archived ({archived.length})</span>
            </summary>
            <ul className={`${listClass} animate-fade-in border-t border-line`}>
              {archived.map((service) => (
                <li key={service.id}>
                  <Link href={`/services/${service.id}`} className={`${rowLinkClass} text-ink-muted`}>
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
