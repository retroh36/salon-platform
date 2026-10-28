import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fullName, sortForCalendar } from "@/lib/staff";
import { STATION_KINDS, type StationKind } from "@/lib/stations";
import { SettingsNav } from "../settings-nav";
import { StationsEditor } from "./stations-editor";

export const metadata: Metadata = { title: "Stations" };

export default function StationsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Stations />
    </Suspense>
  );
}

// The salon's chairs, color bar, shampoo bowls and rooms, and each
// stylist's home chair.
async function Stations() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const [resources, team] = await Promise.all([
    supabase.from("resources").select("id, name, kind, area, is_active, sort_order").eq("location_id", me.location.id).order("sort_order").order("name"),
    supabase.from("staff").select("id, first_name, last_name, role, is_active, calendar_position, home_resource_id").eq("location_id", me.location.id).eq("is_active", true),
  ]);
  if (resources.error) throw resources.error;
  if (team.error) throw team.error;
  const people = sortForCalendar(team.data).map((s) => ({ id: s.id, name: fullName(s), role: s.role, home: s.home_resource_id }));

  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Stations" description="The chairs, color bar, shampoo bowls and rooms at this location. Each stylist can have a home chair, which their clients are booked into." />
      <SettingsNav current="stations" me={me} />
      <StationsEditor
        kinds={STATION_KINDS}
        stations={resources.data.map((r) => ({ id: r.id, name: r.name, kind: r.kind as StationKind, area: r.area, isActive: r.is_active, homeStaffId: people.find((p) => p.home === r.id)?.id ?? null }))}
        people={people.map(({ id, name, role }) => ({ id, name, role }))}
      />
    </AppShell>
  );
}
