import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { LEVEL_LABELS } from "@/lib/schedule-forms";
import { fullName, sortForCalendar } from "@/lib/staff";
import { OrderForm } from "./order-form";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Calendar order" };

export default function CalendarOrderPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <CalendarOrder />
    </Suspense>
  );
}

// Owners: the order stylists' columns are in on the calendar, left to
// right, for everyone (saved views keep their own order).
async function CalendarOrder() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/team");
  const { data, error } = await supabase
    .from("staff")
    .select("id, first_name, last_name, role, level, color, is_active, calendar_position, staff_services(service_id)")
    .eq("location_id", me.location.id)
    .eq("is_active", true);
  if (error) throw error;
  // The people with a column: everyone who takes clients.
  const team = sortForCalendar(data.filter((s) => s.staff_services.length > 0));
  return (
    <AppShell section="team" me={me}>
      <BackLink href="/team">Team</BackLink>
      <PageHeader title="Calendar order" description="The order of stylists on the calendar, left to right, for everyone. Saved views keep their own order." />
      <OrderForm team={team.map((s) => ({ id: s.id, name: fullName(s), detail: s.level ? LEVEL_LABELS[s.level] : undefined, color: s.color, level: s.level }))} />
    </AppShell>
  );
}
