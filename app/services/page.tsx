import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { ChevronRightIcon, PlusIcon } from "@/components/ui/icons";
import { listClass, nameLinkClass, PageHeader } from "@/components/ui/page";
import { numClass, TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { serviceFamily } from "@/lib/calendar";
import { formatDuration } from "@/lib/duration";
import { bundleMinutes } from "@/lib/scheduling/bundles";
import { formatPrice, formatPriceRange, formatServiceTime, groupByCategory, levelPricesFrom, stylistPrice, totalMinutes } from "@/lib/services";

// "Highlight, then 30 min gap, Gloss, then Cut".
function bundleText(parts: { service_id: string; gap_minutes: number }[], nameOf: (id: string) => string): string {
  return parts.map((p, n) => (n === 0 ? nameOf(p.service_id) : `${p.gap_minutes ? `${formatDuration(p.gap_minutes)} gap, ` : ""}${nameOf(p.service_id)}`)).join(", then ");
}

export const metadata: Metadata = { title: "Services" };

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

  const [{ data: services, error }, { data: staff, error: staffError }, { data: bundles, error: bundlesError }] = await Promise.all([
    supabase
      .from("services")
      .select(
        "id, name, category, active_minutes, processing_minutes, finishing_minutes, price_cents, archived_at, staff_services(staff_id, price_cents), service_level_prices(level, price_cents)",
      ),
    supabase.from("staff").select("id, first_name, last_name, level, is_active"),
    supabase.from("service_bundles").select("id, name, archived_at, parts:service_bundle_parts(position, service_id, gap_minutes)").order("position"),
  ]);
  if (error) throw error;
  if (bundlesError) throw bundlesError;
  if (staffError) throw staffError;

  const staffById = new Map(staff.map((s) => [s.id, s]));
  const active = services.filter((s) => !s.archived_at);
  const archived = services.filter((s) => s.archived_at).sort((a, b) => a.name.localeCompare(b.name));
  const manage = canManage(me.role);
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const activeBundles = bundles.filter((b) => !b.archived_at);
  const archivedBundles = bundles.filter((b) => b.archived_at);

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
            <>
              <Link href="/services/bundles/new" className={buttonClass("secondary", "md")}>
                Add bundle
              </Link>
              <Link href="/services/new" className={buttonClass("primary", "md")}>
                <PlusIcon className="size-4" />
                Add service
              </Link>
            </>
          )
        }
      />

      <div className="flex flex-col">
        {groupByCategory(active).map(({ category, services }) => (
          <section key={category} data-family={serviceFamily(category)} className="mb-8">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-(--fam-accent)" />
              {category} <span className="text-13 font-normal text-ink-subtle tabular-nums">({services.length})</span>
            </h2>
            <TableCard className="mb-0!">
              <table className={tableClass} aria-label={category}>
                <thead className={theadClass}>
                  <tr>
                    <th scope="col" className={thClass}>
                      Service
                    </th>
                    <th scope="col" className={`${thClass} hidden sm:table-cell`}>
                      Time
                    </th>
                    <th scope="col" className={`${thClass} text-right`}>
                      Price
                    </th>
                    <th scope="col" className={`${thClass} hidden md:table-cell`}>
                      Offered by
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((service) => {
                    const offeredBy = service.staff_services
                      .map((ss) => ({ ...ss, staff: staffById.get(ss.staff_id) }))
                      .filter((ss) => ss.staff?.is_active)
                      .sort((a, b) => a.staff!.first_name.localeCompare(b.staff!.first_name));
                    // What the stylists who offer it charge (or the menu price).
                    const priced = { price_cents: service.price_cents, levelPrices: levelPricesFrom(service.service_level_prices) };
                    const prices = offeredBy.length
                      ? offeredBy.map((ss) => stylistPrice(priced, { level: ss.staff!.level, customCents: ss.price_cents }))
                      : [service.price_cents];

                    return (
                      <tr key={service.id} className={trClass}>
                        <td className={tdClass}>
                          <Link href={`/services/${service.id}`} className={nameLinkClass}>
                            {service.name}
                          </Link>
                        </td>
                        <td className={`${tdClass} hidden whitespace-nowrap text-ink-muted sm:table-cell`}>{formatServiceTime(service)}</td>
                        <td className={`${tdClass} ${numClass} text-ink`}>{formatPriceRange(prices)}</td>
                        <td className={`${tdClass} hidden text-ink-muted md:table-cell`}>
                          {offeredBy.length === 0 ? <span className="text-ink-subtle">No one offers this yet</span> : offeredBy.map((ss) => ss.staff!.first_name).join(", ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableCard>
          </section>
        ))}

        {activeBundles.length > 0 && (
          <section className="mb-8" aria-labelledby="bundles-heading">
            <h2 id="bundles-heading" className="mb-1 text-base font-semibold text-ink">
              Bundles <span className="text-13 font-normal text-ink-subtle tabular-nums">({activeBundles.length})</span>
            </h2>
            <p className="mb-3 text-13 text-ink-muted">Services booked together, with the stylist free in the gaps. Each is its own line at checkout.</p>
            <TableCard className="mb-0!">
              <table className={tableClass} aria-label="Bundles">
                <thead className={theadClass}>
                  <tr>
                    <th scope="col" className={thClass}>
                      Bundle
                    </th>
                    <th scope="col" className={`${thClass} hidden sm:table-cell`}>
                      Time
                    </th>
                    <th scope="col" className={`${thClass} text-right`}>
                      Menu price
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeBundles.map((b) => {
                    const parts = [...b.parts].sort((x, y) => x.position - y.position);
                    const minutes = bundleMinutes(
                      parts.map((p) => ({ serviceId: p.service_id, gapMinutes: p.gap_minutes })),
                      (id) => totalMinutes(serviceById.get(id) ?? { active_minutes: 0, processing_minutes: 0, finishing_minutes: 0 }),
                    );
                    return (
                      <tr key={b.id} className={trClass}>
                        <td className={tdClass}>
                          <Link href={`/services/bundles/${b.id}`} className={nameLinkClass}>
                            {b.name}
                          </Link>
                          <p className="text-13 text-ink-muted">{bundleText(parts, (id) => serviceById.get(id)?.name ?? "a removed service")}</p>
                        </td>
                        <td className={`${tdClass} hidden whitespace-nowrap text-ink-muted sm:table-cell`}>{formatDuration(minutes)}</td>
                        <td className={`${tdClass} ${numClass} text-ink`}>{formatPrice(parts.reduce((sum, p) => sum + (serviceById.get(p.service_id)?.price_cents ?? 0), 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableCard>
          </section>
        )}

        {archivedBundles.length > 0 && (
          <ul className={`${listClass} mb-8 border-b border-line`} aria-label="Archived bundles">
            {archivedBundles.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                <Link href={`/services/bundles/${b.id}`} className={`${nameLinkClass} text-ink-muted!`}>
                  {b.name}
                </Link>
                <span className="text-13 text-ink-subtle">Archived bundle</span>
              </li>
            ))}
          </ul>
        )}

        {archived.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-line pb-2 text-sm font-medium text-ink-muted transition-colors duration-(--motion-fast) hover:text-ink [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon className="size-4 transition-transform duration-(--motion-fast) group-open:rotate-90" />
              <span>Archived ({archived.length})</span>
            </summary>
            <ul className={`${listClass} animate-fade-in border-b border-line`}>
              {archived.map((service) => (
                <li key={service.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                  <Link href={`/services/${service.id}`} className={`${nameLinkClass} text-ink-muted!`}>
                    {service.name}
                  </Link>
                  <span className="text-13 text-ink-subtle">{service.category}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </AppShell>
  );
}
