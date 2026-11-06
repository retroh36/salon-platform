import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { setBundleArchived } from "./bundle-actions";
import { BundleForm } from "./bundle-form";

// Add (no bundleId) or view/edit a service bundle. Others see it read-only.
export async function BundleEditor({ bundleId, error }: { bundleId?: string; error?: string }) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  const manage = canManage(me.role);
  if (!bundleId && !manage) redirect("/services");
  if (bundleId && !isUuid(bundleId)) notFound();

  const [bundleResult, servicesResult] = await Promise.all([
    bundleId
      ? supabase.from("service_bundles").select("id, name, description, online, archived_at, parts:service_bundle_parts(position, service_id, gap_minutes)").eq("id", bundleId).maybeSingle()
      : Promise.resolve(null),
    supabase.from("services").select("id, name, category, duration_minutes, processing_minutes, price_cents, archived_at").order("name"),
  ]);
  if (bundleResult?.error) throw bundleResult.error;
  if (servicesResult.error) throw servicesResult.error;
  const bundle = bundleResult?.data;
  if (bundleId && !bundle) notFound();

  const parts = [...(bundle?.parts ?? [])].sort((a, b) => a.position - b.position).map((p) => ({ serviceId: p.service_id, gapMinutes: p.gap_minutes }));
  const inBundle = new Set(parts.map((p) => p.serviceId));
  const services = servicesResult.data
    .filter((s) => !s.archived_at || inBundle.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, category: s.category, minutes: s.duration_minutes ?? 0, processingMinutes: s.processing_minutes, priceCents: s.price_cents }));
  const archived = Boolean(bundle?.archived_at);

  return (
    <AppShell section="services" me={me}>
      <Link href="/services" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted transition-colors duration-(--motion-fast) hover:text-navy-900">
        ← Services
      </Link>
      <div className="mt-3 mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{bundle ? bundle.name : "Add bundle"}</h1>
        {archived && <Badge tone="neutral">Archived</Badge>}
        {!manage && <Badge tone="navy">View only</Badge>}
      </div>
      <p className="mb-6 max-w-2xl text-sm text-ink-muted">
        Services booked together, one after another, with time between them when the client processes. Each service keeps its own stylist, price and checkout line.
      </p>

      {error === "name-taken" && <Alert className="mb-4">Couldn&apos;t restore: another bundle already has this name. Rename one of them first.</Alert>}
      {archived && manage && (
        <Alert tone="info" className="mb-4">
          This bundle is archived and can&apos;t be booked. Restore it to edit.
        </Alert>
      )}

      <BundleForm
        key={bundle?.id ?? "new"}
        bundleId={bundle?.id}
        initial={{ name: bundle?.name ?? "", description: bundle?.description ?? "", online: bundle?.online ?? true, parts }}
        services={services}
        readOnly={!manage || archived}
      />

      {bundle && manage && (
        <form action={setBundleArchived.bind(null, bundle.id, !archived)} className="mt-10 max-w-2xl rounded-lg border border-line bg-surface p-4">
          <h2 className="text-base font-semibold text-ink">{archived ? "Restore" : "Archive"}</h2>
          <p className="mt-1 mb-4 text-sm text-ink-muted">
            {archived ? "Put this bundle back on the menu." : "Archiving takes this bundle off the menu and booking. Visits booked from it keep their services."}
          </p>
          <button type="submit" className={archived ? buttonClass("secondary", "md") : buttonClass("danger-quiet", "md", "-ml-3.5")}>
            {archived ? "Restore bundle" : "Archive bundle"}
          </button>
        </form>
      )}
    </AppShell>
  );
}
