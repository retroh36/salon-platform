import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { fullName } from "@/lib/staff";
import type { Timing, TimingRow } from "@/lib/stylist-timings";
import { canManageMember } from "@/lib/team";
import { TimesForm } from "./times-form";

export const metadata: Metadata = { title: "Service times" };

export default function TimesPage({ params }: PageProps<"/team/[id]/times">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Times params={params} />
    </Suspense>
  );
}

type Own = { active_minutes: number | null; processing_minutes: number | null; finishing_minutes: number | null };
const ownOf = (s: Own): Timing | null =>
  s.active_minutes === null ? null : { active: s.active_minutes, processing: s.processing_minutes ?? 0, finishing: s.finishing_minutes ?? 0 };

// A stylist's own times for each service they do, against the menu's: set
// by hand, or copied from another stylist and then adjusted.
async function Times({ params }: Pick<PageProps<"/team/[id]/times">, "params">) {
  const [{ id }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isUuid(id)) notFound();
  const timingColumns = "service_id, active_minutes, processing_minutes, finishing_minutes";
  const [{ data: member, error }, { data: others, error: othersError }] = await Promise.all([
    supabase
      .from("staff")
      .select(`id, first_name, last_name, role, staff_services(${timingColumns}, service:services(name, category, active_minutes, processing_minutes, finishing_minutes, archived_at))`)
      .eq("id", id)
      .eq("business_id", me.business_id)
      .maybeSingle(),
    supabase.from("staff").select(`id, first_name, last_name, staff_services(${timingColumns})`).eq("business_id", me.business_id).eq("is_active", true).eq("role", "stylist").neq("id", id).order("first_name"),
  ]);
  if (error) throw error;
  if (othersError) throw othersError;
  if (!member) notFound();
  if (!canManageMember(me, member)) redirect("/team");

  const rows: TimingRow[] = member.staff_services
    .filter((s) => !s.service.archived_at)
    .map((s) => ({
      serviceId: s.service_id,
      name: s.service.name,
      category: s.service.category,
      menu: { active: s.service.active_minutes, processing: s.service.processing_minutes, finishing: s.service.finishing_minutes },
      own: ownOf(s),
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const sources = (others ?? []).map((o) => ({ id: o.id, name: fullName(o), times: Object.fromEntries(o.staff_services.map((s) => [s.service_id, ownOf(s)])) }));

  return (
    <AppShell section="team" me={me}>
      <BackLink href={`/team/${member.id}`}>{fullName(member)}</BackLink>
      <PageHeader
        title={`${member.first_name}'s service times`}
        description={`How long ${member.first_name} takes for each service they do. New bookings with them use these; visits already booked keep their own.`}
      />
      <TimesForm staffId={member.id} firstName={member.first_name} rows={rows} sources={sources} />
    </AppShell>
  );
}
