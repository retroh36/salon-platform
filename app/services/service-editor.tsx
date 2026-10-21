import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { centsToInput, sortCategories } from "@/lib/services";
import { fullName, roleLabel, sortStaff } from "@/lib/staff";
import { setServiceArchived, type ServiceFormFields } from "./actions";
import { ServiceForm } from "./service-form";

const EMPTY: ServiceFormFields = {
  name: "",
  category: "",
  description: "",
  active_minutes: "",
  processing_minutes: "0",
  finishing_minutes: "0",
  price: "",
  staff: {},
};

// Add (no serviceId) or view/edit an existing service. Stylists and front
// desk see it read-only; RLS blocks their writes regardless.
export async function ServiceEditor({ serviceId, error }: { serviceId?: string; error?: string }) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;

  const manage = canManage(me.role);
  if (!serviceId && !manage) redirect("/services");
  if (serviceId && !isUuid(serviceId)) notFound();

  const [serviceResult, { data: staff, error: staffError }, { data: categoryRows, error: categoryError }] =
    await Promise.all([
      serviceId
        ? supabase
            .from("services")
            .select(
              "id, name, category, description, active_minutes, processing_minutes, finishing_minutes, price_cents, archived_at, staff_services(staff_id, price_cents)",
            )
            .eq("id", serviceId)
            .maybeSingle()
        : Promise.resolve(null),
      supabase.from("staff").select("id, first_name, last_name, role, color, is_active"),
      supabase.from("services").select("category"),
    ]);
  if (staffError) throw staffError;
  if (categoryError) throw categoryError;
  if (serviceResult?.error) throw serviceResult.error;

  const service = serviceResult?.data;
  if (serviceId && !service) notFound();

  const initial: ServiceFormFields = service
    ? {
        name: service.name,
        category: service.category,
        description: service.description ?? "",
        active_minutes: String(service.active_minutes),
        processing_minutes: String(service.processing_minutes),
        finishing_minutes: String(service.finishing_minutes),
        price: centsToInput(service.price_cents),
        staff: Object.fromEntries(service.staff_services.map((ss) => [ss.staff_id, centsToInput(ss.price_cents)])),
      }
    : EMPTY;

  // Inactive staff only appear if they still offer this service.
  const staffOptions = sortStaff(staff.filter((s) => s.is_active || initial.staff[s.id] !== undefined)).map((s) => ({
    id: s.id,
    name: fullName(s),
    role: roleLabel(s.role),
    color: s.color,
    isActive: s.is_active,
  }));

  const title = service ? service.name : "Add service";
  const archived = Boolean(service?.archived_at);

  return (
    <AppShell section="services" me={me}>
      <Link
        href="/services"
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted transition-colors duration-(--motion-fast) hover:text-plum-900"
      >
        ← Services
      </Link>
      <div className="mt-3 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-plum-900">{title}</h1>
        {archived && <Badge tone="neutral">Archived</Badge>}
        {!manage && <Badge tone="plum">View only</Badge>}
      </div>

      {error === "name-taken" && (
        <Alert className="mb-4">Couldn&apos;t restore: another service on the menu already has this name. Rename one of them first.</Alert>
      )}

      {archived && manage && (
        <Alert tone="info" className="mb-4">
          This service is archived and can&apos;t be booked. Restore it to edit.
        </Alert>
      )}

      <ServiceForm
        key={service?.id ?? "new"}
        serviceId={service?.id}
        initial={initial}
        staffOptions={staffOptions}
        categories={sortCategories(categoryRows.map((r) => r.category))}
        readOnly={!manage || archived}
      />

      {service && manage && (
        <form
          action={setServiceArchived.bind(null, service.id, !archived)}
          className={`mt-10 rounded-xl border p-5 ${archived ? "border-line bg-surface" : "border-danger/25 bg-danger-soft/40"}`}
        >
          <h2 className="font-serif text-lg font-semibold text-ink">{archived ? "Restore" : "Archive"}</h2>
          <p className="mt-1 mb-4 text-sm text-ink-muted">
            {archived
              ? "Put this service back on the menu."
              : "Archiving removes this service from the menu and booking. Past appointments keep it."}
          </p>
          <button
            type="submit"
            className={archived ? buttonClass("secondary", "md") : buttonClass("secondary", "md", "border-danger/40 text-danger hover:bg-danger-soft")}
          >
            {archived ? "Restore service" : "Archive service"}
          </button>
        </form>
      )}
    </AppShell>
  );
}
